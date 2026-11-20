// $extends, $schema, $dsl, $tests, and the files in examples/ loaded whole.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { type Problem, ResolveFailed, ScriptedYaml, ValidationFailed } from '../src/index';

const fixtures = join(import.meta.dir, 'fixtures');
const examples = join(import.meta.dir, '..', 'examples');
const patchFile = { file: join(fixtures, 'patch.yml') };

class Command {
  static asked = 0;
  constructor(readonly shell: string) {}
  toString() {
    Command.asked++;
    return '1';
  }
}

const scripted = () => new ScriptedYaml({ markers: { sh: (source: string) => new Command(source) } });
const errorsOf = async (text: string, options = { file: 'x.yml' }) => (await scripted().validate(text, options)).filter((problem) => problem.severity === 'error');
const messages = (problems: Problem[]) => problems.map((problem) => problem.message).join('\n');
const failure = (promise: Promise<unknown>) => promise.then(() => undefined).catch((error) => error);
const patched = (patch: string) => scripted().parse(`$extends: ./base.yml\n${patch}`, patchFile);

describe('$extends', () => {
  test('a patch with no changes is its base', async () => {
    const document = await patched('');
    expect(document.data.name).toBe('base');
    expect(document.data.stages.map((stage: { id: string }) => stage.id)).toEqual(['build', 'test']);
  });

  test('$replace overwrites fields that exist, and may turn text into a formula', async () => {
    const document = await patched('stages:\n  build:\n    $replace:\n      title: Compile\n      task!: \'"Build level " + string(vars.LEVEL)\'\n');
    const result = await document.resolve();
    expect(result.stages[0]).toEqual({ id: 'build', title: 'Compile', when: true, task: 'Build level 1', tags: ['a'] });
  });

  test('$replace at the top of the file', async () => {
    expect((await patched('$replace:\n  name: smoke\n')).data.name).toBe('smoke');
  });

  test('$replace of a field that does not exist is an error', async () => {
    const errors = await errorsOf('$extends: ./base.yml\nstages:\n  build:\n    $replace:\n      timeout: 5m\n', patchFile);
    expect(messages(errors)).toContain('timeout');
    expect(errors[0]!.line).toBe(5);
  });

  test('base is the inherited value', async () => {
    const document = await patched('$vars:\n  FAST: { optional: true }\nstages:\n  build:\n    $replace:\n      when!: base and vars.FAST = null\n');
    expect((await document.resolve()).stages[0].when).toBe(true);
    expect((await document.resolve({ vars: { FAST: 'yes' } })).stages[0].when).toBe(false);
    expect((await document.resolve({ vars: { LEVEL: 0 } })).stages[0].when).toBe(false);
  });

  test('base outside a patch is an unknown name', async () => {
    expect(messages(await errorsOf('x!: base\n'))).toContain('unknown name "base"');
  });

  test('a key that matches nothing in the base is an error, never a new item', async () => {
    const errors = await errorsOf('$extends: ./base.yml\nstages:\n  deploy:\n    $replace:\n      title: Deploy\n', patchFile);
    expect(errors.length).toBe(1);
    expect(errors[0]!.message).toContain('matches nothing');
    expect(errors[0]!.line).toBe(3);
    expect(errors[0]!.file).toBe(patchFile.file);
  });

  test('a plain field directly under an item is an error with a hint', async () => {
    const errors = await errorsOf('$extends: ./base.yml\nstages:\n  build:\n    title: Compile\n', patchFile);
    expect(errors.length).toBe(1);
    expect(errors[0]!.message).toContain('$replace');
  });

  test('$before and $after in a collection add items at the start and the end', async () => {
    const document = await patched('stages:\n  $after:\n    notify: { title: Notify }\n  $before:\n    lint: { title: Lint }\n    format: { title: Format }\n');
    expect(document.data.stages.map((stage: { id: string }) => stage.id)).toEqual(['lint', 'format', 'build', 'test', 'notify']);
  });

  test('$before and $after in one item add items in front of and behind it', async () => {
    const document = await patched('stages:\n  test:\n    $before:\n      seed: { title: Seed }\n    $after:\n      report: { title: Report }\n      clean: { title: Clean }\n');
    expect(document.data.stages.map((stage: { id: string }) => stage.id)).toEqual(['build', 'seed', 'test', 'report', 'clean']);
  });

  test('$before and $after in a text field and in a list field', async () => {
    const document = await patched('stages:\n  build:\n    task:\n      $before: First read the README.\n      $after: Then report.\n    tags:\n      $after: [b, c]\n      $before: z\n');
    expect(document.data.stages[0].task).toBe('First read the README.\nBuild it.\nThen report.');
    expect(document.data.stages[0].tags).toEqual(['z', 'a', 'b', 'c']);
  });

  test('$add puts new entries in a map; an existing one is an error', async () => {
    expect((await patched('checks:\n  $add:\n    types: { title: Types }\n')).data.checks).toEqual({ lint: { title: 'Lint' }, types: { title: 'Types' } });
    expect(messages(await errorsOf('$extends: ./base.yml\nchecks:\n  $add:\n    lint: { title: Again }\n', patchFile))).toContain('already exists');
  });

  test('$remove drops entries; a missing one is an error', async () => {
    const document = await patched('stages:\n  $remove: [test]\nchecks:\n  $remove: [lint]\n');
    expect(document.data.stages.map((stage: { id: string }) => stage.id)).toEqual(['build']);
    expect(document.data.checks).toEqual({});
    expect(messages(await errorsOf('$extends: ./base.yml\nstages:\n  $remove: [deploy]\n', patchFile))).toContain('deploy');
  });

  test('the position of a key in the patch means nothing', async () => {
    const first = await patched('stages:\n  $remove: [test]\n  $after:\n    last: { title: Last }\n');
    const second = await patched('stages:\n  $after:\n    last: { title: Last }\n  $remove: [test]\n');
    expect(first.data.stages.map((stage: { id: string }) => stage.id)).toEqual(second.data.stages.map((stage: { id: string }) => stage.id));
  });

  test('a patch adds variables and reads the ones of its base', async () => {
    const document = await patched('$vars:\n  EXTRA: { default: 2 }\nstages:\n  $after:\n    more:\n      title: More\n      when!: vars.LEVEL + vars.EXTRA > 2\n');
    expect((await document.resolve()).stages.at(-1).when).toBe(true);
  });

  test('a base that does not exist is a problem on the $extends line', async () => {
    const [problem] = await errorsOf('name: x\n$extends: ./nope.yml\n', patchFile);
    expect(problem!.line).toBe(2);
    expect(problem!.message).toContain('nope.yml');
  });

  test('files that extend each other are an error, not a loop', async () => {
    const error = await failure(scripted().load(join(fixtures, 'loop-a.yml')));
    expect(error).toBeInstanceOf(ValidationFailed);
    expect(error.message).toContain('extends itself');
  });

  test('a problem in the base is reported with the base file', async () => {
    const [problem] = await errorsOf('$extends: ./broken-base.yml\n', patchFile);
    expect(problem!.file).toBe(join(fixtures, 'broken-base.yml'));
    expect(problem!.line).toBe(2);
  });

  test('marker functions run once on the patched file, not on what was removed', async () => {
    const sources: string[] = [];
    const library = new ScriptedYaml({ markers: { sh: (source: string) => sources.push(source) } });
    await library.parse('$extends: ./base.yml\nstages:\n  $remove: [test]\n  $after:\n    lint: { title: Lint, run!sh: npm run lint }\n', patchFile);
    expect(sources).toEqual(['npm run lint']);
  });
});

