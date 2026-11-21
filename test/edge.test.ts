// Edge cases of the library, beyond the contract in scripted-yaml.test.ts.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { Formula, type Problem, ResolveFailed, ScriptedYaml, Text, ValidationFailed } from '../src/index';

const fixtures = join(import.meta.dir, 'fixtures');
const inFixtures = { file: join(fixtures, 'edge.yml') };

/** What the tests return for `!sh`. Counts how often a formula asked for its value. */
class Command {
  static asked = 0;
  constructor(readonly shell: string) {}
  toString() {
    Command.asked++;
    if (this.shell.includes('explode')) throw new Error('cannot run');
    return this.shell.includes('fail') ? '0' : this.shell.includes('text') ? 'some text' : '1';
  }
}

const scripted = () =>
  new ScriptedYaml({
    markers: {
      sh: (source: string) => new Command(source),
      nothing: () => undefined,
      boom: () => {
        throw new Error('marker exploded');
      },
    },
  });
const problemsOf = (text: string, options = { file: 'x.yml' }) => scripted().validateText(text, options);
const errorsOf = async (text: string, options = { file: 'x.yml' }) => (await problemsOf(text, options)).filter((problem) => problem.severity === 'error');
const messages = (problems: Problem[]) => problems.map((problem) => problem.message).join('\n');
const resolved = async (text: string, vars: Record<string, unknown> = {}, options = { file: 'x.yml' }) => (await scripted().loadText(text, options)).resolve({ vars });
const failure = (promise: Promise<unknown>) => promise.then(() => undefined).catch((error) => error);

describe('the shape of a file', () => {
  test('an empty file is a file with no keys', async () => {
    expect(await problemsOf('')).toEqual([]);
    expect(await resolved('')).toEqual({});
  });

  test('a file of comments only is empty too', async () => {
    expect(await resolved('# nothing here\n')).toEqual({});
  });

  test('a root that is a list is an error', async () => {
    expect(messages(await errorsOf('- a\n- b\n'))).toContain('root');
  });

  test('a root that is one value is an error', async () => {
    expect((await errorsOf('just text\n')).length).toBe(1);
  });

  test('null values stay null', async () => {
    const document = await scripted().loadText('a:\nb: ~\nc!: a = null\n', { file: 'x.yml' });
    expect(document.data.a).toBeNull();
    expect(await document.resolve()).toEqual({ a: null, b: null, c: true });
  });

  test('numbers, booleans and lists keep their type', async () => {
    expect(await resolved('n: 4.5\nyes: true\nlist: [1, two, null]\n')).toEqual({ n: 4.5, yes: true, list: [1, 'two', null] });
  });

  test('a formula that is a number in YAML is still a formula', async () => {
    const document = await scripted().loadText('two!: 2\n', { file: 'x.yml' });
    expect(document.data.two).toBeInstanceOf(Formula);
    expect(document.data.two.source).toBe('2');
    expect((await document.resolve()).two).toBe(2);
  });

  test('anchors and aliases are read as YAML reads them', async () => {
    expect(await resolved('first: &shared { size: 3 }\nsecond: *shared\ntotal!: first.size + second.size\n')).toEqual({ first: { size: 3 }, second: { size: 3 }, total: 6 });
  });

  test('a value YAML drops as a tag is reported', async () => {
    const problems = await problemsOf('ok!: !negated\n');
    expect(problems.length).toBeGreaterThan(0);
  });

  test('problems found in data have no line number', async () => {
    const [problem] = await scripted().validateText({ 'run!bash': 'x' }, { file: 'front.md' });
    expect(problem!.line).toBe(0);
    expect(problem!.toString()).toBe('front.md  run!bash  no function is registered for the marker "bash"');
  });

  test('deep nesting: a formula finds a sibling first, then each enclosing map, then the root', async () => {
    const result = await resolved(`
limit: 1
a:
  limit: 2
  b:
    c:
      limit: 3
      here!: limit
    d:
      up!: limit
top!: a.b.c.here + a.b.d.up
`);
    expect(result.a.b.c.here).toBe(3);
    expect(result.a.b.d.up).toBe(2);
    expect(result.top).toBe(5);
  });

  test('a formula over several lines, with comments', async () => {
    const result = await resolved(`
subtotal: 250
discount!: |
  // the bigger the order, the bigger the discount
  if subtotal > 1000 then 15
  else if subtotal > 100 then 10   // most orders
  else 0
`);
    expect(result.discount).toBe(10);
  });

  test('unicode keys can be read by a formula', async () => {
    expect((await resolved('ціна: 4\nподвійна!: ціна * 2\nназва: Борщ за {{ ціна }}\n')).подвійна).toBe(8);
    expect((await resolved('ціна: 4\nназва: Борщ за {{ ціна }}\n')).назва).toBe('Борщ за 4');
  });

  test('a key with a dash cannot be read by a formula: the error says why', async () => {
    const errors = await errorsOf('test-command: npm test\nready!: test-command != null\n');
    expect(errors.length).toBeGreaterThan(0);
    expect(messages(errors)).toContain('dash');
  });

  test('a key with a dash is fine as data', async () => {
    expect(await resolved('test-command: npm test\n')).toEqual({ 'test-command': 'npm test' });
  });
});

