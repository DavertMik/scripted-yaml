import { type Entry, ListNode, MapNode, type Node, ScalarNode } from './node.js';
import type { Problems } from './problem.js';

/** Applies a file that starts with `$extends` to its base. The base tree is changed in place. */
export class Patch {
  /** Keys of the patch's top level that are merged into the base, not matched against it. */
  private static readonly merged = ['$vars', '$functions', '$import', '$tests', '$schema'];
  private static readonly replaced = ['$dsl'];
  /** The lists of a `$schema` that a patch adds to. */
  private static readonly fieldLists = ['required', 'optional'];

  constructor(
    private readonly patch: MapNode,
    private readonly base: MapNode,
    private readonly problems: Problems,
  ) {}

  apply(): void {
    const changes = new MapNode(this.patch.file, this.patch.line, this.patch.column);
    for (const entry of this.patch.entries) {
      if (entry.name === '$extends') continue;
      if (Patch.merged.includes(entry.name)) this.merge(entry);
      else if (Patch.replaced.includes(entry.name)) this.put(this.base, entry);
      else changes.entries.push(entry);
    }
    this.change(changes, this.base);
  }

  /** Puts an entry of the patch into a base map, in place of the one with its name when there is one. */
  private put(map: MapNode, entry: Entry, base?: Entry): Entry {
    const old = map.get(entry.name);
    const at = old ? map.entries.indexOf(old) : undefined;
    if (old) map.remove(old);
    const added = map.set(entry.key.raw, entry.value, entry, at);
    added.base = base;
    return added;
  }

  private merge(entry: Entry): void {
    const target = this.base.get(entry.name)?.value;
    if (target instanceof MapNode && entry.value instanceof MapNode) for (const item of entry.value.entries) this.mergeItem(target, item, entry.name);
    else if (target instanceof ListNode && entry.value instanceof ListNode) for (const item of entry.value.items) target.add(item);
    else this.put(this.base, entry);
  }

  /** One entry of a merged keyword. The `required` and `optional` lists of a `$schema` grow; everything else is put in place. */
  private mergeItem(target: MapNode, item: Entry, keyword: string): void {
    const old = target.get(item.name)?.value;
    const grows = keyword === '$schema' && Patch.fieldLists.includes(item.name) && old instanceof ListNode && item.value instanceof ListNode;
    if (grows) for (const word of item.value.items) old.add(word);
    else this.put(target, item);
  }

  /** Applies the changes written in one map of the patch to the node of the base they point at. */
  private change(changes: MapNode, target: Node): void {
    for (const entry of changes.entries) {
      switch (entry.key.raw) {
        case '$replace':
          this.replace(entry, target);
          break;
        case '$add':
          this.insert(entry, target, 'end', true);
          break;
        case '$before':
          this.insert(entry, target, 'start', false);
          break;
        case '$after':
          this.insert(entry, target, 'end', false);
          break;
        case '$remove':
          this.remove(entry, target);
          break;
        default:
          this.descend(entry, target);
      }
    }
  }

  private child(target: Node, name: string): Node | undefined {
    if (target instanceof MapNode) return target.get(name)?.value;
    if (target instanceof ListNode) return target.byId(name);
    return undefined;
  }

  private descend(entry: Entry, target: Node): void {
    if (entry.key.keyword) return this.problems.error(entry, `"${entry.key.raw}" cannot be used in a patch here`);
    const child = this.child(target, entry.name);
    if (!child) return this.problems.error(entry, `"${entry.name}" matches nothing in the base; a patch adds with $add, $before or $after`);
    if (entry.key.kind !== 'plain' || !(entry.value instanceof MapNode)) {
      return this.problems.error(entry, `a plain field in a patch does not overwrite; write $replace: { ${entry.key.raw}: … }`);
    }
    if (child.entry && child.entry.key.kind !== 'plain') return this.problems.error(entry, `"${entry.name}" is a formula or a marked key in the base; change it with $replace`);
    this.change(entry.value, child);
  }

  private replace(entry: Entry, target: Node): void {
    if (!(target instanceof MapNode) || !(entry.value instanceof MapNode)) return this.problems.error(entry, '$replace lists fields of a map: $replace: { field: value }');
    for (const field of entry.value.entries) {
      const old = target.get(field.name);
      if (old) this.put(target, field, old);
      else this.problems.error(field, `"${field.name}" does not exist in the base, so it cannot be replaced; add it with $add`);
    }
  }

  private remove(entry: Entry, target: Node): void {
    const names = entry.value instanceof ListNode ? entry.value.toData().map(String) : [String(entry.value.toData())];
    for (const name of names) {
      const child = this.child(target, name);
      if (!child) this.problems.error(entry, `"${name}" does not exist in the base, so it cannot be removed`);
      else if (target instanceof MapNode) target.remove(child.entry!);
      else if (target instanceof ListNode) target.items.splice(target.items.indexOf(child), 1);
    }
  }

  private insert(entry: Entry, target: Node, where: 'start' | 'end', mustBeNew: boolean): void {
    const added = entry.value;
    if (target instanceof ScalarNode) return this.text(entry, target, where);
    if (target instanceof ListNode && !(added instanceof MapNode)) {
      const values = added instanceof ListNode ? added.items : [added];
      values.forEach((value, index) => target.add(value, where === 'start' ? index : undefined));
      return;
    }
    if (!(added instanceof MapNode)) return this.problems.error(entry, `${entry.key.raw} takes a map of new items, each under its name`);

    const beside = !mustBeNew && target instanceof MapNode && target.parent instanceof ListNode ? target.parent : undefined;
    const into = beside ?? target;
    added.entries.forEach((item, index) => {
      if (this.child(into, item.name)) return this.problems.error(item, `"${item.name}" already exists in the base`);
      if (into instanceof MapNode) {
        into.set(item.key.raw, item.value, item, where === 'start' ? index : undefined);
      } else if (into instanceof ListNode) {
        const start = beside ? into.items.indexOf(target) + (where === 'start' ? 0 : 1 + index) : where === 'start' ? index : into.items.length;
        into.add(this.named(item, into.keyField), start);
      }
    });
  }

  /** A new item of a list: the fields written in the patch, and its name as the list's key field. */
  private named(item: Entry, keyField: string): Node {
    if (!(item.value instanceof MapNode)) {
      this.problems.error(item, `the new item "${item.name}" must be a map of its fields`);
      return item.value;
    }
    const node = new MapNode(item.file, item.line, item.column);
    node.set(keyField, new ScalarNode(item.file, item.line, item.column, item.name, item.name), item);
    for (const field of item.value.entries) node.set(field.key.raw, field.value, field);
    return node;
  }

  private text(entry: Entry, target: ScalarNode, where: 'start' | 'end'): void {
    // An earlier $before or $after of the same patch may already have put new text in place of the target.
    const holder = target.entry?.map.get(target.entry.name);
    const now = holder?.value;
    const added = entry.value;
    if (!holder || holder.key.kind !== 'plain' || !(now instanceof ScalarNode) || typeof now.value !== 'string' || !(added instanceof ScalarNode)) {
      return this.problems.error(entry, `${entry.key.raw} adds text to a text field; this field is not text`);
    }
    const joined = where === 'start' ? `${added.source}\n${now.value}` : `${now.value.trimEnd()}\n${added.source}`;
    const at = holder.map.entries.indexOf(holder);
    holder.map.remove(holder);
    holder.map.set(holder.key.raw, new ScalarNode(entry.file, entry.line, entry.column, joined, joined), holder, at);
  }
}
