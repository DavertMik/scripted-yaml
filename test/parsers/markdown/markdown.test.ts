import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { MarkdownParser } from './markdown';

const file = join(import.meta.dir, 'fixtures/onboarding.md');
const parser = new MarkdownParser();

describe('markdown parser', () => {
  test('the front matter is a valid scripted-yaml file', async () => {
    expect(await parser.validate(file)).toEqual([]);
  });

  test('a !mdq key is the Markdown its selector picks', async () => {
    const guide = await parser.parse(file);
    expect(guide.name).toBe('onboarding');
    expect(guide.summary).toBe('Everything a new engineer does in the first week.');
    expect(guide.steps[0]!.text).toStartWith('## Accounts\n\nAsk for these on day one.');
  });

  test('another marker of the same application returns rows as data', async () => {
    const guide = await parser.parse(file);
    expect(guide.steps[0]!.tools).toEqual([
      { tool: 'GitHub', owner: 'Ann' },
      { tool: 'Sentry', owner: 'Raj' },
    ]);
  });

  test('formulas of the front matter are computed from the variables', async () => {
    expect((await parser.parse(file)).greeting).toBe('Welcome to the platform team');
    expect((await parser.parse(file, { TEAM: 'mobile' })).greeting).toBe('Welcome to the mobile team');
  });

  test('a step with $if is there only when its condition holds', async () => {
    expect((await parser.parse(file)).steps.map((step: { id: string }) => step.id)).toEqual(['accounts', 'first-task']);
    const withBuddy = await parser.parse(file, { BUDDY: 'Ann' });
    expect(withBuddy.steps.map((step: { title: string }) => step.title)).toEqual(['Accounts', 'Meet Ann', 'First task']);
  });

  test('{{ }} inside Markdown a marker returned is not a formula: it is left as written', async () => {
    const buddy = (await parser.parse(file, { BUDDY: 'Ann' })).steps[1]!;
    expect(buddy.text).toBe('Your buddy answers questions for {{ two }} weeks.');
  });

  test('a list comes back as Markdown text', async () => {
    const task = (await parser.parse(file)).steps.at(-1)!;
    expect(task.checklist).toBe('- Open a draft pull request early.\n- Ask for a review from your buddy.');
  });

  test('a problem in the front matter is reported by key, with the file name and no line', async () => {
    const broken = join(import.meta.dir, 'fixtures/broken.md');
    const [problem] = await parser.validate(broken);
    expect(problem!.toString()).toBe(`${broken}  steps.intro.text!md  no function is registered for the marker "md"`);
    await expect(parser.parse(broken)).rejects.toThrow('marker "md"');
  });

  test('the spec example examples/markdown/web-testing.md gives the values the spec shows', async () => {
    const example = join(import.meta.dir, '../../../examples/markdown/web-testing.md');
    const pipeline = await parser.parse(example, { EXPLORBOT_URL: 'https://staging.example.com' });
    expect(pipeline.description).toBe('Review a pull request, test the change in a browser, explain what broke.');
    expect(pipeline.stages[1].when).toBe(true);
    expect(pipeline.stages[1].checks).toBe('- Cover the changed pages first.\n- Skip anything behind a feature flag.');
    expect((await parser.parse(example)).stages[1].when).toBe(false);
  });
});