describe('the order of problems', () => {
  test('problems come in reading order, whatever check found them', async () => {
    const problems = await problemsOf('a!: nope\nb!bash: x\nc!: 1 +\nd!: vars.X\n');
    expect(problems.map((problem) => [problem.line, problem.key])).toEqual([
      [1, 'a!'],
      [2, 'b!bash'],
      [3, 'c!'],
      [4, 'd!'],
    ]);
  });
});

describe('keys and keywords', () => {
  test('a key, its formula and its marked form are one name', async () => {
    expect((await errorsOf('a!: 1\na!sh: ls\n')).length).toBe(1);
  });

  test('$if without "!" is an error', async () => {
    expect(messages(await errorsOf('list:\n  - name: a\n    $if: true\n'))).toContain('$if!');
  });

  test('a top keyword deeper in the file is an error', async () => {
    expect(messages(await errorsOf('a:\n  $vars: {}\n'))).toContain('top');
  });

  test('a patch keyword in a file without $extends is an error', async () => {
    expect(messages(await errorsOf('a:\n  $replace: { b: 1 }\n'))).toContain('$extends');
  });

  test('an unknown keyword gets a suggestion', async () => {
    expect(messages(await errorsOf('a:\n  $valeu!: 1\n'))).toContain('$value');
  });

  test('a formula key whose value is a map is an error', async () => {
    expect(messages(await errorsOf('a!: { b: 1 }\n'))).toContain('formula');
  });

  test('a key with the name of a function of the file is an error', async () => {
    const text = '$functions:\n  double!: function(n) n * 2\ndouble: 4\n';
    expect(messages(await errorsOf(text))).toContain('double');
  });

  test('a key with the name of a FEEL built-in is allowed, and wins as a name', async () => {
    expect(await resolved('today: { month: 11 }\nsum: 5\nis_november!: today.month = 11 and sum = 5\n')).toMatchObject({ is_november: true });
  });

  test('a function with the name of a FEEL built-in is an error', async () => {
    expect(messages(await errorsOf('$functions:\n  sum!: function(a) a\n'))).toContain('built-in');
  });

  test('a function that is not written as a formula is an error', async () => {
    expect((await errorsOf('$functions:\n  double: function(n) n * 2\n')).length).toBe(1);
  });
});