describe('$schema', () => {
  const schema = `
$schema:
  required: [name, agents*:Agent]
  optional: [tags*, launch:Look]
  Agent:
    key: name
    required: [name, role:Role]
    optional: [about]
  Look:
    required: [icon]
  Role: [reviewer, tester]
`;

  test('many: a list, or a map whose keys are the names of the items', async () => {
    const list = `${schema}name: x\nagents:\n  - { name: ann, role: tester }\n`;
    const map = `${schema}name: x\nagents:\n  ann: { role: tester }\n`;
    expect(await scripted().validate(list, { file: 'x.yml' })).toEqual([]);
    expect(await scripted().validate(map, { file: 'x.yml' })).toEqual([]);
  });

  test('one value where many are marked is an error', async () => {
    expect(messages(await errorsOf(`${schema}name: x\nagents: ann\n`))).toContain('many');
  });

  test('a field of a named shape must be a map of that shape', async () => {
    expect(messages(await errorsOf(`${schema}name: x\nagents: []\nlaunch: fast\n`))).toContain('Look');
    expect(messages(await errorsOf(`${schema}name: x\nagents: []\nlaunch: { colour: red }\n`))).toContain('icon');
  });

  test('any field may be written as a formula or with a marker', async () => {
    const text = `${schema}name!: '"x"'\nagents:\n  - { name: ann, role!: 'if 1 > 0 then "tester" else "reviewer"' }\nlaunch:\n  icon!sh: pick-icon\n`;
    expect(await scripted().validate(text, { file: 'x.yml' })).toEqual([]);
  });

  test('a schema names the field that identifies an item', async () => {
    const text = `${schema}name: x\nagents:\n  - { name: ann, role: tester }\nrole_of_ann!: agents.ann.role\n`;
    const document = await scripted().parse(text, { file: 'x.yml' });
    expect((await document.resolve()).role_of_ann).toBe('tester');
  });

  test('a type the schema names and does not define is an error', async () => {
    expect(messages(await errorsOf('$schema:\n  required: [size:Size]\nsize: big\n'))).toContain('Size');
  });

  test('structure keywords are not unlisted keys', async () => {
    const text = `${schema}name: x\nagents:\n  - name: ann\n    role: tester\n    $if!: 1 > 0\n`;
    expect(await scripted().validate(text, { file: 'x.yml' })).toEqual([]);
  });

  test('a file with only a schema is a DSL file: it is not checked against itself', async () => {
    expect(await scripted().validate(schema, { file: 'agents.dsl.yml' })).toEqual([]);
  });
});

