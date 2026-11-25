import { Formula, Text } from './expression.js';
import { Builtins } from './builtins.js';
import { LazyFormula, type Ref } from './lazy-formula.js';
import { type Entry, ListNode, MapNode, type Node, ScalarNode } from './node.js';
import type { Located, Problems } from './problem.js';
import { type Reach, Scope } from './scope.js';
import { Source } from './source.js';

/** Suggests the name that was probably meant. */
class Hint {
  static for(name: string, candidates: string[], otherwise = ''): string {
    if (candidates.some((candidate) => candidate.startsWith(`${name}-`) || candidate.endsWith(`-${name}`))) {
      return '; a key with a dash cannot be read by a formula: name it with an underscore';
    }
    const close = candidates.find((candidate) => candidate !== name && Hint.distance(name, candidate) <= Math.max(1, Math.floor(name.length / 3)));
    return close ? `; did you mean "${close}"?` : otherwise;
  }

  /** The number of letters to change, add or drop to turn one word into the other. */
  private static distance(a: string, b: string): number {
    let row = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      row = next;
    }
    return row[b.length]!;
  }
}

/** Validates one source: SPEC 7.2. It runs no marker function and no import, and computes no formula of the file. */
export class Checker {
  private static readonly structure = ['$value', '$if', '$unless', '$each', '$as', '$when', '$else'];
  private static readonly conditions = ['$if', '$unless', '$each'];
  private static readonly patching = ['$replace', '$before', '$after', '$add', '$remove'];

  private readonly scope: Scope;
  /** Every node that holds a formula or a text template. */
  private readonly computed: Node[] = [];
  private readonly undeclared = new Set<string>();

  constructor(
    private readonly source: Source,
    private readonly markers: string[],
    private readonly problems: Problems,
    /** Markers whose value is checked like any value. */
    private readonly computedMarkers: ReadonlySet<string> = new Set(),
  ) {
    this.scope = new Scope(source);
  }

  run(): void {
    this.checkMap(this.source.root, true);
    for (const entry of this.source.functions.values()) this.formula(entry);
    this.checkFunctionNames();
    if (this.source.schema && this.source.data.length > 0) this.source.schema.check(this.source.root, this.problems);
    for (const node of this.computed) this.checkNames(node);
    this.checkCycles();
  }

  // ── keys, keywords, markers, syntax ──

  private checkMap(map: MapNode, root = false): void {
    const seen = new Map<string, Entry>();
    for (const entry of map.entries) {
      const first = seen.get(entry.name);
      if (first) this.problems.error(entry, `"${first.key.raw}" and "${entry.key.raw}" are the same key "${entry.name}": keep one`);
      seen.set(entry.name, entry);
      if (root && Source.rootKeywords.includes(entry.name)) continue;
      if (entry.key.keyword && !this.keyword(entry)) continue;
      this.checkEntry(entry);
    }
  }

  /** True when the `$` key is a word of the language that may stand here. */
  private keyword(entry: Entry): boolean {
    const name = entry.name;
    if (Source.rootKeywords.includes(name)) this.problems.error(entry, `${name} belongs at the top of the file`);
    else if (Checker.patching.includes(name)) this.problems.error(entry, `${name} changes a base file: it needs $extends at the top of this file`);
    else if (!Checker.structure.includes(name)) this.problems.error(entry, `unknown keyword "${name}"${Hint.for(name, [...Source.rootKeywords, ...Checker.structure])}`);
    else if (Checker.conditions.includes(name) && entry.key.kind !== 'formula') this.problems.error(entry, `${name} is a formula: write "${name}!"`);
    else if (name === '$as' && !(entry.value instanceof ScalarNode && LazyFormula.isName(String(entry.value.value)))) this.problems.error(entry, '$as gives one plain name');
    else if (name === '$when') return this.when(entry);
    else return true;
    return false;
  }

  private when(entry: Entry): boolean {
    const cases = entry.value instanceof ListNode ? entry.value.items : [];
    const fine = entry.key.kind === 'plain' && cases.length > 0 && cases.every((item) => item instanceof MapNode && (item.get('$if') || item.get('$unless') || item.get('$else')));
    if (!fine) this.problems.error(entry, '$when is a list of cases; each case has $if!, $unless! or $else');
    return fine;
  }