describe('names in formulas', () => {
  test('a list item is addressed by its id', async () => {
    const result = await resolved(`
stages:
  - id: explore
    when!: 2 > 1
    title: Browser
  - id: results
    when!: stages.explore.when and stages.explore.title = "Browser"
`);
    expect(result.stages[1].when).toBe(true);
  });

  test('a path through a list without an id reads the field of every item', async () => {
    expect((await resolved('items:\n  - { price: 2 }\n  - { price: 3 }\ntotal!: sum(items.price)\n')).total).toBe(5);
  });

  test('names inside [ ] are fields of the items, not unknown names', async () => {
    const text = 'items:\n  - { price: 2, on_sale: false }\n  - { price: 30, on_sale: true }\nlimit: 10\ncheap!: items[price < limit and on_sale = false].price\n';
    expect(await problemsOf(text)).toEqual([]);
    expect((await resolved(text)).cheap).toEqual([2]);
  });

  test('the variables of for, some and every are not unknown names', async () => {
    const text = `
items: [1, 2, 3]
doubled!: for n in items return n * 2
any_big!: some n in items satisfies n > 2
all_big!: every n in items satisfies n > 2
`;
    expect(await problemsOf(text)).toEqual([]);
    expect(await resolved(text)).toMatchObject({ doubled: [2, 4, 6], any_big: true, all_big: false });
  });

  test('an unknown name inside a loop is still an error', async () => {
    expect(messages(await errorsOf('items: [1]\nx!: for n in items return n * factr\n'))).toContain('factr');
  });

  test('a name a formula makes is its own everywhere in that formula: a key of that name is not read', async () => {
    const cycles = ['summary!: "{ total: 1, tax: total * 2 }"\ntotal!: summary.tax\n', 'n!: count(list)\nlist!: for n in [1, 2] return n * 2\n'];
    for (const text of cycles) expect(await problemsOf(text)).toEqual([]);
    expect(await resolved(cycles[0]!)).toEqual({ summary: { total: 1, tax: 2 }, total: 2 });
    expect(await resolved(cycles[1]!)).toEqual({ n: 2, list: [2, 4] });
    const overlap = 'check:\n  $value!: 1 > 2\n  message: No.\nx!: "count(for check in [{ message: 1 }] return check.message)"\n';
    expect(await problemsOf(overlap)).toEqual([]);
    expect((await resolved(overlap)).x).toBe(1);
  });

  test('function parameters and the entries of { } are not unknown names', async () => {
    const text = 'items: [3, 1, 2]\nsorted!: sort(items, function(a, b) a < b)\nsteps!: "{ first: 1, second: first + 1 }.second"\n';
    expect(await problemsOf(text)).toEqual([]);
    expect(await resolved(text)).toMatchObject({ sorted: [1, 2, 3], steps: 2 });
  });

  test('a local name that is also a key: the local one is used, and the key is not checked against it', async () => {
    const text = 'order: { id: 1 }\nn!: 1 + 1\na!: for a in [1, 2] return a * 2\nlist!: for n in [1, 2] return n * 2\ntotals!: "for order in [{ total: 5 }] return order.total"\n';
    expect(await problemsOf(text)).toEqual([]);
    expect(await resolved(text)).toMatchObject({ n: 2, a: [2, 4], list: [2, 4], totals: [5] });
  });

  test('an unknown function is an error', async () => {
    expect(messages(await errorsOf('x!: fileExist("a")\n'))).toContain('unknown function "fileExist"');
  });

  test('a close name is suggested', async () => {
    expect(messages(await errorsOf('prerequisites: { a: 1 }\nx!: prerequisite.a\n'))).toContain('did you mean "prerequisites"');
  });

  test('a path to a key that does not exist is an error', async () => {
    expect(messages(await errorsOf('prerequisites: { local: true }\nx!: prerequisites.locl\n'))).toContain('locl');
  });

  test('one formula cannot read a node as its $value and a key beside it', async () => {
    const text = 'check:\n  $value!: 1 > 2\n  message: No.\nx!: if check then "ok" else check.message\n';
    expect(messages(await errorsOf(text))).toContain('check.message');
  });

  test('reads lists every name, once, as written', async () => {
    const document = await scripted().loadText('$vars:\n  A: { optional: true }\nb: { c: 1 }\nx!: if vars.A != null and b.c > 0 then b.c else count([vars.A])\n', { file: 'x.yml' });
    expect(document.data.x.reads).toEqual(['vars.A', 'b.c']);
  });

  test('a text lists the names of all its blocks', async () => {
    const document = await scripted().loadText('a: 1\nb: 2\nt: "{{ a }} and {{ b }} and {{ a }}"\n', { file: 'x.yml' });
    expect(document.data.t).toBeInstanceOf(Text);
    expect(document.data.t.reads).toEqual(['a', 'b']);
  });
});

describe('cycles', () => {
  test('a key that reads itself', async () => {
    expect(messages(await errorsOf('a!: a + 1\n'))).toContain('reads itself');
  });

  test('a cycle through $value', async () => {
    const text = 'first:\n  $value!: second\nsecond:\n  $value!: first\n';
    expect(messages(await errorsOf(text))).toContain('reads itself');
  });

  test('a cycle through a text', async () => {
    expect((await errorsOf('a: "x {{ b }}"\nb!: a + "y"\n')).length).toBeGreaterThan(0);
  });

  test('a field named like the key that filters it is not a cycle', async () => {
    const text = 'items:\n  - { price: 5 }\n  - { price: 20 }\nprice!: items[price > 10].price\n';
    expect(await problemsOf(text)).toEqual([]);
    expect((await resolved(text)).price).toEqual([20]);
  });

  test('a map that reads a key of its own is not a cycle', async () => {
    expect((await resolved('order:\n  items: [1, 2]\n  size!: count(order.items)\n')).order.size).toBe(2);
  });
});