describe('$dsl', () => {
  const stepsFile = { file: join(fixtures, 'steps.yml') };
  const steps = (body: string) => `$dsl: ./step.dsl.yml\nsteps:\n${body}`;

  test('the DSL checks the shape and makes its variables known', async () => {
    const text = steps('  - name: a\n    task: Do it on {{ vars.CI_HOST }}\n');
    expect(await scripted().validate(text, stepsFile)).toEqual([]);
    const problems = await scripted().validate(steps('  - task: x\n    colour: red\n'), stepsFile);
    expect(problems.map((problem) => problem.severity).sort()).toEqual(['error', 'warning']);
  });

  test('without the $dsl line the file computes the same values', async () => {
    const body = '  - name: a\n    task: Run on {{ vars.CI_HOST }}\n    $if!: vars.CI_HOST != null\n';
    const withDsl = await (await scripted().parse(steps(body), stepsFile)).resolve({ vars: { CI_HOST: 'ci-1' } });
    const without = await (await scripted().parse(`steps:\n${body}`, stepsFile)).resolve({ vars: { CI_HOST: 'ci-1' } });
    expect(withDsl).toEqual(without);
    expect(withDsl.steps[0].task).toBe('Run on ci-1');
  });

  test('a DSL gives no value and asks for none', async () => {
    const document = await scripted().parse(steps('  - name: a\n    task: x\n'), stepsFile);
    expect(document.variables).toEqual([]);
    expect(await document.resolve()).toEqual({ steps: [{ name: 'a', task: 'x' }] });
  });

  test('a rule is checked syntactically at validation and computed at resolve', async () => {
    expect(await scripted().validate(steps('  - name: a\n    task: x\n    run!sh: ls\n'), stepsFile)).toEqual([]);
    const document = await scripted().parse(steps('  - name: a\n    task: x\n    run!sh: ls\n  - name: b\n'), stepsFile);
    const error = await failure(document.resolve());
    expect(error).toBeInstanceOf(ResolveFailed);
    expect(error.problems.map((problem: Problem) => [problem.key, problem.message])).toEqual([
      ['steps.a', 'a step has either task or run'],
      ['steps.b', 'a step has either task or run'],
    ]);
  });

  test('a rule sees a marked field as written: its value is never asked for', async () => {
    Command.asked = 0;
    const document = await scripted().parse(steps('  - name: a\n    run!sh: rm -rf /\n'), stepsFile);
    const result = await document.resolve();
    expect(Command.asked).toBe(0);
    expect(result.steps[0].run).toBe(document.data.steps[0].run);
  });

  test('names a schema gives a field through "with" are known, and null when resolved', async () => {
    const text = steps('  - name: a\n    task: x\n    note: Attempt {{ attempt }}.\n');
    expect(await scripted().validate(text, stepsFile)).toEqual([]);
    expect((await (await scripted().parse(text, stepsFile)).resolve()).steps[0].note).toBe('Attempt .');
    expect(messages(await errorsOf(steps('  - name: a\n    task: Attempt {{ attempt }}.\n'), stepsFile))).toContain('attempt');
  });

  test('a rule that reads a name that is not a field is a problem of the DSL', async () => {
    const text = '$schema:\n  required: [items*:Item]\n  Item:\n    required: [id]\n    rules:\n      - valid!: id != nme\n        message: no\nitems: []\n';
    expect(messages(await errorsOf(text))).toContain('nme');
  });
});

