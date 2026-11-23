import type { Expression } from './expression.js';
import type { Located } from './problem.js';
import type { Shape } from './schema.js';
import { put } from './own.js';

/** A key as written, split at its last `!` into a name and a marker. */
export class Key {
  readonly name: string;
  /** undefined: plain key. '': a formula. Anything else: the name of a marker. */
  readonly marker: string | undefined;

  constructor(readonly raw: string) {
    const at = raw.lastIndexOf('!');
    this.name = at < 0 ? raw : raw.slice(0, at);
    this.marker = at < 0 ? undefined : raw.slice(at + 1);
  }

  get kind(): 'plain' | 'formula' | 'marked' {
    if (this.marker === undefined) return 'plain';
    return this.marker === '' ? 'formula' : 'marked';
  }

  get keyword(): boolean {
    return this.name.startsWith('$');
  }
}

/** The key of a function: `from_gear(wanted)` is the name `from_gear` and the parameter `wanted`. */
export class Signature {
  readonly name: string;
  /** undefined when the key has no brackets: the value is then a whole FEEL `function(…) …`. */
  readonly parameters: string[] | undefined;

  constructor(key: string) {
    const open = key.indexOf('(');
    const short = open > 0 && key.endsWith(')');
    this.name = short ? key.slice(0, open).trim() : key;
    this.parameters = short
      ? key.slice(open + 1, -1).split(',').map((parameter) => parameter.trim()).filter((parameter) => parameter !== '')
      : undefined;
  }

  /** The FEEL function definition for a body written without one. */
  define(body: string): string {
    return `function(${this.parameters!.join(', ')}) ${body}`;
  }
}

/** A value in the file, with the place it was written. */
export abstract class Node implements Located {
  /** The map or list that holds this node. */
  parent?: Node;
  /** The entry this node is the value of, when it sits in a map. */
  entry?: Entry;
  /** The formula or text template this node holds, set when the file is checked. */
  expression?: Expression;

  constructor(
    readonly file: string,
    readonly line: number,
    readonly column: number,
  ) {}

  /** Plain data, keys as written. */
  abstract toData(): unknown;

  /** A copy that shares nothing with this node. */
  abstract clone(): Node;

  path(): string {
    if (this.entry) return this.entry.path();
    if (this.parent instanceof ListNode) return `${this.parent.path()}${this.parent.label(this)}`;
    return '';
  }

  within(ancestor: Node): boolean {
    for (let node: Node | undefined = this; node; node = node.parent) if (node === ancestor) return true;
    return false;
  }

  ancestors(): Node[] {
    const list: Node[] = [];
    for (let node = this.parent; node; node = node.parent) list.push(node);
    return list;
  }
}

export class ScalarNode extends Node {
  constructor(
    file: string,
    line: number,
    column: number,
    readonly value: unknown,
    /** The value as text, as written: `2` stays "2". */
    readonly source: string,
  ) {
    super(file, line, column);
  }

  toData(): unknown {
    return this.value;
  }

  clone(): ScalarNode {
    return new ScalarNode(this.file, this.line, this.column, this.value, this.source);
  }
}

/** One `key: value` of a map. */
export class Entry implements Located {
  readonly key: Key;
  /** In a patch, the entry this one replaced: `base` in its formulas. */
  base?: Entry;
  /** What the marker function returned, once the file is loaded. */
  marked?: { value: unknown };
  /** The formula as `feelin` gets it, when that is not the text written: a function whose parameters are in its key. */
  formula?: string;

  constructor(
    raw: string,
    readonly value: Node,
    readonly map: MapNode,
    readonly file: string,
    readonly line: number,
    readonly column: number,
  ) {
    this.key = new Key(raw);
    value.entry = this;
    value.parent = map;
  }

  get name(): string {
    return this.key.name;
  }

  path(): string {
    const before = this.map.path();
    return before === '' ? this.key.raw : `${before}.${this.key.raw}`;
  }
}

export class MapNode extends Node {
  readonly entries: Entry[] = [];
  /** The shape of the schema this map was checked against. */
  shape?: Shape;

  /** Entries by name, the first of each name; rebuilt when the entries change. */
  private index?: Map<string, Entry>;
  private indexed = -1;

  /** The entry with this name, whatever its marker. */
  get(name: string): Entry | undefined {
    if (!this.index || this.indexed !== this.entries.length) {
      this.index = new Map();
      for (const entry of this.entries) if (!this.index.has(entry.name)) this.index.set(entry.name, entry);
      this.indexed = this.entries.length;
    }
    return this.index.get(name);
  }

  /** Like `get`, and also a key that only a `$when` case adds. */
  find(name: string): Entry | undefined {
    const own = this.get(name);
    if (own) return own;
    for (const item of this.cases()) {
      const added = item.get(name);
      if (added) return added;
    }
    return undefined;
  }

  /** The cases of this map's `$when`. */
  cases(): MapNode[] {
    const when = this.get('$when')?.value;
    if (!(when instanceof ListNode)) return [];
    return when.items.filter((item): item is MapNode => item instanceof MapNode);
  }

  /** A plain value of this map, such as its `id`. */
  scalar(name: string): unknown {
    const entry = this.get(name);
    return entry?.key.kind === 'plain' && entry.value instanceof ScalarNode ? entry.value.value : undefined;
  }

  /** Adds an entry. `at` is its position; the end when omitted. */
  set(raw: string, value: Node, from: Located, at?: number): Entry {
    const entry = new Entry(raw, value, this, from.file, from.line, from.column);
    if (at === undefined) this.entries.push(entry);
    else this.entries.splice(at, 0, entry);
    this.index = undefined;
    return entry;
  }

  remove(entry: Entry): void {
    this.entries.splice(this.entries.indexOf(entry), 1);
    this.index = undefined;
  }

  toData(): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const entry of this.entries) put(data, entry.key.raw, entry.value.toData());
    return data;
  }

  clone(): MapNode {
    const copy = new MapNode(this.file, this.line, this.column);
    for (const entry of this.entries) copy.set(entry.key.raw, entry.value.clone(), entry);
    return copy;
  }
}

export class ListNode extends Node {
  readonly items: Node[] = [];
  /** The field that names an item: `id`, unless a schema says otherwise. */
  keyField = 'id';

  add(item: Node, at?: number): void {
    item.parent = this;
    if (at === undefined) this.items.push(item);
    else this.items.splice(at, 0, item);
  }

  byId(id: string): MapNode | undefined {
    return this.items.find((item): item is MapNode => item instanceof MapNode && String(item.scalar(this.keyField)) === id && item.scalar(this.keyField) !== undefined);
  }

  /** How an item is named in a path: `.explore` by id, `[2]` by position. */
  label(item: Node): string {
    const id = item instanceof MapNode ? item.scalar(this.keyField) : undefined;
    return id === undefined ? `[${this.items.indexOf(item) + 1}]` : `.${String(id)}`;
  }

  toData(): unknown[] {
    return this.items.map((item) => item.toData());
  }

  clone(): ListNode {
    const copy = new ListNode(this.file, this.line, this.column);
    copy.keyField = this.keyField;
    for (const item of this.items) copy.add(item.clone());
    return copy;
  }
}
