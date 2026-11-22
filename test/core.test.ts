// The library where there is no disk: files given by the application, the synchronous API,
// the merged form of a patch, and what validation and $tests settle without resolving.
import { describe, expect, test } from 'bun:test';
import { stringify } from 'yaml';
import { Volume } from 'memfs';
import { ResolveFailed, ScriptedYaml, ValidationFailed } from '../src/core.js';

// biome-ignore lint/suspicious/noExplicitAny: the error is checked by the test
const catching = (run: () => unknown): any => {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
};

const messages = (problems: { key: string; message: string }[]) => problems.map((problem) => `${problem.key}  ${problem.message}`);

/** Files in memory, by path, for `fs`. */
const memory = (files: Record<string, string>) => Volume.fromJSON(files, '/');

/** A user's pipelines beside the bundled ones: a user's `regression` may extend the bundled `regression`. */
const pipelines = memory({
  '/bundled/pipeline.dsl.yml': '$schema:\n  required: [stages*:Stage]\n  Stage:\n    required: [id]\n    optional: [when, run]\n',
  '/bundled/regression.yml': '$dsl: pipeline.dsl.yml\nstages:\n  - id: write-plan\n    when!: true\n  - id: test-cases\n    when!: false\n',
  '/user/regression.yml': '$extends: ../bundled/regression.yml\nstages:\n  test-cases:\n    $replace:\n      when!: not(base)\n',
});

describe('files read with an fs in memory', () => {
  test('a user file extends the bundled file of the same name: no loop, each file has its own path', () => {
    const scripted = new ScriptedYaml({ fs: pipelines });
    expect(scripted.validate('/user/regression.yml')).toEqual([]);
    expect(scripted.loadTextSync(String(pipelines.readFileSync('/user/regression.yml', 'utf8')), { file: '/user/regression.yml' }).resolve().stages[1]).toEqual({ id: 'test-cases', when: true });
  });

  test('a loop across files is found', () => {
    const problems = new ScriptedYaml({ fs: memory({ '/a.yml': '$extends: b.yml\n', '/b.yml': '$extends: a.yml\n' }) }).validate('/a.yml');
    expect(messages(problems)).toEqual(['$extends  "a.yml" extends itself, directly or through other files']);
  });

  test('a file the fs cannot read carries its message, on the line that names it', () => {
    const [problem] = new ScriptedYaml({ fs: pipelines }).validateText('$extends: ../bundled\n', { file: '/user/mine.yml' });
    expect(problem!.toString()).toStartWith('/user/mine.yml:1  $extends  cannot read "../bundled": EISDIR');
  });

  test('$dsl is read beside the file that names it', () => {
    const problems = new ScriptedYaml({ fs: pipelines }).validateText('$dsl: pipeline.dsl.yml\nstages:\n  - id: a\n    model: x\n', { file: '/bundled/mine.yml' });
    expect(messages(problems)).toEqual(['stages.a.model  "model" is not a field of the schema']);
  });

  test('with no fs given, a file that names another is a problem, not a crash', () => {
    expect(messages(new ScriptedYaml().validateText('$extends: base\n'))).toEqual(['$extends  cannot read "base": the file does not exist']);
    expect(messages(new ScriptedYaml().validateText('$extends: scripted-yaml/forms\n'))).toEqual(['$extends  cannot read "scripted-yaml/forms": templates are not read here (no templates directory is given)']);
  });

  test('templates are read from the directory given', () => {
    const fs = memory({ '/templates/greeting.yml': 'hello: world\n' });
    const scripted = new ScriptedYaml({ fs, templates: '/templates' });
    expect(scripted.loadTextSync('$extends: scripted-yaml/greeting\n').resolve()).toEqual({ hello: 'world' });
    expect(messages(scripted.validateText('$extends: scripted-yaml/nope\n'))).toEqual(['$extends  cannot read "scripted-yaml/nope": there is no such template (only scripted-yaml/greeting)']);
  });

  test('a YAML file imported from memory', () => {
    const document = new ScriptedYaml({ fs: memory({ '/shop/rates.yml': 'vip: 0.2\n' }) }).loadTextSync('$import:\n  rates.yml: rates\ncut!: rates.vip * 100\n', { file: '/shop/shop.yml' });
    expect(document.resolve()).toEqual({ cut: 20 });
  });
});