  private checkEntry(entry: Entry): void {
    if (entry.base) this.checkEntry(entry.base);
    if (entry.key.kind === 'marked') {
      if (!this.markers.includes(entry.key.marker!)) this.problems.error(entry, `no function is registered for the marker "${entry.key.marker}"`);
      if (this.computedMarkers.has(entry.key.marker!)) this.checkValue(entry.value, entry);
    } else if (entry.key.kind === 'formula') {
      this.formula(entry);
    } else {
      this.checkValue(entry.value, entry);
    }
  }

  private checkValue(node: Node, at: Located): void {
    if (node instanceof MapNode) this.checkMap(node);
    else if (node instanceof ListNode) for (const item of node.items) this.checkValue(item, item);
    else if (node instanceof ScalarNode && Text.in(node.value)) this.expression(node, new Text(node.value), at);
  }

  private formula(entry: Entry): void {
    if (entry.value instanceof ScalarNode) this.expression(entry.value, new Formula(entry.formula ?? entry.value.source), entry);
    else this.problems.error(entry, `"${entry.key.raw}" is a formula, so its value is text; for data, remove the "!"`);
  }

  private expression(node: Node, expression: Formula | Text, at: Located): void {
    node.expression = expression;
    this.computed.push(node);
    for (const error of expression.errors) this.problems.error(at, error);
  }

  /** A function may not have the name of a built-in function, and a key may not have the name of a function. */
  private checkFunctionNames(): void {
    for (const [name, entry] of this.source.functions) {
      if (Builtins.has(name)) this.problems.error(entry, Builtins.taken('function', name));
      if (this.source.imported.has(name)) this.problems.error(entry, `"${name}" is both defined in $functions and imported`);
    }
    for (const [name, hosted] of this.source.hosted) {
      if (Builtins.has(name)) this.problems.error(hosted.entry, Builtins.taken('function', name));
      if (this.source.imported.has(name)) this.problems.error(hosted.entry, `"${name}" is both declared in $functions and imported`);
    }
    for (const [name, spec] of this.source.imported) {
      if (Builtins.has(name)) this.problems.error(spec.entry, Builtins.taken('imported name', name));
    }
    const taken = (entry: Entry) => !entry.key.keyword && (this.source.functions.has(entry.name) || this.source.hosted.has(entry.name) || this.source.imported.has(entry.name));
    const visit = (node: Node): void => {
      if (node instanceof ListNode) node.items.forEach(visit);
      if (!(node instanceof MapNode)) return;
      for (const entry of node.entries) {
        if (taken(entry)) this.problems.error(entry, `the key "${entry.name}" has the name of a function of this file; rename one of them`);
        if (entry.key.kind === 'plain') visit(entry.value);
      }
    };
    for (const entry of this.source.data) {
      if (taken(entry)) this.problems.error(entry, `the key "${entry.name}" has the name of a function of this file; rename one of them`);
      if (entry.key.kind === 'plain') visit(entry.value);
    }
  }

  // ── names ──

  private at(node: Node): Located {
    return node.entry ?? node;
  }

  private checkNames(node: Node): void {
    const expression = node.expression!;
    const reads = new Set<string>();
    const reaches: { ref: Ref; reach: Reach }[] = [];
    for (const formula of expression.formulas) {
      const called = new Set<string>();
      const keys = new Set<string>();
      for (const ref of formula.refs) {
        const reach = this.checkRef(node, ref);
        if (reach === false) continue;
        if (!ref.call) reads.add(ref.name);
        if (reach === true && ref.call && Builtins.has(ref.head)) called.add(ref.head);
        if (reach !== true) {
          reaches.push({ ref, reach });
          keys.add(ref.head);
        }
      }
      // `feelin` holds one value per name: the key and the function cannot both be given to one formula.
      for (const name of called) if (keys.has(name)) this.problems.error(this.at(node), Builtins.clash(name));
    }
    expression.reads = [...reads];
    this.checkOverlap(node, reaches);
  }