describe('$tests', () => {
  const shop = `
$vars:
  cart: {}
settings: { free_from: 50 }
free_shipping!: vars.cart.total >= settings.free_from
shipping:
  - name: Standard
    price!: if free_shipping then 0 else 4.9
discount:
  $value!: if vars.cart.total > 100 then 10 else 0
  note: Over 100 only.
$tests:
  - about: A small order pays for shipping
    vars: { cart: { total: 20 } }
    expect:
      free_shipping: false
      shipping[1].price: 4.9
      discount: 0
  - about: A big order ships free
    vars: { cart: { total: 120 } }
    expect:
      shipping[1].price: 0
      discount: 10
      discount.note: Over 100 only.
`;

  test('each test resolves the file with its vars and compares the paths under expect', async () => {
    const results = await (await scripted().parse(shop, { file: 'shop.yml' })).test();
    expect(results.map((result) => [result.about, result.passed, result.failures])).toEqual([
      ['A small order pays for shipping', true, []],
      ['A big order ships free', true, []],
    ]);
  });

  test('a wrong expectation is a failure that shows both values', async () => {
    const results = await (await scripted().parse(shop.replace('discount: 10', 'discount: 15'), { file: 'shop.yml' })).test();
    expect(results[1]!.passed).toBe(false);
    expect(results[1]!.failures).toEqual(['discount: expected 15, got 10']);
  });

  test('a test whose vars are incomplete fails with the reason', async () => {
    const results = await (await scripted().parse('$vars:\n  N: {}\nx!: vars.N\n$tests:\n  - expect: { x: 1 }\n', { file: 'x.yml' })).test();
    expect(results[0]!.about).toBe('test 1');
    expect(results[0]!.failures[0]).toContain('N');
  });

  test('$tests is not part of the data or the result', async () => {
    const document = await scripted().parse(shop, { file: 'shop.yml' });
    expect('$tests' in document.data).toBe(false);
    expect(Object.keys(await document.resolve({ vars: { cart: { total: 1 } } }))).toEqual(['settings', 'free_shipping', 'shipping', 'discount']);
  });

  test('a file without $tests has no results', async () => {
    expect(await (await scripted().parse('a: 1\n')).test()).toEqual([]);
  });
});