describe('the synchronous API', () => {
  const scripted = new ScriptedYaml({ markers: { sh: (source: string) => `ran ${source}` } });

  test('validate, load, resolve and test need no promise', () => {
    const text = '$vars:\n  N: { default: 2 }\ntwice!: vars.N * 2\n$tests:\n  - vars: { N: 3 }\n    expect: { twice: 6 }\n';
    expect(scripted.validateText(text)).toEqual([]);
    const document = scripted.loadTextSync(text);
    expect(document.resolve()).toEqual({ twice: 4 });
    expect(document.test().map((result) => result.passed)).toEqual([true]);
  });

  test('a module import is a problem without a promise, and loads with one', async () => {
    const text = '$import:\n  ./fixtures/host.ts: [double]\nx!: double(2)\n';
    const imported: string[] = [];
    const importModule = async (file: string) => {
      imported.push(file);
      return { double: (value: number) => value * 2 };
    };
    const withModules = new ScriptedYaml({ fs: memory({ '/fixtures/host.ts': '' }), importModule });
    const error = catching(() => withModules.loadTextSync(text, { file: '/x.yml' }));
    expect(error).toBeInstanceOf(ValidationFailed);
    expect(error.message).toContain('is a module, and importing one takes a promise: use load or loadText');
    expect((await withModules.loadText(text, { file: '/x.yml' })).resolve()).toEqual({ x: 4 });
    expect(imported).toEqual(['/fixtures/host.ts']);
  });

  test('a module that fails inside an imported YAML file fails the file that imports it', async () => {
    const fs = memory({ '/inner.yml': '$import:\n  ./mod.js: [nope]\nv: 1\n', '/mod.js': '' });
    const failure = await new ScriptedYaml({ fs }).loadText('$import:\n  inner.yml: inner\nx!: inner.v\n', { file: '/outer.yml' }).catch((error) => error);
    expect(failure).toBeInstanceOf(ValidationFailed);
    expect(failure.message).toContain('/outer.yml:2');
    expect(failure.message).toContain('modules are not imported here');
  });
});

describe('a patch and its merged form', () => {
  const base = [
    '$vars:',
    '  RELEASE: { optional: true }',
    'title: Pipeline',
    'checks:',
    '  ready:',
    '    $value!sh: test -f ready',
    'stages:',
    '  - id: build',
    '    when!: vars.RELEASE != null',
    '    notes:',
    '      text: built',
    '      size!: 1',
    '',
  ].join('\n');
  const patch = [
    '$extends: base.yml',
    '$replace:',
    '  title: "{{ base }} for release"',
    'checks:',
    '  ready:',
    '    $replace:',
    '      $value!: base and vars.RELEASE = "yes"',
    'stages:',
    '  build:',
    '    $replace:',
    '      when!: base and checks.ready',
    '      notes:',
    '        text!: base.text + " twice"',
    '        size!: base.size + 1',
    '',
  ].join('\n');
  const scripted = new ScriptedYaml({ fs: memory({ '/base.yml': base }), markers: { sh: (source: string) => (source === 'test -f ready' ? '1' : '0') } });
  const vars = { RELEASE: 'yes' };

  test('the merged form needs no base and resolves as the patch does: text, a map, a marked value, a formula', () => {
    const document = scripted.loadTextSync(patch, { file: '/patch.yml' });
    const merged = stringify(document.merged());
    expect(merged).not.toContain('$extends');
    const again = new ScriptedYaml({ markers: { sh: (source: string) => (source === 'test -f ready' ? '1' : '0') } }).loadTextSync(merged, { file: 'merged.yml' });
    expect(again.resolve({ vars })).toEqual(document.resolve({ vars }));
    expect(document.resolve({ vars })).toEqual({
      title: 'Pipeline for release',
      checks: { ready: { $value: true } },
      stages: [{ id: 'build', when: true, notes: { text: 'built twice', size: 2 } }],
    });
  });

  test('keys stay as written; the replaced entry is kept under $base only where base is read', () => {
    const merged = scripted.loadTextSync(patch, { file: '/patch.yml' }).merged();
    expect(merged.$vars).toEqual({ RELEASE: { optional: true } });
    expect(merged.title).toBe('{{ base }} for release');
    expect(merged.$base).toEqual({ title: 'Pipeline' });
    expect(merged.checks).toEqual({ ready: { '$value!': 'base and vars.RELEASE = "yes"', $base: { '$value!sh': 'test -f ready' } } });
    expect((merged.stages as unknown[])[0]).toEqual({
      id: 'build',
      'when!': 'base and checks.ready',
      notes: { 'text!': 'base.text + " twice"', 'size!': 'base.size + 1' },
      $base: { 'when!': 'vars.RELEASE != null', notes: { text: 'built', 'size!': 1 } },
    });
  });

  test('a merged form patched again keeps the chain of bases', () => {
    const first = stringify(scripted.loadTextSync(patch, { file: '/patch.yml' }).merged());
    const second = scripted.loadTextSync('stages:\n  build:\n    $replace:\n      when!: base or false\n', { file: '--stage', base: first });
    const merged = second.merged();
    expect(((merged.stages as Record<string, unknown>[])[0]!.$base as Record<string, unknown>).$base).toEqual({ 'when!': 'vars.RELEASE != null' });
    const reloaded = scripted.loadTextSync(stringify(merged), { file: 'again.yml' });
    expect(reloaded.resolve({ vars }).stages[0].when).toBe(true);
    expect(reloaded.resolve({ vars: {} }).stages[0].when).toBe(false);
    expect(second.resolve({ vars: {} })).toEqual(reloaded.resolve({ vars: {} }));
  });

  test('a patch given its base as text or data needs no $extends, and may not have one', () => {
    const document = scripted.loadTextSync('$replace:\n  a: 2\n', { base: { a: 1, b: 1 } });
    expect(document.resolve()).toEqual({ a: 2, b: 1 });
    const error = catching(() => scripted.loadTextSync('$extends: base.yml\n$replace:\n  a: 2\n', { base: 'a: 1\n' }));
    expect(error.message).toContain('does not name one with $extends');
  });

  test('a replaced marked entry that nothing reads as base is not passed to its marker', () => {
    const asked: string[] = [];
    const counting = new ScriptedYaml({ fs: memory({ '/b.yml': 'run!sh: old\n' }), markers: { sh: (source: string) => asked.push(source) } });
    const document = counting.loadTextSync('$extends: b.yml\n$replace:\n  run!sh: new\n', { file: '/a.yml' });
    expect(asked).toEqual(['new']);
    expect(document.marked.map((marked) => marked.source)).toEqual(['new']);
  });

  test('text added to a merged text that reads base keeps its base', () => {
    const first = stringify(scripted.loadTextSync(patch, { file: '/patch.yml' }).merged());
    const again = scripted.loadTextSync('title:\n  $after: Ship it.\n', { base: first });
    expect(again.resolve({ vars }).title).toBe('Pipeline for release\nShip it.');
  });

  test('a $base that names no entry is a problem', () => {
    expect(messages(scripted.validateText('a!: base\n$base:\n  b: 1\n'))).toContain('$base.b  "b" of $base is the base of no entry beside it');
  });
});

