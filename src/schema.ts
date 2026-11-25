import { evaluate } from 'feelin';
import { Formula } from './expression.js';
import { Builtins } from './builtins.js';
import { ListNode, MapNode, type Node, ScalarNode } from './node.js';
import type { Located, Problems } from './problem.js';

/** One word of a schema: `title`, `agents*`, `launch:Look`, `rules*:Rule`. */
export class Field {
  readonly name: string;
  readonly many: boolean;
  readonly type: string | undefined;

  constructor(
    word: string,
    readonly required: boolean,
  ) {
    const colon = word.indexOf(':');
    const name = colon < 0 ? word : word.slice(0, colon);
    this.type = colon < 0 ? undefined : word.slice(colon + 1);
    this.many = name.endsWith('*');
    this.name = this.many ? name.slice(0, -1) : name;
  }
}

/** A check across the fields of one item: `valid!` must be true, or `message` is shown. */
export class Rule {
  readonly formula: Formula;

  constructor(
    source: string,
    readonly message: string,
  ) {
    this.formula = new Formula(source);
  }

  /** The names of fields the rule reads. */
  get reads(): string[] {
    return this.formula.formulas.flatMap((formula) => formula.refs.filter((ref) => !ref.inFilter && !ref.call).map((ref) => ref.head));
  }

  /** True when the rule holds for these values of the fields. */
  holds(fields: Record<string, unknown>): boolean {
    const context = { ...fields };
    for (const formula of this.formula.formulas) for (const ref of formula.refs) if (ref.call) Builtins.provide(context, ref.head);
    try {
      return evaluate(this.formula.source, context).value === true;
    } catch {
      return false;
    }
  }
}

/** The fields a map may have. */
export class Shape {
  readonly fields = new Map<string, Field>();
  readonly rules: Rule[] = [];
  /** The field that names an item of this shape. */
  readonly key: string;
  /** Per field, the names the application supplies when it computes that field. */
  readonly with: Record<string, string[]>;

  constructor(
    readonly name: string,
    data: Record<string, unknown>,
    at: Located,
    problems: Problems,
  ) {
    for (const word of Shape.words(data.required)) this.add(new Field(word, true));
    for (const word of Shape.words(data.optional)) this.add(new Field(word, false));
    this.key = typeof data.key === 'string' ? data.key : 'id';
    this.with = (data.with ?? {}) as Record<string, string[]>;
    for (const rule of Array.isArray(data.rules) ? data.rules : []) this.rule(rule, at, problems);
  }

  static words(list: unknown): string[] {
    return Array.isArray(list) ? list.map(String) : [];
  }

  private add(field: Field): void {
    this.fields.set(field.name, field);
  }

  private rule(data: Record<string, unknown>, at: Located, problems: Problems): void {
    const rule = new Rule(String(data?.['valid!'] ?? ''), String(data?.message ?? 'a rule of the schema is broken'));
    const label = this.name === '' ? 'the schema' : this.name;
    for (const error of rule.formula.errors) problems.error(at, `a rule of ${label}: ${error}`);
    for (const formula of rule.formula.formulas) {
      for (const ref of formula.refs) {
        const known = ref.inFilter || this.fields.has(ref.head) || (ref.call && Builtins.has(ref.head));
        if (!known) problems.error(at, `a rule of ${label} reads "${ref.head}", which is not one of its fields`);
        if (ref.call && Builtins.has(ref.head) && this.fields.has(ref.head)) problems.error(at, `a rule of ${label}: ${Builtins.clash(ref.head)}`);
      }
    }
    this.rules.push(rule);
  }
}

/** A `$schema`: which keys a file has. Short by design: everything is text unless marked. */
export class Schema {
  readonly root: Shape;
  private readonly shapes = new Map<string, Shape>();
  private readonly words = new Map<string, string[]>();