describe('text', () => {
  test('null renders as nothing, numbers and lists as written', async () => {
    const result = await resolved('$vars:\n  X: { optional: true }\nn: 3\nlist: [a, b]\nt: "[{{ vars.X }}] {{ n }} {{ list }}"\n');
    expect(result.t).toBe('[] 3 ["a","b"]');
  });

  test('a formula with } inside', async () => {
    expect((await resolved('t: \'A {{ "}" + "x" }} b\'\n')).t).toBe('A }x b');
  });

  test('text in a list is filled too', async () => {
    expect((await resolved('name: Ann\nlines:\n  - Hello {{ name }}\n  - plain\n')).lines).toEqual(['Hello Ann', 'plain']);
  });

  test('an unclosed {{ is an error', async () => {
    expect((await errorsOf('t: half {{ open\n')).length).toBe(1);
  });

  test('{{#if}} is refused: structure is said with $if!', async () => {
    expect(messages(await errorsOf('a: true\nt: "{{#if a}}yes{{/if}}"\n'))).toContain('$if!');
  });

  test('${NAME} is not template syntax', async () => {
    expect((await resolved('t: echo ${HOME}\n')).t).toBe('echo ${HOME}');
  });
});

describe('variables', () => {
  test('a default is used when the variable is unset or empty', async () => {
    const text = '$vars:\n  BRANCH: { default: main }\nb!: vars.BRANCH\n';
    expect((await resolved(text)).b).toBe('main');
    expect((await resolved(text, { BRANCH: '' })).b).toBe('main');
    expect((await resolved(text, { BRANCH: 'dev' })).b).toBe('dev');
  });

  test('a variable declared with nothing after it is required', async () => {
    const error = await failure(resolved('$vars:\n  NEEDED:\nx!: vars.NEEDED\n'));
    expect(error).toBeInstanceOf(ResolveFailed);
    expect(error.message).toContain('NEEDED');
  });

  test('a name matched by a pattern is no typo', async () => {
    expect(await problemsOf("$vars:\n  '/[A-Z][A-Z0-9_]*/': { optional: true }\nci!: vars.CI = null\n")).toEqual([]);
  });

  test('the pattern covers the whole name', async () => {
    const problems = await problemsOf("$vars:\n  '/[A-Z]+/': { optional: true }\nci!: vars.CI_job = null\n");
    expect(problems.map((problem) => problem.severity)).toEqual(['warning']);
  });

  test('a broken pattern is an error', async () => {
    expect((await errorsOf("$vars:\n  '/[A-Z/': {}\n")).length).toBe(1);
  });

  test('an undeclared variable is reported once, and is null', async () => {
    const text = 'a!: vars.CI = null\nb!: vars.CI != null\n';
    expect((await problemsOf(text)).length).toBe(1);
    expect(await resolved(text)).toEqual({ a: true, b: false });
  });

  test('an undeclared variable the application passes is seen', async () => {
    expect((await resolved('a!: vars.CI\n', { CI: 'yes' })).a).toBe('yes');
  });

  test('variables are not converted: text stays text', async () => {
    const error = await failure(resolved('$vars:\n  amount: {}\nmore!: vars.amount + 1\n', { amount: '5' }));
    expect(error).toBeInstanceOf(ResolveFailed);
  });

  test('a declared type is checked, not converted', async () => {
    const text = '$vars:\n  amount: { type: number }\nmore!: vars.amount + 1\n';
    expect((await resolved(text, { amount: 5 })).more).toBe(6);
    const error = await failure(resolved(text, { amount: '5' }));
    expect(error).toBeInstanceOf(ResolveFailed);
    expect(error.message).toContain('amount');
  });

  test('a type the file does not define is ignored', async () => {
    expect((await resolved('$vars:\n  cart: { type: Cart }\nn!: vars.cart.n\n', { cart: { n: 1 } })).n).toBe(1);
  });

  test('host marks a variable the application sets itself; it is required unless it is optional', async () => {
    const text = '$vars:\n  STAGE_DIR: { host: true, optional: true }\n  RUN_ID: { host: true }\ndir!: vars.STAGE_DIR\n';
    expect((await failure(resolved(text))).message).toContain('RUN_ID');
    expect((await resolved(text, { RUN_ID: 7 })).dir).toBeNull();
    const document = await scripted().loadText(text, { file: 'x.yml' });
    expect(document.variables.map((variable) => [variable.name, variable.host, variable.required])).toEqual([
      ['STAGE_DIR', true, false],
      ['RUN_ID', true, true],
    ]);
  });

  test('the document lists its variables', async () => {
    const document = await scripted().loadText('$vars:\n  KEY: { optional: true, secret: true, about: The key. }\n', { file: 'x.yml' });
    expect(document.variables.map((variable) => [variable.name, variable.secret, variable.required, variable.about])).toEqual([['KEY', true, false, 'The key.']]);
  });

  test('resolve does not change document.data, and can be called again', async () => {
    const document = await scripted().loadText('$vars:\n  N: {}\ndouble!: vars.N * 2\n', { file: 'x.yml' });
    expect((await document.resolve({ vars: { N: 2 } })).double).toBe(4);
    expect((await document.resolve({ vars: { N: 5 } })).double).toBe(10);
    expect(document.data.double).toBeInstanceOf(Formula);
  });
});

