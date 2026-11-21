// Files that are not on a disk: the `read` option, the sync calls, and `merged()`.
import { describe, expect, test } from 'bun:test';
import { stringify } from 'yaml';
import { ScriptedYaml, ValidationFailed } from '../src/index';

const files: Record<string, string> = {
  'base.yml': ['$dsl: ./shape.dsl.yml', 'name: base', 'limit: 5', 'stages:', '  - id: build', '    when!: limit > 3', '    run!sh: make'].join('\n'),
  'shape.dsl.yml': ['$schema:', '  required: [name, stages*:Stage]', '  optional: [limit]', '  Stage:', '    required: [id]', '    optional: [when, run]'].join('\n'),
};

const read = (path: string) => files[path.replace(/^\.\//, '')];
const scripted = () => new ScriptedYaml({ read, markers: { sh: (source: string) => ({ toString: () => source }) } });

describe('read', () => {
  test('$extends and $dsl are read through it, with no file on disk', () => {
    const document = scripted().loadTextSync('$extends: ./base.yml\n$replace:\n  name: mine\n', { file: 'mine.yml' });
    expect(document.data.name).toBe('mine');
    expect(document.resolveSync().stages[0].when).toBe(true);
  });

  test('the DSL it reads checks the file', () => {
    const problems = scripted().validateTextSync('$dsl: ./shape.dsl.yml\nname: x\n', { file: 'x.yml' });
    expect(problems.map((problem) => problem.message)).toContain('missing required field "stages"');
  });

  test('it may name the file, so two files of one name are told apart', () => {
    const reader = new ScriptedYaml({ read: (path, from) => (from === 'own/base.yml' ? { file: 'bundled/base.yml', text: 'name: bundled\n' } : undefined) });
    const document = reader.loadTextSync('$extends: ./base.yml\n$replace:\n  name: own\n', { file: 'own/base.yml' });
    expect(document.data.name).toBe('own');
  });

  test('a file that comes back to itself is an error', () => {
    const loops = new ScriptedYaml({ read: () => '$extends: ./a.yml\n' });
    const problems = loops.validateTextSync('$extends: ./a.yml\n', { file: 'a.yml' });
    expect(problems.map((problem) => problem.message).join('\n')).toContain('extends itself');
  });

  test('undefined falls back to the disk', () => {
    const problems = new ScriptedYaml({ read: () => undefined }).validateTextSync('$extends: ./nowhere.yml\n', { file: 'x.yml' });
    expect(problems.map((problem) => problem.message).join('\n')).toContain('the file does not exist');
  });
});

describe('sync calls', () => {
  test('loadTextSync refuses a file that imports a module', () => {
    expect(() => scripted().loadTextSync('$import:\n  ./helpers.js: [slug]\nname: x\n', { file: 'x.yml' })).toThrow(ValidationFailed);
  });

  test('resolveSync gives what resolve gives', async () => {
    const document = scripted().loadTextSync('$vars:\n  n: {}\ndouble!: vars.n * 2\n');
    expect(document.resolveSync({ vars: { n: 4 } })).toEqual(await document.resolve({ vars: { n: 4 } }));
  });
});

describe('merged', () => {
  test('is the patched file as written: markers, formulas and keywords kept', () => {
    const document = scripted().loadTextSync('$extends: ./base.yml\nstages:\n  $after:\n    test:\n      run!sh: make test\n', { file: 'mine.yml' });
    expect(document.merged()).toEqual({
      $dsl: './shape.dsl.yml',
      name: 'base',
      limit: 5,
      stages: [
        { id: 'build', 'when!': 'limit > 3', 'run!sh': 'make' },
        { id: 'test', 'run!sh': 'make test' },
      ],
    });
  });

  test('a formula that reads base gets the base formula in brackets', () => {
    const patch = '$extends: ./base.yml\nstages:\n  build:\n    $replace:\n      when!: base and limit < 10\n';
    const document = scripted().loadTextSync(patch, { file: 'mine.yml' });
    const merged = document.merged() as { stages: Array<Record<string, unknown>> };
    expect(merged.stages[0]?.['when!']).toBe('(limit > 3) and limit < 10');
    const again = scripted().loadTextSync(stringify(merged), { file: 'mine.yml' });
    expect(again.resolveSync().stages[0].when).toBe(document.resolveSync().stages[0].when);
  });

  test('base in a text or a longer name stays', () => {
    const patch = '$extends: ./base.yml\n$replace:\n  limit!: \'if base > 1 then string length("base") else database\'\n$add:\n  database: 2\n';
    const document = scripted().loadTextSync(patch, { file: 'mine.yml' });
    expect(document.merged()['limit!']).toBe('if (5) > 1 then string length("base") else database');
  });
});

describe('without Node', () => {
  test('a file and its base load through read when Node gives no modules, as in a browser', () => {
    const saved = process.getBuiltinModule;
    (process as { getBuiltinModule?: unknown }).getBuiltinModule = undefined;
    try {
      const document = scripted().loadTextSync('$extends: ./base.yml\n$replace:\n  name: mine\n', { file: 'own/mine.yml' });
      expect(document.resolveSync().name).toBe('mine');
      expect(document.resolveSync().stages[0].when).toBe(true);
    } finally {
      process.getBuiltinModule = saved;
    }
  });

  test('the browser bundle imports nothing from Node', async () => {
    const built = await Bun.build({ entrypoints: [`${import.meta.dir}/../src/index.ts`], target: 'browser' });
    const code = await built.outputs[0]!.text();
    expect(code).not.toMatch(/["']node:[a-z]/);
  });
});