describe('the files in examples/', () => {
  const pipelines = ['api-testing', 'regression', 'web-testing', 'web-testing-smoke'];

  for (const name of pipelines) {
    test(`pipelines/${name}.yml loads with no problem at all`, async () => {
      const file = join(examples, 'pipelines', `${name}.yml`);
      expect(await scripted().validate(await Bun.file(file).text(), { file })).toEqual([]);
      expect((await scripted().load(file)).data.stages.length).toBeGreaterThan(0);
    });
  }

  test('pipelines/pipeline.dsl.yml is valid by itself', async () => {
    const file = join(examples, 'pipelines/pipeline.dsl.yml');
    expect(await scripted().validate(await Bun.file(file).text(), { file })).toEqual([]);
  });

  test('web-testing resolves: a command is asked for only where a formula reads it', async () => {
    const document = await scripted().load(join(examples, 'pipelines/web-testing.yml'));
    Command.asked = 0;
    const result = await document.resolve({ vars: { EXPLORBOT_URL: 'https://staging.example.com', EXPLORBOT_AI_PROVIDER: 'x' } });
    expect(Command.asked).toBe(1);
    expect(result.prerequisites.can_explore.$value).toBe(true);
    expect(result.prerequisites.browser).toEqual({ $value: true, message: 'No browser. Run npx playwright install --with-deps chromium.' });
    expect(result.stages[1].task).toContain('https://staging.example.com');
    expect(result.stages[2].run).toBe(document.data.stages[2].run);
    expect(result.packages.explorbot).toBe('latest');
  });

  test('web-testing without a staging URL does not ask for the browser... but FEEL reads both sides of "and"', async () => {
    const document = await scripted().load(join(examples, 'pipelines/web-testing.yml'));
    Command.asked = 0;
    const result = await document.resolve({ vars: {} });
    expect(result.prerequisites.can_explore.$value).toBe(false);
    expect(Command.asked).toBe(1);
  });

  test('the smoke patch resolves: base is the inherited condition', async () => {
    const document = await scripted().load(join(examples, 'pipelines/web-testing-smoke.yml'));
    const vars = { EXPLORBOT_URL: 'https://s.example.com', EXPLORBOT_AI_PROVIDER: 'x' };
    const explore = async (branch: string) => (await document.resolve({ vars: { ...vars, GIT_BRANCH: branch } })).stages.find((stage: { id: string }) => stage.id === 'explore');
    expect((await explore('release/1.2')).when).toBe(true);
    expect((await explore('main')).when).toBe(false);
    const review = document.data.stages.find((stage: { id: string }) => stage.id === 'review');
    expect(review.task).toEndWith('/qa-review-pr\nKeep the list to the five most important scenarios.');
  });

  test('shop.yml resolves for a cart and a customer', async () => {
    const document = await scripted().load(join(examples, 'shop.yml'));
    const result = await document.resolve({
      vars: {
        cart: {
          subtotal: 120,
          weight: 3,
          items: [
            { name: 'Dune', category: 'books', price: 10, on_sale: false },
            { name: 'Emma', category: 'books', price: 8, on_sale: true },
            { name: 'Ubik', category: 'books', price: 12, on_sale: false },
          ],
        },
        customer: { orders: [1, 2], tags: ['vip'] },
        destination: { country: 'NL' },
        today: { month: 11, day: 25 },
      },
    });
    expect(result.is_vip).toBe(true);
    expect(result.discount_codes.VIP20.valid).toBe(true);
    expect(result.discount_codes.WELCOME10.valid).toBe(false);
    expect(result.discount_codes.BLACKFRIDAY.percent).toBe(35);
    expect(result.discount_codes.FREESHIP.message).toBe('Free shipping covers parcels up to 20 kg within NL, BE, DE.');
    expect(result.bundles[2]).toMatchObject({ applies: true, saving: 4 });
    expect(result.shipping.map((option: { name: string }) => option.name)).toEqual(['Standard', 'Express', 'Pickup point']);
    expect(result.shipping[1].price).toBe(0);
  });

  test('router.yml loads with its controllers and resolves for a request', async () => {
    const file = join(examples, 'router.yml');
    expect((await scripted().validate(await Bun.file(file).text(), { file })).filter((problem) => problem.severity === 'error')).toEqual([]);
    const document = await scripted().load(file);
    const vars = { user: { role: 'editor', projects: ['shop'] }, method: 'PATCH', project: 'shop', token: 't', test: 1, run: 2, member: 3 };
    const result = await document.resolve({ vars });
    expect(result.writer).toBe(true);
    expect(result.admin).toBe(false);
    expect(result.routes['/api/v1']['/projects/:project'].allow).toBe(true);
    expect(result.routes['/api/v1']['GET /me']({ params: {} })).toBe('Users.me');
    expect(result.routes['/admin'].allow).toBe(false);
  });
});
