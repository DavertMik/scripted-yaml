import { parseExpression } from 'feelin';

type Tree = ReturnType<typeof parseExpression>;
type SyntaxNode = Tree['topNode'];

/**
 * Every node name of `feelin`'s syntax tree that this library relies on.
 * `test/feelin-tree.test.ts` asserts that `feelin` still produces each of them.
 */
export const FeelNode = {
  VariableName: 'VariableName',
  PathExpression: 'PathExpression',
  FunctionInvocation: 'FunctionInvocation',
  FilterExpression: 'FilterExpression',
  ForExpression: 'ForExpression',
  Type: 'Type',
  Name: 'Name',
  NamedParameter: 'NamedParameter',
} as const;

/** A name a formula reads: `prerequisites.local` is head `prerequisites`, path `[local]`. */
export class Ref {
  constructor(
    readonly head: string,
    readonly path: string[],
    /** The name is called: `fileExists(...)`. */
    readonly call: boolean,
    /** The name is inside `[ ]`, where it may be a field of the item being filtered. */
    readonly inFilter: boolean,
  ) {}

  get name(): string {
    return [this.head, ...this.path].join('.');
  }
}

/**
 * The names one formula reads, taken from the syntax tree `feelin` builds. Nothing is evaluated.
 * A key is computed only when a formula reads it, so this tells which keys to compute first,
 * and how deep into each one the formula goes.
 */
export class LazyFormula {
  private static readonly cache = new Map<string, LazyFormula>();

  readonly refs: Ref[] = [];
  /** Why `feelin` cannot read this formula. At most one. */
  readonly errors: string[] = [];
  /** The names the formula makes itself: loop variables, function parameters, entries of `{ }`. They are not read from the file; nor is `item` inside `[ ]`. */
  private readonly own = new Set<string>();

  static of(source: string): LazyFormula {
    let formula = LazyFormula.cache.get(source);
    if (!formula) LazyFormula.cache.set(source, (formula = new LazyFormula(source)));
    return formula;
  }

  private constructor(readonly source: string) {
    if (source.trim() === '') {
      this.errors.push('the formula is empty');
      return;
    }
    let tree: Tree;
    try {
      tree = parseExpression(source, {}, undefined);
    } catch (error) {
      this.errors.push(`not a valid formula: ${(error as Error).message}`);
      return;
    }
    const used: Ref[] = [];
    tree.iterate({
      enter: (at) => {
        if (this.errors.length > 0) return false;
        if (!at.type.isError) return this.enter(at.node, used);
        const near = source.slice(Math.max(0, at.from - 20), at.to + 10).trim();
        this.errors.push(`not a valid formula (FEEL) at position ${at.from + 1}, near "${near}"`);
        return false;
      },
    });
    if (this.errors.length === 0) this.refs.push(...used.filter((ref) => !this.own.has(ref.head) && !(ref.inFilter && ref.head === 'item')));
  }

  /** True when the text is one plain name, such as `test_command`. */
  static isName(text: string): boolean {
    const { refs } = LazyFormula.of(text);
    return refs.length === 1 && refs[0]!.head === text && refs[0]!.path.length === 0 && !text.includes(' ');
  }

  private text(node: SyntaxNode): string {
    return this.source.slice(node.from, node.to);
  }

  /** Looks at one node of the tree. Returning false skips what is inside it. */
  private enter(node: SyntaxNode, used: Ref[]): boolean | void {
    if (node.name === FeelNode.Type) return false;
    if (node.name === FeelNode.ForExpression) this.own.add('partial');
    // A Name is a name being given: by `for x in`, `function(x)`, `{ x: }`. In `f(x: 1)` it names a parameter of `f`.
    if (node.name === FeelNode.Name && node.parent?.parent?.name !== FeelNode.NamedParameter) this.own.add(this.text(node));
    if (node.name !== FeelNode.VariableName) return;
    const path: string[] = [];
    let whole = node;
    while (whole.parent?.name === FeelNode.PathExpression && !whole.prevSibling) {
      whole = whole.parent;
      path.push(this.text(whole.lastChild!));
    }
    const call = whole.parent?.name === FeelNode.FunctionInvocation && !whole.prevSibling && path.length === 0;
    used.push(new Ref(this.text(node), path, call, this.inFilter(node)));
    return false;
  }

  /** True inside the `[ ]` of a filter, not in the list before it. */
  private inFilter(node: SyntaxNode): boolean {
    for (let inner = node, outer = node.parent; outer; inner = outer, outer = outer.parent) {
      if (outer.name === FeelNode.FilterExpression && inner.prevSibling) return true;
    }
    return false;
  }
}