  constructor(node: Node, problems: Problems) {
    const data = (node instanceof MapNode ? node.toData() : {}) as Record<string, unknown>;
    if (!(node instanceof MapNode)) problems.error(node, '$schema must be a map with "required" and "optional"');
    this.root = new Shape('', data, node, problems);
    for (const [name, value] of Object.entries(data)) {
      const first = name.charAt(0);
      if (first === first.toLowerCase()) continue;
      if (Array.isArray(value)) this.words.set(name, value.map(String));
      else this.shapes.set(name, new Shape(name, (value ?? {}) as Record<string, unknown>, node, problems));
    }
    for (const shape of [this.root, ...this.shapes.values()]) {
      for (const field of shape.fields.values()) {
        if (field.type !== undefined && !this.shapes.has(field.type) && !this.words.has(field.type)) problems.error(node, `the schema names the type "${field.type}" and does not define it`);
      }
    }
  }

  /** Checks a file against the schema and notes on each map the shape it has. */
  check(root: MapNode, problems: Problems): void {
    this.fit(root, this.root, problems);
  }

  private fit(map: MapNode, shape: Shape, problems: Problems, named?: string): void {
    map.shape = shape;
    for (const field of shape.fields.values()) {
      if (field.required && !map.get(field.name) && field.name !== named) problems.error(map, `missing required field "${field.name}"`);
    }
    for (const entry of map.entries) {
      const field = shape.fields.get(entry.name);
      if (!field && !entry.key.keyword) problems.warning(entry, `"${entry.name}" is not a field of the schema`);
      if (field && entry.key.kind === 'plain') this.value(entry.value, field, problems);
    }
    this.rules(map, shape, problems);
  }

  /**
   * The rules whose fields are settled when the file is written: no field they read is a formula.
   * Text with `{{ }}` and a marked value are seen as written. The others are checked by `resolve`.
   */
  private rules(map: MapNode, shape: Shape, problems: Problems): void {
    if (map.get('$when')) return;
    for (const rule of shape.rules) {
      const fields: Record<string, unknown> = {};
      const settled = rule.reads.every((name) => {
        const entry = map.get(name);
        fields[name] = entry ? entry.value.toData() : null;
        return !entry || entry.key.kind === 'marked' || (entry.key.kind === 'plain' && Schema.settled(entry.value));
      });
      if (settled && !rule.holds(fields)) problems.error(map, rule.message);
    }
  }

  /** True when a value holds no formula: what is written is what it is. */
  private static settled(node: Node): boolean {
    if (node.expression instanceof Formula) return false;
    if (node instanceof ListNode) return node.items.every(Schema.settled);
    if (node instanceof MapNode) return node.entries.every((entry) => entry.key.kind === 'marked' || (entry.key.kind === 'plain' && Schema.settled(entry.value)));
    return true;
  }

  private value(node: Node, field: Field, problems: Problems): void {
    if (!field.many) return this.one(node, field, problems);
    const shape = field.type === undefined ? undefined : this.shapes.get(field.type);
    if (node instanceof ListNode) {
      if (shape) node.keyField = shape.key;
      for (const item of node.items) this.one(item, field, problems);
    } else if (node instanceof MapNode) {
      for (const entry of node.entries) if (!entry.key.keyword && entry.key.kind === 'plain') this.one(entry.value, field, problems, shape?.key);
    } else {
      problems.error(node, `"${field.name}" takes many values: write a list`);
    }
  }

  private one(node: Node, field: Field, problems: Problems, named?: string): void {
    if (field.type === undefined) return;
    const shape = this.shapes.get(field.type);
    const words = this.words.get(field.type);
    if (shape) {
      if (node instanceof MapNode) this.fit(node, shape, problems, named);
      else problems.error(node, `"${field.name}" must be a map with the fields of ${field.type}`);
    } else if (words) {
      if (node.expression) return;
      const word = node instanceof ScalarNode ? String(node.value) : undefined;
      if (word === undefined || !words.includes(word)) problems.error(node, `"${word ?? field.name}" is not one of: ${words.join(', ')}`);
    }
  }
}
