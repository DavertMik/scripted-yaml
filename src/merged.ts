import { Entry, ListNode, MapNode, type Node } from './node.js';
import type { Problems } from './problem.js';
import { Scope } from './scope.js';
import type { Source } from './source.js';

/** `document.merged()`: where a formula reads `base`, the replaced entry is kept under `$base`. */
export class MergedForm {
  static readonly keyword = '$base';

  constructor(private readonly problems: Problems) {}

  static write(source: Source): Record<string, unknown> {
    const scope = new Scope(source);
    const reads = (entry: Entry): boolean => MergedForm.readsBase(scope, entry);
    return MergedForm.map(source.root, reads);
  }

  restore(node: Node): void {
    if (node instanceof ListNode) for (const item of node.items) this.restore(item);
    if (!(node instanceof MapNode)) return;
    for (const entry of node.entries) if (entry.name !== MergedForm.keyword) this.restore(entry.value);
    const kept = node.get(MergedForm.keyword);
    if (!kept) return;
    node.remove(kept);
    this.attach(node, kept, (name) => node.get(name));
  }

  private attach(holder: MapNode, kept: Entry, find: (name: string) => Entry | undefined): void {
    if (!(kept.value instanceof MapNode)) return this.problems.error(kept, `${MergedForm.keyword} holds the replaced entries of its map, by name`);
    const bases = new Map<string, Entry>();
    for (const item of kept.value.entries) {
      if (item.name === MergedForm.keyword) continue;
      const target = find(item.name);
      if (!target) {
        this.problems.error(item, `"${item.name}" of ${MergedForm.keyword} is the base of no entry beside it`);
        continue;
      }
      this.restore(item.value);
      target.base = new Entry(item.key.raw, item.value, holder, item.file, item.line, item.column);
      bases.set(item.name, target.base);
    }
    const deeper = kept.value.get(MergedForm.keyword);
    if (deeper) this.attach(holder, deeper, (name) => bases.get(name));
  }

  private static map(map: MapNode, reads: (entry: Entry) => boolean): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    const bases: Entry[] = [];
    for (const entry of map.entries) {
      data[entry.key.raw] = MergedForm.node(entry.value, reads);
      if (entry.base && reads(entry)) bases.push(entry.base);
    }
    if (bases.length > 0) data[MergedForm.keyword] = MergedForm.bases(bases, reads);
    return data;
  }

  private static bases(bases: Entry[], reads: (entry: Entry) => boolean): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    const deeper: Entry[] = [];
    for (const base of bases) {
      data[base.key.raw] = MergedForm.node(base.value, reads);
      if (base.base && reads(base)) deeper.push(base.base);
    }
    if (deeper.length > 0) data[MergedForm.keyword] = MergedForm.bases(deeper, reads);
    return data;
  }

  private static node(node: Node, reads: (entry: Entry) => boolean): unknown {
    if (node instanceof MapNode) return MergedForm.map(node, reads);
    if (node instanceof ListNode) return node.items.map((item) => MergedForm.node(item, reads));
    return node.toData();
  }

  static readsBase(scope: Scope, entry: Entry): boolean {
    const visit = (node: Node): boolean => {
      for (const formula of node.expression?.formulas ?? []) {
        for (const ref of formula.refs) {
          if (ref.head !== 'base') continue;
          const target = scope.resolve(node, ref);
          if (target.kind === 'base' && target.entry === entry.base) return true;
        }
      }
      if (node instanceof ListNode) return node.items.some(visit);
      if (node instanceof MapNode) return node.entries.some((child) => visit(child.value) || (child.base !== undefined && visit(child.base.value)));
      return false;
    };
    return visit(entry.value);
  }
}
