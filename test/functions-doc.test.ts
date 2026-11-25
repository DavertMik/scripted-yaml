// docs/functions.md: every row of its tables is computed, and every built-in is listed.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { Builtins, TextFunctions } from '../src/builtins';
import { LazyFormula } from '../src/lazy-formula';
import { ScriptedYaml } from '../src/index';

const page = readFileSync(join(import.meta.dir, '../docs/functions.md'), 'utf8');
const rows = [...page.matchAll(/^\| `(.+)` \| `(.+)` \|$/gm)].map((match) => ({ call: match[1]!, result: match[2]! }));
const scripted = new ScriptedYaml();

/** The names FEEL ships, as `feelin` lists them in its source. */
const shipped = [...readFileSync(join(import.meta.dir, '../node_modules/feelin/dist/index.js'), 'utf8').matchAll(/^    '([a-z@][a-z ]*)': /gm)].map((match) => match[1]!);

describe('docs/functions.md', () => {
  for (const row of rows) {
    test(row.call, async () => {
      const document = await scripted.loadText(stringify({ 'x!': row.call }), { file: 'x.yml' });
      expect(JSON.stringify(document.resolve({ vars: {} }).x)).toBe(row.result);
    });
  }

  test('lists every built-in function, and no other', () => {
    const listed = (name: string) => rows.some((row) => row.call.includes(`${name}(`));
    const builtins = [...TextFunctions.names, ...shipped.filter((name) => Builtins.has(name))];
    expect(builtins.length).toBeGreaterThan(90);
    expect(builtins.filter((name) => !listed(name))).toEqual([]);
    const called = rows.flatMap((row) => LazyFormula.of(row.call).refs.filter((ref) => ref.call).map((ref) => ref.head));
    expect(called.filter((name) => !Builtins.has(name))).toEqual([]);
  });

  test('names the range functions feelin does not implement', () => {
    for (const name of ['overlaps before', 'overlaps after', 'finishes', 'finished by', 'during', 'starts', 'started by', 'coincides']) {
      expect(Builtins.has(name)).toBe(false);
      expect(page).toContain(`\`${name}\``);
    }
  });
});
