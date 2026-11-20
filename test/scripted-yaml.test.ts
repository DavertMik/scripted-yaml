// The contract of the library, written before the library exists (SPEC.md section 7).
// Every test here is expected to FAIL until `src/` is written. Do not weaken a test to make it pass:
// if the spec and a test disagree, the spec wins and the test is fixed with a note.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { Formula, Problem, ResolveFailed, ScriptedYaml, Text, ValidationFailed } from '../src/index';

const fixtures = join(import.meta.dir, 'fixtures');
const examples = join(import.meta.dir, '..', 'examples');

/** What an application returns for `!sh`. Counts how often a formula asked for its value. */
class ShellCommand {
  static asked = 0;
  constructor(readonly shell: string) {}
  toString() {
    ShellCommand.asked++;
    return this.shell.includes('fail') ? '0' : '1';
  }
}

const scripted = () => new ScriptedYaml({ markers: { sh: (source: string) => new ShellCommand(source) } });
const errors = (problems: Problem[]) => problems.filter((problem) => problem.severity === 'error');

describe('validate', () => {
  test('a correct file has no problems', async () => {
    const text = `
name: demo
$vars:
  REMOTE: { optional: true }
local!: vars.REMOTE = null
title: Tests on {{ name }}
run!sh: npm test
`;
    expect(await scripted().validate(text, { file: 'demo.yml' })).toEqual([]);
  });

  test('reports file, line, key and message', async () => {
    const text = 'name: demo\nstage:\n  run!bash: npm test\n';
    const [problem] = await scripted().validate(text, { file: 'demo.yml' });
    expect(problem).toBeInstanceOf(Problem);
    expect(problem!.file).toBe('demo.yml');
    expect(problem!.line).toBe(3);
    expect(problem!.key).toBe('stage.run!bash');
    expect(problem!.severity).toBe('error');
    expect(problem!.message).toContain('bash');
    expect(problem!.toString()).toContain('demo.yml:3');
  });

  test('invalid YAML is a problem, not an exception', async () => {
    const problems = await scripted().validate('a: [1, 2\nb: 3\n', { file: 'bad.yml' });
    expect(errors(problems).length).toBeGreaterThan(0);
  });

  test('duplicate keys are an error', async () => {
    expect(errors(await scripted().validate('a: 1\na: 2\n', { file: 'x.yml' })).length).toBe(1);
  });

  test('a formula that is not valid FEEL', async () => {
    const [problem] = errors(await scripted().validate('a: 1\nb!: a ==\n', { file: 'x.yml' }));
    expect(problem!.line).toBe(2);
    expect(problem!.key).toBe('b!');
  });

  test('a text template that is not valid FEEL', async () => {
    const problems = errors(await scripted().validate('a: 1\ntitle: Total {{ a + }}\n', { file: 'x.yml' }));
    expect(problems.length).toBe(1);
    expect(problems[0]!.key).toBe('title');
  });

  test('an unknown name in a formula', async () => {
    const [problem] = errors(await scripted().validate('total: 5\nbig!: totl > 3\n', { file: 'x.yml' }));
    expect(problem!.message).toContain('totl');
  });

  test('key and key! together', async () => {
    expect(errors(await scripted().validate('a: 1\na!: 2\n', { file: 'x.yml' })).length).toBe(1);
  });

  test('an unknown $keyword', async () => {
    const [problem] = errors(await scripted().validate('$varz:\n  A: {}\n', { file: 'x.yml' }));
    expect(problem!.message).toContain('$varz');
  });

  test('a variable that is read but not declared is a warning', async () => {
    const problems = await scripted().validate('ci!: vars.CI = null\n', { file: 'x.yml' });
    expect(problems.map((problem) => problem.severity)).toEqual(['warning']);
  });

  test('a key that reads itself through others', async () => {
    expect(errors(await scripted().validate('a!: b + 1\nb!: a + 1\n', { file: 'x.yml' })).length).toBeGreaterThan(0);
  });

  test('runs nothing: no marker function is called', async () => {
    let called = 0;
    const checker = new ScriptedYaml({ markers: { sh: () => called++ } });
    await checker.validate('run!sh: rm -rf /\n', { file: 'x.yml' });
    expect(called).toBe(0);
  });

  test('markers may be given by name only', async () => {
    const checker = new ScriptedYaml({ markers: ['sh'] });
    expect(await checker.validate('run!sh: npm test\n', { file: 'x.yml' })).toEqual([]);
  });

  test('an import of an unknown kind of file', async () => {
    const text = '$import:\n  ./data.csv: rows\n';
    const problems = errors(await scripted().validate(text, { file: join(fixtures, 'x.yml') }));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]!.message).toContain('csv');
  });
});