describe('markers', () => {
  test('a marker function that throws fails the load, with the key', async () => {
    const error = await failure(scripted().loadText('a:\n  run!boom: now\n', { file: 'x.yml' }));
    expect(error).toBeInstanceOf(ValidationFailed);
    expect(error.message).toContain('marker exploded');
    expect(error.problems[0].key).toBe('a.run!boom');
    expect(error.problems[0].line).toBe(2);
  });

  test('a marker function that returns undefined: the key is there, a formula reads null', async () => {
    const document = await scripted().loadText('gone!nothing: x\nis_gone!: gone = null\n', { file: 'x.yml' });
    expect('gone' in document.data).toBe(true);
    expect(document.data.gone).toBeUndefined();
    expect(await document.resolve()).toEqual({ gone: null, is_gone: true });
    const unread = await (await scripted().loadText('gone!nothing: x\n', { file: 'x.yml' })).resolve();
    expect('gone' in unread).toBe(true);
    expect(unread.gone).toBeUndefined();
  });

  test('toString() that throws is a resolve error that names the key', async () => {
    const error = await failure(resolved('check!sh: explode\nok!: check\n'));
    expect(error).toBeInstanceOf(ResolveFailed);
    expect(error.message).toContain('check!sh');
    expect(error.message).toContain('cannot run');
  });

  test('a value read by two formulas is asked once', async () => {
    Command.asked = 0;
    const result = await resolved('check!sh: ls\na!: check\nb!: not(check)\nc: "{{ check }}"\n');
    expect(result).toEqual({ check: true, a: true, b: false, c: 'true' });
    expect(Command.asked).toBe(1);
  });

  test('any text but "1" and "0" stays text', async () => {
    expect((await resolved('out!sh: text\nshout!: upper case(out)\n')).shout).toBe('SOME TEXT');
  });

  test('a marked value may be a map or a list, handed over as data', async () => {
    const seen: unknown[] = [];
    const library = new ScriptedYaml({ markers: { keep: (source: unknown) => seen.push(source) } });
    await library.loadText('a!keep: { x: 1 }\nb!keep: [1, 2]\nc!keep: 7\n', { file: 'x.yml' });
    expect(seen).toEqual([{ x: 1 }, [1, 2], 7]);
  });

  test('the marker function gets the value and nothing else', async () => {
    const seen: unknown[][] = [];
    const library = new ScriptedYaml({ markers: { sh: (...args: unknown[]) => seen.push(args) } });
    await library.loadText('stages:\n  - id: a\n    run!sh: ls\n', { file: 'p.yml' });
    expect(seen).toEqual([['ls']]);
  });

  test('markers given by name only cannot load a file', async () => {
    const error = await failure(new ScriptedYaml({ markers: ['sh'] }).loadText('run!sh: ls\n', { file: 'x.yml' }));
    expect(error).toBeInstanceOf(ValidationFailed);
    expect(error.message).toContain('name only');
  });

  test('a library with no markers at all', async () => {
    expect(await (await new ScriptedYaml().loadText('a!: 1 + 1\n')).resolve()).toEqual({ a: 2 });
  });
});

