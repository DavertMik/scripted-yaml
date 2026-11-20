import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { PipelineParser } from './pipeline';

const file = join(import.meta.dir, 'fixtures/release.yml');

/** A parser whose "is the tree clean" check is answered by the test, and counted. */
const parserWith = (clean: boolean) => {
  const asked: string[] = [];
  const parser = new PipelineParser((shell) => {
    asked.push(shell);
    return clean;
  });
  return { parser, asked };
};

describe('pipeline parser', () => {
  test('the fixture is a valid pipeline', async () => {
    expect(await parserWith(true).parser.validate(file)).toEqual([]);
  });

  test('on a release branch with a token, every stage runs', async () => {
    const { parser } = parserWith(true);
    const plan = await parser.parse(file, { GIT_BRANCH: 'release/2.0', NPM_TOKEN: 'secret' });
    expect(plan.name).toBe('release');
    expect(plan.stages.map((stage) => [stage.id, stage.runs])).toEqual([
      ['lint', true],
      ['test', true],
      ['notes', true],
      ['publish', true],
    ]);
  });

  test('shell commands are handed back as written, not run', async () => {
    const { parser, asked } = parserWith(true);
    const plan = await parser.parse(file, { GIT_BRANCH: 'main' });
    expect(plan.stages[0]!.command).toBe('npm run lint');
    expect(plan.stages[1]!.command).toBe('npm ci\nnpm test -- --reporter dot\n');
    expect(plan.stages[1]!.title).toBe('Tests on Node 22');
    expect(asked).toEqual(['git diff --quiet']);
  });

  test('a stage with a task carries its text, filled in', async () => {
    const plan = await parserWith(true).parser.parse(file, { GIT_BRANCH: 'release/2.0' });
    expect(plan.stages[2]!.task).toBe('Write the release notes for release/2.0 from the merged pull requests.');
    expect(plan.stages[2]!.command).toBeUndefined();
  });

  test('a skipped stage says why, from the prerequisites its condition reads', async () => {
    const plan = await parserWith(false).parser.parse(file, { GIT_BRANCH: 'main' });
    const [, , notes, publish] = plan.stages;
    expect(notes!.runs).toBe(false);
    expect(notes!.skipped).toEqual(['Not a release branch.']);
    expect(publish!.runs).toBe(false);
    expect(publish!.skipped).toEqual(['Publishing needs a release branch, a token and a clean tree.']);
  });

  test('the only command asked for is the one a condition reads, once', async () => {
    const { parser, asked } = parserWith(true);
    await parser.parse(file, { GIT_BRANCH: 'release/2.0', NPM_TOKEN: 'secret' });
    expect(asked).toEqual(['git diff --quiet']);
  });

  test('a pipeline that breaks a rule of the DSL is refused', async () => {
    const broken = join(import.meta.dir, 'fixtures/broken.yml');
    const problems = await parserWith(true).parser.validate(broken);
    expect(problems.map((problem) => problem.message)).toEqual(['missing required field "title"', 'no function is registered for the marker "bash"']);
    await expect(parserWith(true).parser.parse(broken, {})).rejects.toThrow('title');
  });
});