describe('what validation settles', () => {
  test('an alias to an anchor that does not exist is an error on its line', () => {
    const [problem] = new ScriptedYaml({ markers: ['sh'] }).validateText('a: 1\nrun!sh: *nope\n', { file: 'x.yml' });
    expect(problem!.line).toBe(2);
    expect(problem!.severity).toBe('error');
    expect(problem!.message).toContain('*nope');
  });

  test('strict: every warning is an error, and the file does not load', () => {
    const text = '$schema:\n  optional: [title]\ntitle: x\nmodel: y\n';
    expect(new ScriptedYaml().validateText(text).map((problem) => problem.severity)).toEqual(['warning']);
    const strict = new ScriptedYaml({ strict: true });
    expect(strict.validateText(text).map((problem) => problem.severity)).toEqual(['error']);
    expect(catching(() => strict.loadTextSync(text))).toBeInstanceOf(ValidationFailed);
  });
});

describe('$tests', () => {
  test('a key under expect may be a path through ids with a dash', () => {
    const text = [
      '$vars:',
      '  GO: { default: false }',
      'stages:',
      '  - id: write-plan',
      '    when!: vars.GO',
      '  - id: test-cases',
      '    when!: not(vars.GO)',
      '$tests:',
      '  - vars: { GO: true }',
      '    expect:',
      '      stages.write-plan.when: true',
      '      stages.test-cases.when: false',
      '      count(stages): 2',
      '  - expect:',
      '      stages.write-plan.when: true',
      '',
    ].join('\n');
    const results = new ScriptedYaml().loadTextSync(text).test();
    expect(results.map((result) => result.failures)).toEqual([[], ['stages.write-plan.when: expected true, got false']]);
  });

  test('values are compared as FEEL compares them: a map in any key order, a number is not its text', () => {
    const text = 'm:\n  a: 1\n  b: [1, 2]\nn: 1\n$tests:\n  - expect: { m: { b: [1, 2], a: 1 }, n: "1" }\n';
    expect(new ScriptedYaml().loadTextSync(text).test()[0]!.failures).toEqual(['n: expected "1", got 1']);
  });
});

describe('marked values', () => {
  test('the application sets a marked value after load; resolve reads it, a boolean as it is', () => {
    const document = new ScriptedYaml({ markers: { sh: () => null } }).loadTextSync('ok:\n  $value!sh: test -f x\ngo!: ok\n');
    expect(document.marked.map((marked) => [marked.path, marked.marker, marked.source])).toEqual([['ok.$value!sh', 'sh', 'test -f x']]);
    document.marked[0]!.value = true;
    expect(document.resolve()).toEqual({ ok: { $value: true }, go: true });
    document.marked[0]!.value = '0';
    expect(document.resolve().go).toBe(false);
  });

  test('a resolve that fails still throws ResolveFailed', () => {
    const document = new ScriptedYaml().loadTextSync('$vars:\n  N: {}\nx!: vars.N\n');
    expect(catching(() => document.resolve())).toBeInstanceOf(ResolveFailed);
  });
});
