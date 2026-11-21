// The skill teaches with examples. Each one is a file in skills/scripted-yaml/examples/,
// run here, and the skill must show it exactly as it is in the file.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { ScriptedYaml } from '../src/index';

const skillDir = join(import.meta.dir, '../skills/scripted-yaml');
const examples = join(skillDir, 'examples');
const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
const read = (name: string) => readFileSync(join(examples, name), 'utf8');

class Command {
  constructor(readonly shell: string) {}
  toString() {
    return '1';
  }
}

const scripted = new ScriptedYaml({ markers: { sh: (source: string) => new Command(source) } });
const validate = (name: string) => scripted.validateText(read(name), { file: join(examples, name) });
const cli = (...args: string[]) => {
  const run = Bun.spawnSync(['bun', join(import.meta.dir, '../src/cli.ts'), ...args], { cwd: examples });
  return { code: run.exitCode, out: run.stdout.toString() };
};

describe('skills/scripted-yaml/SKILL.md', () => {
  test('has the front matter of a skill and stays within 300 lines', () => {
    expect(skill).toStartWith('---\nname: scripted-yaml\ndescription: ');
    const front = parse(skill.slice(4, skill.indexOf('\n---\n', 4)));
    expect(Object.keys(front)).toEqual(['name', 'description']);
    expect(front.name).toBe('scripted-yaml');
    expect(typeof front.description).toBe('string');
    expect(front.description).toContain('scripted-yaml validate');
    expect(skill.split('\n').length).toBeLessThanOrEqual(300);
  });

  for (const name of ['pipeline.yml', 'shop.yml', 'team.yml', 'patch.yml', 'import.yml', 'mistakes.yml']) {
    test(`shows examples/${name} exactly as the file is`, () => {
      expect(skill).toContain(`\`\`\`yaml\n${read(name)}\`\`\``);
    });
  }

  for (const name of ['pipeline.yml', 'shop.yml', 'team.yml', 'base.yml', 'patch.yml', 'import.yml', 'fixed.yml']) {
    test(`examples/${name} has no problem`, async () => {
      expect(await validate(name)).toEqual([]);
    });
  }

  test('the output shown for the file of mistakes is what the command prints', () => {
    const run = cli('validate', 'mistakes.yml');
    expect(run.code).toBe(1);
    expect(skill).toContain(`\`\`\`\n${run.out}\`\`\``);
  });

  test('the output shown for the wrong team file is what the command prints', () => {
    const run = cli('validate', 'team-wrong.yml');
    expect(run.code).toBe(1);
    expect(skill).toContain(`\`\`\`\n${run.out}\`\`\``);
  });

  test('the fixed file computes the values the skill gives', () => {
    const run = cli('parse', 'fixed.yml');
    expect(JSON.parse(run.out)).toMatchObject({ same: true, allowed: true, blocked: false, first: 'a', label: 'Price: 10', ready: true, ci: false });
  });

  test('pipeline.yml: the plan stage runs with a staging URL; the command is asked for by the second condition only', async () => {
    const document = await scripted.loadText(read('pipeline.yml'), { file: join(examples, 'pipeline.yml') });
    const result = await document.resolve({ vars: { STAGING_URL: 'https://staging.example.com' } });
    expect(result.timeout).toBe('10m');
    expect(result.stages[0]).toEqual({ id: 'plan', title: 'Plan for main', when: true, task: 'Write a test plan for https://staging.example.com in plan.md.' });
    expect(result.stages[1].when).toBe(true);
    expect(result.stages[1].run).toBeInstanceOf(Command);
    expect(result.prerequisites.browser.$value).toBe(true);
  });

  test('shop.yml: its own $tests pass, and a big order changes the payment methods', async () => {
    const document = await scripted.loadText(read('shop.yml'), { file: join(examples, 'shop.yml') });
    expect((await document.test()).map((result) => result.failures)).toEqual([[], []]);
    const result = await document.resolve({ vars: { customer: { orders: [], tags: [] }, cart: { subtotal: 1200, items: [] } } });
    expect(result.discount).toEqual({ loyalty: 0, books: 0, $value: 0, note: 'The bigger of the two discounts applies.' });
    expect(result.checkout).toEqual({ payment_methods: ['card', 'bank_transfer'], note: 'Orders over 1000 need a card or a bank transfer.' });
    expect(result.shipping.map((option: { name: string }) => option.name)).toEqual(['Standard', 'Economy']);
  });

  test('the skill teaches the test command and the compact form of tests', () => {
    expect(cli('test', 'shop.yml').out.split('\n').slice(0, 2)).toEqual(['pass     shop.yml  A vip customer with three books', 'pass     shop.yml  A new customer with an empty cart']);
    expect(skill).toContain('scripted-yaml test <file>');
    expect(skill).toContain('each test is ONE line');
    for (const line of read('shop.yml').split('$tests:\n')[1]!.trimEnd().split('\n')) expect(line).toMatch(/^  - \{ about: .*\}$/);
  });

  test('team.yml: a list item is read by the field its schema names', async () => {
    const document = await scripted.loadText(read('team.yml'), { file: join(examples, 'team.yml') });
    expect((await document.resolve()).lead).toBe('reviewer');
  });

  test('patch.yml changes base.yml as the skill says', () => {
    const run = cli('parse', 'patch.yml', '--markers', 'sh', '--var', 'RELEASE=1');
    const result = JSON.parse(run.out);
    expect(result.name).toBe('release-checks');
    expect(result.stages.map((stage: { id: string }) => stage.id)).toEqual(['install', 'lint', 'test', 'coverage']);
    expect(result.stages[2]).toMatchObject({ when: true, task: 'Run the whole suite.\nFail on the first broken test.' });
  });

  test('import.yml computes what the skill shows', () => {
    const run = cli('parse', 'import.yml');
    expect(JSON.parse(run.out)).toEqual({ title: 'Summer Sale', path: '/pages/summer-sale', free_from: 'Free shipping from 50 EUR', releases: 'We release on Tuesdays.\n' });
    expect(skill).toContain('`path` as `"/pages/summer-sale"`');
  });
});