describe('structure keywords', () => {
  test('$each with an empty list gives no items', async () => {
    expect((await resolved('cities: []\nshipping:\n  - name: Standard\n  - $each!: cities\n    $as: city\n    name: Pickup in {{ city }}\n')).shipping).toEqual([{ name: 'Standard' }]);
  });

  test('$each without $as names the value "item"', async () => {
    expect((await resolved('list:\n  - $each!: "[1, 2]"\n    double!: item * 2\n')).list).toEqual([{ double: 2 }, { double: 4 }]);
  });

  test('$if on an item with $each is checked per value', async () => {
    const text = `
warehouses:
  - { city: Kyiv, stock: 3 }
  - { city: Lviv, stock: 0 }
  - { city: Odesa, stock: 9 }
shipping:
  - $each!: warehouses
    $as: warehouse
    name: Pickup in {{ warehouse.city }}
    left!: warehouse.stock
    $if!: warehouse.stock > 0
`;
    expect((await resolved(text)).shipping).toEqual([
      { name: 'Pickup in Kyiv', left: 3 },
      { name: 'Pickup in Odesa', left: 9 },
    ]);
  });

  test('$each over something that is not a list is an error', async () => {
    const error = await failure(resolved('$vars:\n  cities: { optional: true }\nlist:\n  - $each!: vars.cities\n    name: x\n'));
    expect(error).toBeInstanceOf(ResolveFailed);
    expect(error.message).toContain('$each');
  });

  test('$if must be true or false: null is an error, not "no"', async () => {
    const error = await failure(resolved('$vars:\n  vip: { optional: true }\nlist:\n  - name: a\n    $if!: vars.vip\n'));
    expect(error).toBeInstanceOf(ResolveFailed);
    expect(error.message).toContain('true or false');
  });

  test('$if on a map removes its key', async () => {
    const text = '$vars:\n  on: {}\npanel:\n  title: Hi\n  $if!: vars.on\nfooter:\n  $unless!: vars.on\n  text: bye\n';
    expect(await resolved(text, { on: true })).toEqual({ panel: { title: 'Hi' } });
    expect(await resolved(text, { on: false })).toEqual({ footer: { text: 'bye' } });
  });

  test('$when: every matching case applies in order', async () => {
    const text = `
$vars:
  total: {}
checkout:
  payment_methods: [card, paypal]
  note: ''
  $when:
    - $if!: vars.total > 100
      note: Big order.
    - $if!: vars.total > 1000
      payment_methods: [card, bank_transfer]
      note: Orders over 1000 need a card or a bank transfer.
`;
    expect((await resolved(text, { total: 5 })).checkout).toEqual({ payment_methods: ['card', 'paypal'], note: '' });
    expect((await resolved(text, { total: 500 })).checkout).toEqual({ payment_methods: ['card', 'paypal'], note: 'Big order.' });
    expect((await resolved(text, { total: 5000 })).checkout.payment_methods).toEqual(['card', 'bank_transfer']);
  });

  test('$when: $else applies when no case did, and may add a key', async () => {
    const text = 'n: 1\nbox:\n  $when:\n    - $if!: n > 5\n      size: big\n    - $else:\n      size: small\nlabel!: box.size\n';
    expect(await resolved(text)).toEqual({ n: 1, box: { size: 'small' }, label: 'small' });
  });

  test('a formula reads the value a $when case put in place', async () => {
    const text = 'n: 9\nbox:\n  size: small\n  $when:\n    - $if!: n > 5\n      size: big\nlabel!: box.size\n';
    expect((await resolved(text)).label).toBe('big');
  });

  test('a $when that is not a list of cases is an error', async () => {
    expect(messages(await errorsOf('box:\n  $when:\n    - size: big\n'))).toContain('$when');
  });

  test('a formula that reads a list sees it with $if applied', async () => {
    expect((await resolved('on: false\nlist:\n  - name: a\n  - name: b\n    $if!: on\nnames!: list.name\n')).names).toEqual(['a']);
  });
});

