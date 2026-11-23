import { evaluate } from 'feelin';
import type { Document } from './document.js';
import { Formula, Text } from './expression.js';
import type { LazyFormula } from './lazy-formula.js';
import type { Imported } from './importers.js';
import { type Entry, ListNode, MapNode, type Node, ScalarNode } from './node.js';
import { type Located, Problem, ResolveFailed, ScriptedYamlError } from './problem.js';
import { Scope } from './scope.js';
import { Source } from './source.js';

type FeelResult = ReturnType<typeof evaluate>;

/** The values of one place in the file. A `$each!` item has its own per value; everything else shares the top one. */
class Env {
  readonly values = new Map<Node, unknown>();
  readonly open = new Set<Node>();
  readonly lists = new Map<ListNode, [Node, Env][]>();
  readonly maps = new Map<MapNode, Entry[]>();

  constructor(
    readonly owner?: MapNode,
    readonly value?: unknown,
    readonly parent?: Env,
  ) {}

  /** The env a node is computed in: the nearest one whose item holds the node. */
  for(node: Node): Env {
    let env: Env = this;
    while (env.owner && env.parent && !node.within(env.owner)) env = env.parent;
    return env;
  }

  /** The value a `$each!` item gave under its `$as` name. */
  given(owner: MapNode): unknown {
    for (let env: Env | undefined = this; env; env = env.parent) if (env.owner === owner) return env.value;
    return null;
  }
}

/** One call of `resolve`: all variables in, all values out. Each formula is computed when first read, once. */
export class Resolution {
  private readonly scope: Scope;
  private readonly top = new Env();
  private readonly vars: Record<string, unknown>;
  /** The values of marker results that a formula read: a boolean as it is, else their text, with "1" as true and "0" as false. */
  private readonly read = new Map<Entry, unknown>();
  private readonly definitions = new Map<Entry, FeelResult>();
  private readonly defining = new Set<Entry>();
  private readonly guards = new Map<string, unknown>();
  private readonly documents = new Map<string, unknown>();
  /** Imported or passed functions that returned a promise during the formula being computed. */
  private readonly promised: string[] = [];
  private readonly broken: Problem[] = [];
  private readonly afterwards: (() => void)[] = [];

