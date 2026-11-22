import { Builtins } from './builtins.js';
import type { Ref } from './lazy-formula.js';
import type { ImportSpec } from './importers.js';
import { type Entry, ListNode, MapNode, type Node } from './node.js';
import { Source } from './source.js';

/** What a name in a formula stands for. */
export type Target =
  | { kind: 'unknown' }
  | { kind: 'builtin' }
  /** `vars`: the variables the application passes. */
  | { kind: 'vars' }
  /** The `$as` name of a `$each!` item. */
  | { kind: 'each'; owner: MapNode }
  /** A name a schema says the application supplies (`with`). */
  | { kind: 'given' }
  /** `base` in a patch: the entry that was replaced. */
  | { kind: 'base'; entry: Entry }
  | { kind: 'function'; entry: Entry }
  /** A function of `$functions` that the application passes. */
  | { kind: 'hosted'; name: string }
  | { kind: 'import'; spec: ImportSpec }
  /** A key of the file. */
  | { kind: 'key'; entry: Entry };

/** How far a path such as `stages.explore.when` goes through the file before a value takes over. */
export class Reach {
  /** The path names that were followed through maps and lists of the file. */
  readonly steps: string[] = [];
  /** The node reached after each step; the first is the value of the head key. */
  readonly nodes: Node[] = [];
  /** A path name that is not a key of the map it was looked up in. */
  missing?: { name: string; map: MapNode };

  constructor(
    public entry: Entry | undefined,
    public node: Node,
    readonly path: string[],
  ) {
    this.nodes.push(node);
  }

  /** The path names left for FEEL to follow inside the value. */
  get rest(): string[] {
    return this.path.slice(this.steps.length);
  }
}

/** Finds what a name means at a place in the file (SPEC 3.4). */
export class Scope {
  constructor(private readonly source: Source) {}

  resolve(reader: Node, ref: Ref): Target {
    const chain = [reader, ...reader.ancestors()];
    for (const node of chain) {
      if (node instanceof MapNode && node.get('$each') && reader.entry !== node.get('$each') && ref.head === Scope.eachName(node)) return { kind: 'each', owner: node };
      if (node.entry?.map.shape?.with[node.entry.name]?.includes(ref.head)) return { kind: 'given' };
    }
    if (ref.head === 'vars') return { kind: 'vars' };
    const replaced = chain.find((node) => node.entry?.base)?.entry?.base;
    if (ref.head === 'base' && replaced) return { kind: 'base', entry: replaced };

    const called = ref.call ? this.callable(ref.head) : undefined;
    if (called) return called;
    for (const map of this.maps(reader)) {
      const entry = map.find(ref.head);
      if (entry && !entry.key.keyword) return { kind: 'key', entry };
    }
    return this.callable(ref.head, ref.call) ?? { kind: 'unknown' };
  }

  /** Follows a path from a key through the maps and lists of the file. `find` picks a key of a map. */
  walk(start: Entry, path: string[], find: (map: MapNode, name: string) => Entry | undefined = (map, name) => map.find(name)): Reach {
    const reach = new Reach(start, start.value, path);
    for (const name of path) {
      if (reach.entry && reach.entry.key.kind !== 'plain') break;
      const node = reach.node;
      if (node instanceof MapNode) {
        const next = find(node, name);
        if (!next || next.key.keyword) {
          if (!node.get('$value')) reach.missing = { name, map: node };
          break;
        }
        reach.entry = next;
        reach.node = next.value;
      } else if (node instanceof ListNode) {
        const item = node.byId(name);
        if (!item) break;
        reach.entry = undefined;
        reach.node = item;
      } else {
        break;
      }
      reach.steps.push(name);
      reach.nodes.push(reach.node);
    }
    return reach;
  }

  /** The names a formula at this place could have meant, for "did you mean". */
  names(reader: Node): string[] {
    const keys = this.maps(reader).flatMap((map) => map.entries.filter((entry) => !entry.key.keyword).map((entry) => entry.name));
    return ['vars', ...keys, ...this.source.functions.keys(), ...this.source.hosted.keys(), ...this.source.imported.keys()];
  }

  /** The name a `$each!` item gives each value: its `$as`, or `item`. */
  static eachName(item: MapNode): string {
    return String(item.scalar('$as') ?? 'item');
  }

  private callable(name: string, builtins = true): Target | undefined {
    const defined = this.source.functions.get(name);
    if (defined) return { kind: 'function', entry: defined };
    if (this.source.hosted.has(name)) return { kind: 'hosted', name };
    const spec = this.source.imported.get(name);
    if (spec) return { kind: 'import', spec };
    return builtins && Builtins.has(name) ? { kind: 'builtin' } : undefined;
  }

  /** The maps a bare name is looked up in: the one around the formula, each enclosing one, the root. */
  private maps(reader: Node): MapNode[] {
    const top = [reader, ...reader.ancestors()].find((node) => node.parent === this.source.root);
    if (top?.entry && Source.rootKeywords.includes(top.entry.name)) return [this.source.root];
    return reader.ancestors().filter((node): node is MapNode => node instanceof MapNode);
  }
}