describe('parse and load', () => {
  const text = `
name: demo
$vars:
  URL: { optional: true }
ready!: vars.URL != null
task: Open {{ vars.URL }} now
run!sh: echo "\${HOME}" {{ not ours }}
`;

  test('nothing is computed; markers are applied; key names lose their marker', async () => {
    const document = await scripted().parse(text, { file: 'demo.yml' });
    expect(document.data.name).toBe('demo');
    expect(document.data.ready).toBeInstanceOf(Formula);
    expect(document.data.ready.source).toBe('vars.URL != null');
    expect(document.data.ready.reads).toEqual(['vars.URL']);
    expect(document.data.task).toBeInstanceOf(Text);
    expect(document.data.task.reads).toEqual(['vars.URL']);
    expect(document.data.run).toBeInstanceOf(ShellCommand);
    expect(document.data.run.shell).toBe('echo "${HOME}" {{ not ours }}');
    expect('run!sh' in document.data).toBe(false);
  });

  test('a file with errors throws ValidationFailed carrying the problems', async () => {
    const failure = await scripted().parse('run!bash: x\n', { file: 'x.yml' }).catch((error) => error);
    expect(failure).toBeInstanceOf(ValidationFailed);
    expect(failure.problems[0]).toBeInstanceOf(Problem);
  });

  test('parse accepts data that is already parsed', async () => {
    const document = await scripted().parse({ name: 'demo', 'big!': '2 > 1', 'run!sh': 'ls' }, { file: 'demo.md' });
    expect(document.data.big).toBeInstanceOf(Formula);
    expect(document.data.run).toBeInstanceOf(ShellCommand);
  });

  test('load reads a file and follows its $dsl and $import lines', async () => {
    const document = await scripted().load(join(examples, 'pipelines/regression.yml'));
    expect(document.data.name).toBe('regression');
    expect(document.data.stages[0].run).toBeInstanceOf(ShellCommand);
  });

  test('a path that does not exist is a problem on the line that names it', async () => {
    const failure = await scripted().parse('name: x\n$dsl: ./nope.dsl.yml\n', { file: join(fixtures, 'x.yml') }).catch((error) => error);
    expect(failure).toBeInstanceOf(ValidationFailed);
    expect(failure.problems[0].line).toBe(2);
  });
});

describe('resolve', () => {
  test('all variables in, all values out, as plain data', async () => {
    const document = await scripted().parse(
      `
$vars:
  URL: { optional: true }
  BRANCH: { default: origin/main }
ready!: vars.URL != null
task: Open {{ vars.URL }} on {{ vars.BRANCH }}
limit!: if ready then 30 else 10
`,
      { file: 'demo.yml' },
    );
    expect(await document.resolve({ vars: { URL: 'https://x.test' } })).toEqual({
      ready: true,
      task: 'Open https://x.test on origin/main',
      limit: 30,
    });
    expect((await document.resolve({ vars: {} })).ready).toBe(false);
  });

  test('an empty variable is null', async () => {
    const document = await scripted().parse('$vars:\n  REMOTE: { optional: true }\nlocal!: vars.REMOTE = null\n', { file: 'x.yml' });
    expect((await document.resolve({ vars: { REMOTE: '' } })).local).toBe(true);
  });

  test('missing required variables are all listed, before anything is computed', async () => {
    const document = await scripted().parse('$vars:\n  FIRST_NEEDED: {}\n  SECOND_NEEDED: {}\n  NOT_NEEDED: { optional: true }\nsum!: vars.FIRST_NEEDED + vars.SECOND_NEEDED\n', { file: 'x.yml' });
    const failure = await document.resolve({ vars: {} }).catch((error) => error);
    expect(failure).toBeInstanceOf(ResolveFailed);
    expect(failure.message).toContain('FIRST_NEEDED');
    expect(failure.message).toContain('SECOND_NEEDED');
    expect(failure.message).not.toContain('NOT_NEEDED');
  });

  test('$value: a formula that reads the node gets its value; other keys stay beside it', async () => {
    const document = await scripted().parse(
      `
$vars:
  REMOTE: { optional: true }
prerequisites:
  local:
    $value!: vars.REMOTE = null
    message: Tests run remotely.
when!: prerequisites.local
`,
      { file: 'x.yml' },
    );
    const result = await document.resolve({ vars: {} });
    expect(result.when).toBe(true);
    expect(result.prerequisites.local).toEqual({ $value: true, message: 'Tests run remotely.' });
  });

  test('keys are definitions: order in the file means nothing', async () => {
    const document = await scripted().parse('total!: price * qty\nprice: 4\nqty!: start + 1\nstart: 2\n', { file: 'x.yml' });
    expect((await document.resolve({ vars: {} })).total).toBe(12);
  });

  test('a marker value is asked for only when a formula reads it; "1" is true and "0" is false', async () => {
    const document = await scripted().parse(
      `
prerequisites:
  browser:
    $value!sh: ls chromium
  broken:
    $value!sh: fail
can_explore!: prerequisites.browser and not(prerequisites.broken)
run!sh: npx explorbot
`,
      { file: 'x.yml' },
    );
    ShellCommand.asked = 0;
    const result = await document.resolve({ vars: {} });
    expect(result.can_explore).toBe(true);
    expect(ShellCommand.asked).toBe(2);
    expect(result.run).toBeInstanceOf(ShellCommand);
    expect(result.run).toBe(document.data.run);
  });

  test('$functions are FEEL functions', async () => {
    const document = await scripted().parse(
      `
$functions:
  inCart!: function(wanted) items[category = wanted]
items:
  - { name: Dune, category: books }
  - { name: Lamp, category: home }
books!: inCart("books").name
`,
      { file: 'x.yml' },
    );
    expect((await document.resolve({ vars: {} })).books).toEqual(['Dune']);
  });

  test('$if, $unless and $each change the shape of the result', async () => {
    const document = await scripted().parse(
      `
$vars:
  vip: {}
  cities: {}
shipping:
  - name: Standard
  - name: Express
    $if!: vars.vip
  - name: Slow
    $unless!: vars.vip
  - $each!: vars.cities
    $as: city
    name: Pickup in {{ city }}
`,
      { file: 'x.yml' },
    );
    const result = await document.resolve({ vars: { vip: true, cities: ['Kyiv', 'Lviv'] } });
    expect(result.shipping.map((option: { name: string }) => option.name)).toEqual(['Standard', 'Express', 'Pickup in Kyiv', 'Pickup in Lviv']);
  });

  test('a FEEL warning is an error that names the key', async () => {
    const document = await scripted().parse('$vars:\n  cart: {}\nbig!: vars.cart.subtotl > 100\n', { file: 'x.yml' });
    const failure = await document.resolve({ vars: { cart: { subtotal: 120 } } }).catch((error) => error);
    expect(failure).toBeInstanceOf(ResolveFailed);
    expect(failure.message).toContain('big');
  });
});

