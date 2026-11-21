// `$functions`: the short form (parameters in the key) and the long form (a whole FEEL function).
import { describe, expect, test } from 'bun:test';
import { ScriptedYaml } from '../src/index';

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