  /** Reports what is wrong with one name. False when it names nothing; a Reach when it names a key. */
  private checkRef(node: Node, ref: Ref): Reach | boolean {
    const target = this.scope.resolve(node, ref);
    if (target.kind === 'unknown') {
      if (ref.inFilter) return false;
      const what = ref.call ? 'unknown function' : 'unknown name';
      this.problems.error(this.at(node), `${what} "${ref.head}"${Hint.for(ref.head, this.scope.names(node), ref.call ? '' : '; for text, remove the "!"')}`);
      return false;
    }
    if (target.kind === 'vars') {
      const name = ref.path[0];
      if (name !== undefined && !this.source.variables.knows(name) && !this.undeclared.has(name)) {
        this.undeclared.add(name);
        this.problems.warning(this.at(node), `the variable "${name}" is not declared in $vars; it is null unless the application passes it`);
      }
      return true;
    }
    if (target.kind !== 'key') return true;
    if (ref.inFilter && target.entry.value === node) return false;
    const reach = this.scope.walk(target.entry, ref.path);
    if (reach.missing) {
      const keys = reach.missing.map.entries.map((entry) => entry.name);
      this.problems.error(this.at(node), `"${ref.name}": there is no key "${reach.missing.name}" in "${reach.missing.map.path()}"${Hint.for(reach.missing.name, keys)}`);
    }
    return reach;
  }

  /**
   * One formula cannot read a node as a value and also a key beside that value: FEEL is handed one
   * thing under one name. So `local` (its $value) and `local.message` cannot be in the same formula.
   */
  private checkOverlap(node: Node, reaches: { ref: Ref; reach: Reach }[]): void {
    for (const short of reaches) {
      for (const long of reaches) {
        if (short.ref.head !== long.ref.head || short.reach.steps.length >= long.reach.steps.length) continue;
        if (short.reach.rest.length > 0 || !short.reach.steps.every((step, index) => long.reach.steps[index] === step)) continue;
        const crossed = long.reach.nodes.slice(short.reach.steps.length, -1);
        if (!crossed.some((passed) => passed instanceof ListNode || (passed instanceof MapNode && passed.get('$value')))) continue;
        const shorter = [short.ref.head, ...short.reach.steps].join('.');
        this.problems.error(this.at(node), `one formula reads "${shorter}" as a value and "${long.ref.name}" inside it; read one of them through a key of its own`);
        return;
      }
    }
  }

  // ── cycles ──

  /** The computed nodes a node needs before it can be computed. */
  private needs(node: Node): Node[] {
    const needs: Node[] = [];
    for (const formula of node.expression!.formulas) {
      for (const ref of formula.refs) {
        const target = this.scope.resolve(node, ref);
        if (target.kind === 'function') needs.push(target.entry.value);
        if (target.kind === 'base') this.under(target.entry, target.entry.value, needs);
        if (target.kind !== 'key' || (ref.inFilter && target.entry.value === node)) continue;
        const reach = this.scope.walk(target.entry, ref.path);
        this.under(reach.entry, reach.node, needs);
      }
    }
    return needs;
  }

  /** Every computed node that reading a node asks for. */
  private under(entry: Entry | undefined, node: Node, into: Node[]): void {
    if (entry?.key.kind === 'marked') return;
    if (node.expression) into.push(node);
    if (node instanceof ListNode) for (const item of node.items) this.under(undefined, item, into);
    if (!(node instanceof MapNode)) return;
    const value = node.get('$value');
    for (const child of value ? [value] : node.entries) this.under(child, child.value, into);
  }

  private checkCycles(): void {
    const state = new Map<Node, 'open' | 'done'>();
    const reported = new Set<Node>();
    const visit = (node: Node): void => {
      if (state.get(node) === 'done' || !node.expression) return;
      if (state.get(node) === 'open') {
        if (!reported.has(node)) this.problems.error(this.at(node), 'reads itself, directly or through other keys');
        reported.add(node);
        return;
      }
      state.set(node, 'open');
      for (const next of this.needs(node)) visit(next);
      state.set(node, 'done');
    };
    for (const node of this.computed) visit(node);
  }
}
