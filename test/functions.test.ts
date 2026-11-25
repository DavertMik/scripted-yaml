// `$functions`: the short form (parameters in the key) and the long form (a whole FEEL function).
import { describe, expect, test } from 'bun:test';
import { stringify } from 'yaml';
import { MemoryFiles, ScriptedYaml } from '../src/index';

const scripted = new ScriptedYaml();
const resolve = async (text: string) => (await scripted.loadText(text, { file: 'x.yml' })).resolve({ vars: {} });

describe('$functions', () => {
  test('parameters in the key, the formula as the value', async () => {
    const result = await resolve(`
$functions:
  bonus(score)!: floor((score - 10) / 3)
  within(low, value, high)!: value >= low and value <= high
strong!: bonus(18)
in_range!: within(1, 5, 10)
`);
    expect(result).toEqual({ strong: 2, in_range: true });
  });

  test('a function with no parameters', async () => {
    expect(await resolve('$functions:\n  answer()!: 6 * 7\nx!: answer()\n')).toEqual({ x: 42 });
  });

  test('the long form still works, and both may be mixed', async () => {
    const result = await resolve(`
$functions:
  double!: function(n) n * 2
  triple(n)!: n * 3
x!: double(2) + triple(2)
`);
    expect(result).toEqual({ x: 10 });
  });

  test('a function reads keys of the file and other functions', async () => {
    const result = await resolve(`
$functions:
  inCart(wanted)!: items[category = wanted]
  countOf(wanted)!: count(inCart(wanted))
items:
  - { name: Dune, category: books }
  - { name: Lamp, category: home }
books!: countOf("books")
`);
    expect(result.books).toBe(1);
  });

  test('an unknown name in the body is a validation error on the function', async () => {
    const [problem] = await scripted.validateText('$functions:\n  bonus(score)!: floor((scor - 10) / 3)\nx!: bonus(1)\n', { file: 'x.yml' });
    expect(problem!.severity).toBe('error');
    expect(problem!.line).toBe(2);
    expect(problem!.message).toContain('scor');
  });

  test('a body that is not valid FEEL', async () => {
    const problems = await scripted.validateText('$functions:\n  bonus(score)!: floor((score -\nx!: bonus(1)\n', { file: 'x.yml' });
    expect(problems.filter((problem) => problem.severity === 'error').length).toBeGreaterThan(0);
  });

  test('a function may not take the name of a FEEL built-in', async () => {
    const [problem] = await scripted.validateText('$functions:\n  sum(items)!: 1\nx!: sum([1])\n', { file: 'x.yml' });
    expect(problem!.message).toContain('built-in');
  });
});

describe('$functions the application passes', () => {
  const text = `
$functions:
  fileCount(mask):
    about: How many files match the mask.
  many(mask)!: fileCount(mask) > 2
specs!: fileCount("*.spec.ts")
crowded!: many("*.ts")
`;
  const fileCount = (mask: string) => (mask === '*.ts' ? 5 : 1);

  test('a declared function is called with what the formula gives it, also from a $functions formula', async () => {
    const document = await scripted.loadText(text, { file: 'x.yml' });
    expect(document.resolve({ functions: { fileCount } })).toEqual({ specs: 1, crowded: true });
    expect(document.functions.map((fn) => [fn.name, fn.parameters, fn.about])).toEqual([['fileCount', ['mask'], 'How many files match the mask.']]);
  });

  test('it validates with no import, and needs no value', async () => {
    expect(await scripted.validateText(text, { file: 'x.yml' })).toEqual([]);
    expect(await scripted.validateText('$functions:\n  clock():\nx!: clock()\n', { file: 'x.yml' })).toEqual([]);
  });

  test('a declared function that is not passed, or is not a function, fails the resolve', async () => {
    const document = await scripted.loadText(text, { file: 'x.yml' });
    expect(() => document.resolve()).toThrow('the function "fileCount" is declared in $functions for the application to pass; it was not passed');
    expect(() => document.resolve({ functions: { fileCount: 3 } })).toThrow('the function "fileCount" must be passed as a function');
    expect(() => document.resolve({ functions: { fileCount: async () => 1 } })).toThrow('is async');
  });

  test('a passed function that returns a promise is an error', async () => {
    const document = await scripted.loadText(text, { file: 'x.yml' });
    expect(() => document.resolve({ functions: { fileCount: () => Promise.resolve(1) } })).toThrow('returned a promise');
  });

  test('a function nobody declared is still unknown', async () => {
    const [problem] = await scripted.validateText('x!: fileCount("*")\n', { file: 'x.yml' });
    expect(problem!.message).toContain('unknown function "fileCount"');
  });

  test('a declared function is text, not a formula: its value is a map or nothing', async () => {
    const [problem] = await scripted.validateText('$functions:\n  f(x): floor(x)\ny!: f(1)\n', { file: 'x.yml' });
    expect(problem!.message).toContain('write "f(x)!"');
  });

  test('its name may not be a built-in, a formula of $functions, an import or a key', async () => {
    const messages = async (yaml: string) => (await scripted.validateText(yaml, { file: 'x.yml' })).map((problem) => problem.message).join('\n');
    expect(await messages('$functions:\n  sum(items):\nx!: sum([1])\n')).toContain('built-in');
    expect(await messages('$functions:\n  f(a)!: a\n  f(b):\nx!: f(1)\n')).toContain('declared twice');
    expect(await messages('$functions:\n  f(a):\n  f(b)!: b\nx!: f(1)\n')).toContain('declared twice');
    expect(await messages('$functions:\n  f(a):\nf: 1\n')).toContain('the key "f" has the name of a function');
  });

  test('$tests get the functions from the application', async () => {
    const document = await scripted.loadText(`${text}$tests:\n  - { about: counts, expect: { specs: 1, crowded: true } }\n`, { file: 'x.yml' });
    expect(document.test({ functions: { fileCount } })[0]!.passed).toBe(true);
    expect(document.test()[0]!.failures[0]).toContain('was not passed');
  });

  test('an imported scripted-yaml file gets them too', async () => {
    const files = new MemoryFiles({ 'counts.yml': '$functions:\n  fileCount(mask):\nspecs!: fileCount("*.ts")\n' });
    const document = new ScriptedYaml({ files }).loadTextSync('$import:\n  counts.yml: counts\nx!: counts.specs\n', { file: 'x.yml' });
    expect(document.resolve({ functions: { fileCount } })).toEqual({ x: 5 });
  });

  test('a patch can turn a declared function into a formula, and the merged form keeps it', async () => {
    const files = new MemoryFiles({ 'base.yml': text });
    const local = new ScriptedYaml({ files });
    const document = local.loadTextSync('$extends: base.yml\n$functions:\n  fileCount(mask)!: 3\n', { file: 'patch.yml' });
    expect(document.functions).toEqual([]);
    expect(document.resolve()).toEqual({ specs: 3, crowded: true });
    const again = local.loadTextSync(stringify(document.merged()), { file: 'merged.yml' });
    expect(again.resolve()).toEqual({ specs: 3, crowded: true });
  });
});