  constructor(
    private readonly source: Source,
    private readonly imports: Map<string, Imported>,
    private readonly input: Record<string, unknown>,
    private readonly functions: Record<string, unknown> = {},
  ) {
    this.scope = new Scope(source);
    const { values, missing, mismatches } = source.variables.values(input);
    this.vars = values;
    const at = source.root.get('$vars') ?? source.root;
    if (missing.length > 0) this.fail(at, `missing required variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
    if (mismatches.length > 0) this.fail(at, mismatches.join('; '));
    const wrong = [...source.hosted.values()].map((hosted) => hosted.mismatch(functions[hosted.name])).filter((why) => why !== undefined);
    if (wrong.length > 0) this.fail(source.root.get('$functions') ?? source.root, wrong.join('; '));
  }

  /** The whole file as plain data: no formulas left, structure keywords applied. */
  run(): Record<string, unknown> {
    const result = this.output(this.source.root, this.top) as Record<string, unknown>;
    if (this.broken.length > 0) throw new ResolveFailed(this.broken);
    for (const settle of this.afterwards) settle();
    return result;
  }

  /** The file as a formula of another file sees it: a node with `$value` is that value. */
  view(): unknown {
    return this.viewOf(this.source.root, this.top);
  }

  /**
   * Computes a key under `expect` in `$tests`: a path to a key of the file as problems name it, which may
   * hold ids with a dash (`stages.write-plan.when`), or else one more formula at the top of the file.
   */
  probe(source: string): unknown {
    const [head, ...path] = source.split('.');
    const start = this.effective(this.source.root, this.top).find((entry) => entry.name === head);
    if (start && !start.key.keyword) {
      const reach = this.scope.walk(start, path, (map, name) => this.effective(map, this.top).find((entry) => entry.name === name));
      if (reach.rest.length === 0) return reach.entry ? this.entryView(reach.entry, this.top) : this.viewOf(reach.node, this.top);
    }
    const formula = new Formula(source);
    const reader = new ScalarNode(this.source.file, 0, 0, source, source);
    reader.parent = this.source.root;
    reader.path = () => source;
    if (formula.errors.length > 0) this.fail(reader, formula.errors[0]!);
    return this.evaluate(formula.formulas[0]!, reader, this.top);
  }

  // ── the result ──

  private output(node: Node, env: Env): unknown {
    if (node.expression) return this.compute(node, env);
    if (node instanceof ListNode) return this.items(node, env).map(([item, own]) => this.output(item, own));
    if (!(node instanceof MapNode)) return (node as ScalarNode).value;
    const out: Record<string, unknown> = {};
    for (const entry of this.effective(node, env)) {
      const name = entry.name;
      if (entry.key.keyword && name !== '$value') continue;
      if (entry.key.kind === 'marked') {
        out[name] = entry.marked?.value;
        this.afterwards.push(() => {
          if (this.read.has(entry)) out[name] = this.read.get(entry);
        });
      } else if (!(entry.value instanceof MapNode) || this.kept(entry.value, env)) {
        out[name] = this.output(entry.value, env);
      }
    }
    this.checkRules(node, env);
    return out;
  }

  // ── what a formula sees ──

  private viewOf(node: Node, env: Env): unknown {
    if (node.expression) return this.compute(node, env);
    if (node instanceof ListNode) return this.items(node, env).map(([item, own]) => this.viewOf(item, own));
    if (!(node instanceof MapNode)) return (node as ScalarNode).value;
    const value = node.get('$value');
    if (value) return this.entryView(value, env);
    const out: Record<string, unknown> = {};
    for (const entry of this.effective(node, env)) {
      if (entry.key.keyword) continue;
      if (!(entry.value instanceof MapNode) || entry.key.kind !== 'plain' || this.kept(entry.value, env)) out[entry.name] = this.entryView(entry, env);
    }
    return out;
  }

  private entryView(entry: Entry, env: Env): unknown {
    return entry.key.kind === 'marked' ? this.markerValue(entry) : this.viewOf(entry.value, env);
  }

  /** A marker's result as a formula reads it: a boolean, or its toString(), where "1" is true and "0" is false. Asked once. */
  private markerValue(entry: Entry): unknown {
    if (this.read.has(entry)) return this.read.get(entry);
    const raw = entry.marked?.value;
    let value: unknown = null;
    if (typeof raw === 'boolean') {
      value = raw;
    } else if (raw !== null && raw !== undefined) {
      let text: string;
      try {
        text = String(raw);
      } catch (error) {
        this.fail(entry, `toString() of the value of the marker "${entry.key.marker}" failed: ${(error as Error).message}`);
      }
      value = text === '1' ? true : text === '0' ? false : text;
    }
    this.read.set(entry, value);
    return value;
  }

  // ── structure: $if, $unless, $each, $when ──

  private kept(node: Node, env: Env): boolean {
    if (!(node instanceof MapNode)) return true;
    const condition = node.get('$if');
    const exception = node.get('$unless');
    if (condition && !this.flag(condition, env)) return false;
    return !(exception && this.flag(exception, env));
  }

  private flag(entry: Entry, env: Env): boolean {
    const value = this.compute(entry.value, env);
    if (typeof value !== 'boolean') this.fail(entry, `${entry.name} must be true or false; it is ${JSON.stringify(value) ?? typeof value}. FEEL has no truthiness: compare, for example "x != null"`);
    return value;
  }

  /** The items of a list as they are in the result: `$each!` repeated, `$if!` and `$unless!` applied. */
  private items(list: ListNode, from: Env): [Node, Env][] {
    const env = from.for(list);
    let items = env.lists.get(list);
    if (items) return items;
    env.lists.set(list, (items = []));
    for (const item of list.items) {
      const each = item instanceof MapNode ? item.get('$each') : undefined;
      if (!each) {
        if (this.kept(item, env)) items.push([item, env]);
        continue;
      }
      const values = this.compute(each.value, env);
      if (!Array.isArray(values)) this.fail(each, `$each needs a list; it is ${JSON.stringify(values) ?? typeof values}`);
      for (const value of values) {
        const own = new Env(item as MapNode, value, env);
        if (this.kept(item, own)) items.push([item, own]);
      }
    }
    return items;
  }

  /** The entries of a map after its `$when` cases: every case that matches applies, in order; `$else` when none did. */
  private effective(map: MapNode, from: Env): Entry[] {
    const top = map === this.source.root;
    if (!map.get('$when')) return top ? this.source.data : map.entries;
    const env = from.for(map);
    let entries = env.maps.get(map);
    if (entries) return entries;
    const byName = new Map<string, Entry>();
    for (const entry of top ? this.source.data : map.entries) if (entry.name !== '$when') byName.set(entry.name, entry);
    let matched = false;
    for (const item of map.cases()) {
      const applies = item.get('$else') ? !matched : this.kept(item, env);
      if (!applies) continue;
      if (!item.get('$else')) matched = true;
      for (const entry of item.entries) if (!entry.key.keyword) byName.set(entry.name, entry);
    }
    env.maps.set(map, (entries = [...byName.values()]));
    return entries;
  }

  /** The rules of a schema, checked on one item. A marked field is seen as written: its function's result is not asked. */
  private checkRules(map: MapNode, env: Env): void {
    if (!map.shape || map.shape.rules.length === 0) return;
    const context: Record<string, unknown> = {};
    const entries = this.effective(map, env);
    for (const name of map.shape.fields.keys()) {
      const entry = entries.find((candidate) => candidate.name === name);
      context[name] = !entry ? null : entry.key.kind === 'marked' ? entry.value.toData() : this.entryView(entry, env);
    }
    for (const rule of map.shape.rules) {
      const failure = rule.failure(context);
      if (failure) this.broken.push(this.problem(map, failure));
    }
  }

  // ── formulas ──

  private compute(node: Node, from: Env): unknown {
    const env = from.for(node);
    if (env.values.has(node)) return env.values.get(node);
    if (env.open.has(node)) this.fail(node.entry ?? node, 'reads itself, directly or through other keys');
    env.open.add(node);
    try {
      const expression = node.expression!;
      const value = expression instanceof Text ? expression.render((block) => this.evaluate(block.formula, node, env)) : this.evaluate(expression.formulas[0]!, node, env);
      env.values.set(node, value);
      return value;
    } finally {
      env.open.delete(node);
    }
  }

  /** Computes one formula. Any warning of `feelin` is an error, except reading a field of null. */
  private evaluate(formula: LazyFormula, reader: Node, env: Env): unknown {
    const at = reader.entry ?? reader;
    const result = this.feel(formula, reader, env);
    const warnings = [...result.warnings];
    for (const [entry, definition] of this.definitions) {
      warnings.push(...definition.warnings.map((warning) => ({ ...warning, message: `in the function "${entry.name}": ${warning.message}` })));
      definition.warnings.length = 0;
    }
    if (this.promised.length > 0) {
      const names = this.promised.splice(0).join(', ');
      this.fail(at, `the function "${names}" returned a promise; a formula cannot wait, so imported and passed functions must be synchronous`);
    }
    const real = warnings.filter((warning) => !(warning.type === 'NO_PROPERTY_FOUND' && warning.details.values.target === null));
    if (real.length > 0) this.fail(at, [...new Set(real.map((warning) => warning.message))].join('; '));
    return result.value;
  }

  /** Hands one formula to `feelin`, with a context that holds exactly what the formula reads. */
  private feel(formula: LazyFormula, reader: Node, env: Env): FeelResult {
    const context = this.context(formula, reader, env);
    try {
      return evaluate(formula.source, context);
    } catch (error) {
      if (error instanceof ScriptedYamlError) throw error;
      this.fail(reader.entry ?? reader, (error as Error).message);
    }
  }

  private context(formula: LazyFormula, reader: Node, env: Env): Record<string, unknown> {
    const context: Record<string, unknown> = {};
    const keys: { names: string[]; value: () => unknown }[] = [];
    for (const ref of formula.refs) {
      const target = this.scope.resolve(reader, ref);
      if (target.kind === 'vars') {
        const bag = (context.vars ??= {}) as Record<string, unknown>;
        if (ref.path[0] === undefined) Object.assign(bag, this.vars);
        else bag[ref.path[0]] = this.vars[ref.path[0]] ?? null;
      } else if (target.kind === 'each') {
        context[ref.head] = env.given(target.owner);
      } else if (target.kind === 'given') {
        if (!(ref.head in context)) context[ref.head] = null;
      } else if (target.kind === 'base') {
        context.base = this.entryView(target.entry, env);
      } else if (target.kind === 'function') {
        context[ref.head] = this.definition(target.entry).value;
      } else if (target.kind === 'hosted') {
        context[ref.head] = this.guarded(ref.head, this.functions[ref.head]);
      } else if (target.kind === 'import') {
        context[ref.head] = this.imported(ref.head, ref.call);
      } else if (target.kind === 'key' && !(ref.inFilter && target.entry.value === reader)) {
        const reach = this.scope.walk(target.entry, ref.path, (map, name) => this.effective(map, env).find((entry) => entry.name === name));
        keys.push({ names: [ref.head, ...reach.steps], value: () => (reach.entry ? this.entryView(reach.entry, env) : this.viewOf(reach.node, env)) });
      }
    }
    // Shorter paths first: a whole map, once placed, already holds what a longer path into it would add.
    keys.sort((a, b) => a.names.length - b.names.length);
    const shells = new WeakSet<object>();
    for (const key of keys) {
      let holder = context;
      let covered = false;
      for (const name of key.names.slice(0, -1)) {
        if (!(name in holder)) shells.add((holder[name] = {}));
        const next = holder[name];
        if (next === null || typeof next !== 'object' || !shells.has(next)) {
          covered = true;
          break;
        }
        holder = next as Record<string, unknown>;
      }
      const last = key.names.at(-1)!;
      if (!covered && !(last in holder)) holder[last] = key.value();
    }
    return context;
  }

  /** A function of `$functions`, as the FEEL function `feelin` makes of it. Its warnings arrive later, when it is called. */
  private definition(entry: Entry): FeelResult {
    let definition = this.definitions.get(entry);
    if (definition) return definition;
    if (this.defining.has(entry)) this.fail(entry, `the function "${entry.name}" calls itself, directly or through other functions`);
    this.defining.add(entry);
    try {
      definition = this.feel(entry.value.expression!.formulas[0]!, entry.value, this.top);
    } finally {
      this.defining.delete(entry);
    }
    this.definitions.set(entry, definition);
    return definition;
  }

  /** An imported name. A function that is called is watched: it may not return a promise. */
  private imported(name: string, called: boolean): unknown {
    const imported = this.imports.get(name);
    if (!imported) return null;
    if (imported.document) {
      if (!this.documents.has(name)) this.documents.set(name, (imported.value as Document).view(this.input, this.functions));
      return this.documents.get(name);
    }
    const fn = imported.value;
    if (!called || typeof fn !== 'function') return fn;
    return this.guarded(name, fn);
  }

  /** A function that is watched when called: it may not return a promise. */
  private guarded(name: string, fn: unknown): unknown {
    if (typeof fn !== 'function') return fn;
    if (!this.guards.has(name)) {
      this.guards.set(name, (...args: unknown[]) => {
        const result = fn(...args);
        if (result !== null && typeof result === 'object' && typeof (result as { then?: unknown }).then === 'function') this.promised.push(name);
        return result;
      });
    }
    return this.guards.get(name);
  }

  // ── failures ──

  private problem(at: Located, message: string): Problem {
    return new Problem(at.file, at.line, at.column, at.path(), message);
  }

  private fail(at: Located, message: string): never {
    throw new ResolveFailed([this.problem(at, message)]);
  }
}
