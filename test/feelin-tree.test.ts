// The library reads the syntax tree `feelin` builds and relies on the names of some of its nodes.
// Every such name is in `FeelNode`. This file fails when an upgrade of `feelin` renames or moves one.
import { describe, expect, test } from 'bun:test';
import { parseExpression } from 'feelin';
import { FeelNode, LazyFormula } from '../src/lazy-formula';

type SyntaxNode = ReturnType<typeof parseExpression>['topNode'];

/** The tree of one formula, straight from `feelin`. */
class Parsed {
  private readonly nodes: SyntaxNode[] = [];

  constructor(readonly source: string) {
    parseExpression(source, {}, undefined).iterate({ enter: (node) => void this.nodes.push(node.node) });
  }

  first(name: string): SyntaxNode | undefined {
    return this.nodes.find((node) => node.name === name);
  }

  text(node: SyntaxNode | null | undefined): string | undefined {
    return node ? this.source.slice(node.from, node.to) : undefined;
  }

  /** The text of each child of the first node with this name. */
  children(name: string): string[] {
    const list: string[] = [];
    for (let child = this.first(name)?.firstChild; child; child = child.nextSibling) list.push(this.text(child)!);
    return list;
  }

  /** The names of the nodes around the first node that has this name and this text, nearest first. */
  around(name: string, text: string): string[] {
    const names: string[] = [];
    for (let node = this.nodes.find((candidate) => candidate.name === name && this.text(candidate) === text)?.parent; node; node = node.parent) names.push(node.name);
    return names;
  }
}

/** For each node name the library relies on: a formula in which `feelin` must produce it, as the text given. */
const produced: Record<keyof typeof FeelNode, [formula: string, text: string]> = {
  VariableName: ['total + 1', 'total'],
  PathExpression: ['prerequisites.staging', 'prerequisites.staging'],
  FunctionInvocation: ['count(items)', 'count(items)'],
  FilterExpression: ['items[price > 2]', 'items[price > 2]'],
  ForExpression: ['for n in items return n * 2', 'for n in items return n * 2'],
  Type: ['total instance of number', 'number'],
  Name: ['for n in items return n * 2', 'n'],
  NamedParameter: ['f(n: 1)', 'n: 1'],
};

describe('the node names of feelin the library relies on', () => {
  test('every name in FeelNode is checked here, under its own name', () => {
    expect(Object.keys(produced).sort()).toEqual(Object.keys(FeelNode).sort());
    for (const [key, name] of Object.entries(FeelNode)) expect<string>(name).toBe(key);
  });

  for (const [name, [formula, text]] of Object.entries(produced)) {
    test(`${name} in "${formula}"`, () => {
      const parsed = new Parsed(formula);
      expect(parsed.text(parsed.first(name))).toBe(text);
    });
  }
});

describe('where feelin puts those nodes', () => {
  test('a path: what is read comes first, the name after the dot comes last', () => {
    expect(new Parsed('a.b').children('PathExpression')).toEqual(['a', '.', 'b']);
    expect(new Parsed('a.b.c').children('PathExpression')).toEqual(['a.b', '.', 'c']);
  });

  test('a call: the name that is called comes first', () => {
    expect(new Parsed('count(items)').children('FunctionInvocation')[0]).toBe('count');
  });

  test('a filter: the list comes first, the condition is the third part', () => {
    expect(new Parsed('items[price > 2]').children('FilterExpression')).toEqual(['items', '[', 'price > 2', ']']);
  });

  test('the name of a type is a VariableName inside Type', () => {
    expect(new Parsed('total instance of number').around('VariableName', 'number')).toContain('Type');
  });

  test('a name that is given is a Name: by for, some, every, a function and { }; only a named parameter is inside NamedParameter', () => {
    for (const formula of ['for n in [1] return 1', 'some n in [1] satisfies true', 'every n in [1] satisfies true', 'function(n) 1', '{ n: 1 }']) {
      const around = new Parsed(formula).around('Name', 'n');
      expect(around.length).toBeGreaterThan(0);
      expect(around).not.toContain('NamedParameter');
    }
    expect(new Parsed('f(n: 1)').around('Name', 'n')[1]).toBe('NamedParameter');
    expect(new Parsed('function(n) 1').around('Name', 'n')[1]).not.toBe('NamedParameter');
  });

  test('names that are declared, not read, are not VariableName', () => {
    for (const formula of ['for n in [1] return 1', 'function(n) 1', '{ n: 1 }', 'f(n: 1)', 'a.n']) {
      expect(new Parsed(formula).around('VariableName', 'n')).toEqual([]);
    }
  });

  test('a formula feelin cannot read has an error node', () => {
    let broken = false;
    parseExpression('a +', {}, undefined).iterate({ enter: (node) => void (broken ||= node.type.isError) });
    expect(broken).toBe(true);
  });
});

describe('the names a formula reads', () => {
  const refs = (source: string) => LazyFormula.of(source).refs.map((ref) => `${ref.name}${ref.call ? '()' : ''}${ref.inFilter ? '?' : ''}`);

  test('a name, a path, a call', () => {
    expect(refs('total + prerequisites.staging.ok + count(items)')).toEqual(['total', 'prerequisites.staging.ok', 'count()', 'items']);
  });

  test('a path stops where FEEL computes something: after a call or a filter it is not followed', () => {
    expect(refs('find(a).b')).toEqual(['find()', 'a']);
    expect(refs('items[1].price')).toEqual(['items']);
    expect(refs('a.b(c)')).toEqual(['a.b', 'c']);
  });

  test('a name with a space is one name; the name of a type is not read', () => {
    expect(refs('order total + 1')).toEqual(['order total']);
    expect(refs('total instance of number')).toEqual(['total']);
  });

  test('inside [ ] a name may be a field of the item; the list before it is not', () => {
    expect(refs('items[price < limit.max].name')).toEqual(['items', 'price?', 'limit.max?']);
  });

  test('the names a formula makes are not read, wherever they stand in it', () => {
    expect(refs('for n in items return n * rate')).toEqual(['items', 'rate']);
    expect(refs('some n in items satisfies n > 2')).toEqual(['items']);
    expect(refs('sort(items, function(a, b) a < b)')).toEqual(['sort()', 'items']);
    expect(refs('{ first: 1, second: first + 1 }.second')).toEqual([]);
    expect(refs('n + count(for n in items return n)')).toEqual(['count()', 'items']);
    expect(refs('items[item > 1] + (for n in items return partial)')).toEqual(['items', 'items']);
    expect(refs('f(n: n)')).toEqual(['f()', 'n']);
    expect(refs('item + count(items[item > 1])')).toEqual(['item', 'count()', 'items']);
  });

  test('a formula feelin cannot read reads nothing and says why', () => {
    expect(refs('a +')).toEqual([]);
    expect(LazyFormula.of('a +').errors.length).toBe(1);
  });
});