describe('$functions', () => {
  test('a function may call another, and read keys of the file', async () => {
    const text = `
$functions:
  inCart!: function(wanted) cart.items[category = wanted]
  total!: function(items) sum(items.price)
  spent!: function(wanted) total(inCart(wanted))
cart:
  items:
    - { category: books, price: 5 }
    - { category: books, price: 7 }
    - { category: home, price: 30 }
books!: spent("books")
`;
    expect((await resolved(text)).books).toBe(12);
  });

  test('a warning inside a function is an error that names the function and the key', async () => {
    const error = await failure(resolved('$functions:\n  rate!: function(order) order.totl * 2\nx!: "rate({ total: 5 })"\n'));
    expect(error).toBeInstanceOf(ResolveFailed);
    expect(error.message).toContain('rate');
    expect(error.message).toContain('x!');
  });

  test('an unknown name inside a function is a validation error', async () => {
    expect(messages(await errorsOf('$functions:\n  rate!: function(order) order.total * factr\n'))).toContain('factr');
  });

  test('a function that calls itself is refused', async () => {
    const text = '$functions:\n  fact!: function(n) if n <= 1 then 1 else n * fact(n - 1)\nx!: fact(3)\n';
    expect((await errorsOf(text)).length).toBeGreaterThan(0);
  });
});

describe('the FEEL traps', () => {
  test('not without brackets is an unknown name', async () => {
    expect(messages(await errorsOf('ready: true\nblocked!: not ready\n'))).toContain('unknown name "not ready"');
  });

  test('FEEL that is valid but not what was meant is not a validation problem', async () => {
    const text = 'role: admin\nok: true\nitems:\n  - { on_sale: false }\nsame!: role == "admin"\nallowed!: role in ["admin"] or ok\nfirst!: items[0]\nfull!: items[not(on_sale)]\n';
    expect(await problemsOf(text)).toEqual([]);
  });

  test('single quotes, && and the ternary are not FEEL', async () => {
    expect((await errorsOf("a: x\nb!: a = 'x'\n")).length).toBe(1);
    expect((await errorsOf('a: true\nb!: a && a\n')).length).toBe(1);
    expect((await errorsOf('a: true\nb!: \'a ? "y" : "n"\'\n')).length).toBe(1);
  });

  test('if without else', async () => {
    expect((await errorsOf('a: true\nb!: if a then 1\n')).length).toBe(1);
  });

  test('"in" last, or in an if, needs no brackets', async () => {
    expect(await problemsOf('role: admin\nok: true\na!: ok and role in ["admin"]\nb!: if role in ["admin"] then 1 else 2\n')).toEqual([]);
  });

  test('text used as yes/no is null, and $if refuses null', async () => {
    const text = '$vars:\n  CMD: { optional: true }\nok: true\nlist:\n  - name: a\n    $if!: vars.CMD and ok\n';
    expect(await failure(resolved(text, { CMD: 'npm test' }))).toBeInstanceOf(ResolveFailed);
  });

  test('joining text and a number is an error; string() fixes it', async () => {
    expect(await failure(resolved('n: 103\nt!: \'"Total: " + n\'\n'))).toBeInstanceOf(ResolveFailed);
    expect((await resolved('n: 103\nt!: \'"Total: " + string(n)\'\n')).t).toBe('Total: 103');
  });

  test('a field of null behind a null check is not an error', async () => {
    const text = '$vars:\n  user: { optional: true }\nadmin!: vars.user != null and vars.user.role = "admin"\n';
    expect((await resolved(text)).admin).toBe(false);
    expect((await resolved(text, { user: { role: 'admin' } })).admin).toBe(true);
  });

  test('sum of nothing is null: FEEL, not an error', async () => {
    expect((await resolved('items: []\ntotal!: sum(items)\nsafe!: sum(append(items, 0))\n')).total).toBeNull();
  });
});