describe('$import', () => {
  const file = join(fixtures, 'importing.yml');

  test('a module gives functions, a YAML file gives data, a Markdown file gives a query function', async () => {
    const document = await scripted().parse(
      `
$import:
  ./host.ts: [fileExists, double]
  ./settings.yml: settings
  ./book.md: book
covered!: fileExists("coverage.tests.yml")
twice!: double(settings.vip_after_orders)
title!: book("h1")
`,
      { file },
    );
    const result = await document.resolve({ vars: {} });
    expect(result.covered).toBe(true);
    expect(result.twice).toBe(20);
    expect(result.title).toContain('Dune');
  });

  test('an async function is refused when the module is imported', async () => {
    const failure = await scripted().parse('$import:\n  ./host.ts: [slow]\nx!: slow(1)\n', { file }).catch((error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('slow');
  });

  test('a function that returns a promise is refused when the formula runs', async () => {
    const document = await scripted().parse('$import:\n  ./host.ts: [promised]\nx!: promised(1)\n', { file });
    const failure = await document.resolve({ vars: {} }).catch((error) => error);
    expect(failure).toBeInstanceOf(ResolveFailed);
    expect(failure.message).toContain('promised');
  });

  test('a name the module does not export', async () => {
    const failure = await scripted().parse('$import:\n  ./host.ts: [nope]\n', { file }).catch((error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('nope');
  });
});

describe('$extends', () => {
  test('the smoke patch changes the web-testing pipeline as it says', async () => {
    const document = await scripted().load(join(examples, 'pipelines/web-testing-smoke.yml'));
    const ids = document.data.stages.map((stage: { id: string }) => stage.id);
    expect(ids[0]).toBe('lint');
    expect(ids.at(-1)).toBe('notify');
    expect(ids).not.toContain('results');
    const explore = document.data.stages.find((stage: { id: string }) => stage.id === 'explore');
    expect(explore.timeout).toBe('10m');
    expect(document.data.prerequisites.release.message).toBe('Not a release branch.');
  });
});

describe('$schema', () => {
  const schema = `
$schema:
  required: [name, stages*:Stage]
  optional: [target:Target]
  Stage:
    required: [id, title]
    optional: [run, task]
  Target: [issue, pr]
`;

  test('a file that fits', async () => {
    const text = `${schema}name: demo\ntarget: pr\nstages:\n  - { id: a, title: A }\n`;
    expect(await scripted().validate(text, { file: 'x.yml' })).toEqual([]);
  });

  test('a missing field and a word outside its type are errors; an unlisted key is a warning', async () => {
    const text = `${schema}name: demo\ntarget: branch\ncolour: red\nstages:\n  - { id: a }\n`;
    const problems = await scripted().validate(text, { file: 'x.yml' });
    expect(errors(problems).length).toBe(2);
    expect(problems.filter((problem) => problem.severity === 'warning').length).toBe(1);
  });
});