describe('built-in text functions', () => {
  test('each one, called from a formula and from {{ }}', async () => {
    const result = await resolve(`
title: "  Summer Sale: 50% off!  "
name: order line_items
trimmed!: trim(title)
slug!: slug(title)
snake!: snakecase(name)
kebab!: kebabcase(name)
camel!: camelcase(name)
pascal!: pascalcase(name)
titled!: titlecase(name)
capital!: capitalize(name)
lower!: lowercase("Order ID")
upper!: uppercase(name)
path: /pages/{{ slug(title) }}
`);
    expect(result).toMatchObject({
      trimmed: 'Summer Sale: 50% off!',
      slug: 'summer-sale-50-off',
      snake: 'order_line_items',
      kebab: 'order-line-items',
      camel: 'orderLineItems',
      pascal: 'OrderLineItems',
      titled: 'Order Line Items',
      capital: 'Order line_items',
      lower: 'order id',
      upper: 'ORDER LINE_ITEMS',
      path: '/pages/summer-sale-50-off',
    });
  });

  test('slug keeps a path readable: an issue URL becomes a branch name', async () => {
    const document = await scripted.loadText('$vars:\n  ISSUE_URL: {}\nbranch!: slug(replace(vars.ISSUE_URL, "^[a-z]+://[^/]*|[?#].*$", ""))\n', { file: 'x.yml' });
    expect(document.resolve({ vars: { ISSUE_URL: 'https://github.com/org/Repo/issues/42?x=1' } })).toEqual({ branch: 'org-repo-issues-42' });
  });

  test('anything that is not text gives null, as FEEL built-ins do', async () => {
    expect(await resolve('a!: slug(null)\nb!: snakecase(5)\nc!: trim(null) = null\n')).toEqual({ a: null, b: null, c: true });
  });

  test('a key may have the name of one; the call is still the function', async () => {
    expect(await resolve('title: Summer Sale\nslug!: slug(title)\ncopy!: slug\n')).toEqual({ title: 'Summer Sale', slug: 'summer-sale', copy: 'summer-sale' });
  });

  test('one formula may not read a key and call the built-in of its name', async () => {
    const [problem] = await scripted.validateText('title: Summer Sale\nslug: summer-sale\nok!: slug = slug(title)\n', { file: 'x.yml' });
    expect(problem!.message).toBe('"slug" is read as a key and called as a built-in function in one formula; put the call in a key of its own');
    const rule = '$schema:\n  required: [pages*:Page]\n  Page:\n    required: [slug, title]\n    rules:\n      - valid!: slug = slug(title)\n        message: bad slug\npages:\n  - slug: summer-sale\n    title: Summer Sale\n';
    expect((await scripted.validateText(rule, { file: 'x.yml' }))[0]!.message).toContain('put the call in a key of its own');
  });

  test('$functions and $import may not take the name of one', async () => {
    const [problem] = await scripted.validateText('$functions:\n  slug(text)!: lower case(text)\nx!: slug("A")\n', { file: 'x.yml' });
    expect(problem!.message).toBe('the function "slug" has the name of a built-in function; remove it and call slug(text), which is built in, or give it another name');
    const [spaced] = await scripted.validateText('$functions:\n  snakecase(text):\nx!: snakecase("A")\n', { file: 'x.yml' });
    expect(spaced!.message).toContain('built-in');
  });

  test('a rule of a $schema may call one', async () => {
    const text = (id: string) => `
$schema:
  required: [pages*:Page]
  Page:
    required: [id, title]
    rules:
      - valid!: id = slug(title)
        message: the id must be the slug of the title
pages:
  - id: ${id}
    title: Summer Sale
`;
    expect(await scripted.validateText(text('summer-sale'), { file: 'x.yml' })).toEqual([]);
    expect((await scripted.validateText(text('summer'), { file: 'x.yml' })).map((problem) => problem.message)).toEqual(['the id must be the slug of the title']);
  });
});