describe('$import', () => {
  test('nested imports: a YAML file that imports another', async () => {
    const result = await resolved('$import:\n  ./inner.yml: inner\nx!: inner.limit\nname!: inner.label\n', {}, inFixtures);
    expect(result).toEqual({ x: 11, name: 'inner' });
  });

  test('an import cycle is a problem on the line of the import', async () => {
    const error = await failure(scripted().load(join(fixtures, 'cycle-a.yml')));
    expect(error).toBeInstanceOf(ValidationFailed);
    expect(error.message).toContain('cycle');
    expect(error.problems[0].line).toBe(2);
  });

  test('a file that does not exist is a problem at validation, on its line', async () => {
    const [problem] = await errorsOf('name: x\n$import:\n  ./nope.ts: [a]\n', inFixtures);
    expect(problem!.line).toBe(3);
    expect(problem!.message).toContain('does not exist');
  });

  test('a module needs a list of names, a YAML file one name', async () => {
    expect((await errorsOf('$import:\n  ./host.ts: { a: 1 }\n', inFixtures)).length).toBe(1);
    expect((await errorsOf('$import:\n  ./settings.yml: [a, b]\n', inFixtures)).length).toBe(1);
  });

  test('an imported name with the name of a FEEL built-in is an error', async () => {
    expect(messages(await errorsOf('$import:\n  ./settings.yml: sum\n', inFixtures))).toContain('built-in');
  });

  test('a function that throws is a resolve error with its message', async () => {
    const error = await failure(resolved('$import:\n  ./book.md: book\nx!: book("nonsense")\n', {}, inFixtures));
    expect(error).toBeInstanceOf(ResolveFailed);
    expect(error.message).toContain('nonsense');
  });

  test('a Markdown selector with a regular expression picks a table', async () => {
    const result = await resolved('$import:\n  ./book.md: book\ncast!: book("section(/^Characters/) table")\n', {}, inFixtures);
    expect(result.cast).toContain('| Paul  | hero    |');
  });

  test('imported data can be read whole', async () => {
    const result = await resolved('$import:\n  ./settings.yml: settings\nhome!: count(settings.home_countries)\nall!: settings\n', {}, inFixtures);
    expect(result.home).toBe(3);
    expect(result.all.currency).toBe('EUR');
  });
});

describe('what the library relies on in feelin', () => {
  test('every function the tested FEEL examples call is known as a built-in, except the four host functions', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { parse } = await import('yaml');
    const { Builtins } = await import('../src/builtins');
    const { LazyFormula } = await import('../src/lazy-formula');
    const host = ['fileExists', 'capitalize', 'truncate', 'glob'];
    const folder = join(import.meta.dir, '../docs/examples');
    const called = new Set<string>();
    for (const file of readdirSync(folder).filter((name) => name.endsWith('.yml') && name !== 'data.yml')) {
      for (const example of parse(readFileSync(join(folder, file), 'utf8')).examples as { feel: string; error?: boolean }[]) {
        if (example.error) continue;
        for (const ref of LazyFormula.of(example.feel).refs) if (ref.call) called.add(ref.head);
      }
    }
    expect(called.size).toBeGreaterThan(20);
    expect([...called].filter((name) => !host.includes(name) && !Builtins.has(name))).toEqual([]);
    expect(host.filter((name) => Builtins.has(name))).toEqual([]);
  });

  test('the warnings of a function definition arrive when the function is called', async () => {
    const { evaluate } = await import('feelin');
    const definition = evaluate('function(x) x.nope + 1', {});
    expect(definition.warnings).toEqual([]);
    const call = evaluate('f({ a: 1 })', { f: definition.value });
    expect(call.warnings).toEqual([]);
    expect(definition.warnings.length).toBeGreaterThan(0);
  });

  test('a promise is not awaited: it becomes {}', async () => {
    const { evaluate } = await import('feelin');
    expect(evaluate('f(1)', { f: async (a: number) => a })).toEqual({ value: {}, warnings: [] });
  });

  test('calling a name FEEL does not ship warns NO_FUNCTION_FOUND; a built-in does not', async () => {
    const { evaluate } = await import('feelin');
    const types = (source: string) => evaluate(source, {}).warnings.map((warning) => warning.type);
    expect(types('nope()')).toContain('NO_FUNCTION_FOUND');
    expect(types('sum()')).not.toContain('NO_FUNCTION_FOUND');
    expect(types('starts with()')).not.toContain('NO_FUNCTION_FOUND');
  });

  test('an object that is not plain data is null in "and", silently: hence toString()', async () => {
    const { evaluate } = await import('feelin');
    expect(evaluate('a and b', { a: true, b: new Command('ls') })).toEqual({ value: null, warnings: [] });
  });
});
