// The conversion skill shows one example: a class before, the YAML file and the class after.
// The skill must show the files as they are, and the old and new code must give the same totals.
import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { ScriptedYaml } from '../src/index';
import { type Account, Billing as Before, type Store } from '../skills/scripted-yaml-convert/examples/before';

const skillDir = join(import.meta.dir, '../skills/scripted-yaml-convert');
const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
const read = (name: string) => readFileSync(join(skillDir, 'examples', name), 'utf8');

// after.ts imports "scripted-yaml" by its name, as an application does, so it needs the built package.
let After: typeof Before;
beforeAll(async () => {
  const build = Bun.spawnSync(['bun', 'run', 'build'], { cwd: join(import.meta.dir, '..') });
  if (build.exitCode !== 0) throw new Error(`bun run build failed:\n${build.stderr}`);
  ({ Billing: After } = await import(join(skillDir, 'examples/after.ts')));
}, 120_000);

/** A store in memory: one account in, the saved totals out. */
class MemoryStore implements Store {
  readonly saved: number[] = [];
  constructor(private readonly found: Account) {}
  async account() {
    return this.found;
  }
  async saveInvoice(_id: string, total: number) {
    this.saved.push(total);
  }
}

describe('skills/scripted-yaml-convert/SKILL.md', () => {
  test('has the front matter of a skill and stays within 160 lines', () => {
    const front = parse(skill.slice(4, skill.indexOf('\n---\n', 4)));
    expect(Object.keys(front)).toEqual(['name', 'description']);
    expect(front.name).toBe('scripted-yaml-convert');
    expect(front.description).toStartWith('Use when');
    expect(skill.split('\n').length).toBeLessThanOrEqual(160);
  });

  test('shows the YAML file exactly as it is, and the file keeps its own limit of 150 lines', () => {
    expect(skill).toContain(`\`\`\`yaml\n${read('pricing.yml')}\`\`\``);
    expect(skill).toContain('at most 150 lines');
    expect(read('pricing.yml').split('\n').length).toBeLessThanOrEqual(150);
  });

  test('shows the code before and after as it is in the files', () => {
    const shown = [...skill.matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1]!);
    expect(shown.length).toBe(2);
    expect(read('before.ts')).toContain(shown[0]!);
    expect(read('after.ts')).toContain(shown[1]!);
  });

  test('pricing.yml has no problem and its own tests pass', async () => {
    const scripted = new ScriptedYaml();
    const path = join(skillDir, 'examples/pricing.yml');
    expect(await scripted.validate(path)).toEqual([]);
    const results = await (await scripted.load(path)).test();
    expect(results.length).toBe(3);
    expect(results.map((result) => result.failures)).toEqual([[], [], []]);
  });

  const accounts: Account[] = [
    { plan: 'free', seats: 2, yearly: false, nonprofit: false },
    { plan: 'free', seats: 9, yearly: true, nonprofit: false },
    { plan: 'team', seats: 5, yearly: false, nonprofit: false },
    { plan: 'team', seats: 8, yearly: false, nonprofit: false },
    { plan: 'team', seats: 8, yearly: true, nonprofit: false },
    { plan: 'team', seats: 8, yearly: false, nonprofit: true },
    { plan: 'business', seats: 14, yearly: true, nonprofit: true },
    { plan: 'business', seats: 40, yearly: true, nonprofit: false },
  ];

  for (const account of accounts) {
    test(`the code before and after give the same total: ${JSON.stringify(account)}`, async () => {
      const before = new MemoryStore(account);
      const after = new MemoryStore(account);
      const total = await new Before(before).invoice('a1');
      expect(await new After(after).invoice('a1')).toBe(total);
      expect(after.saved).toEqual(before.saved);
    });
  }
});
