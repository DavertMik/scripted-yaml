// The command line, run from source with bun. test/package.test.ts runs the built one with node.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const fixtures = join(import.meta.dir, 'fixtures/cli');

const cli = (...args: string[]) => {
  const run = Bun.spawnSync(['bun', join(root, 'src/cli.ts'), ...args], { cwd: fixtures });
  return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
};

describe('scripted-yaml validate', () => {
  test('a file without problems: says so, exit code 0', () => {
    const run = cli('validate', 'good.yml', '--markers', 'sh');
    expect(run.out).toBe('ok       good.yml\n');
    expect(run.code).toBe(0);
  });

  test('errors are printed with file, line, key and message; exit code 1', () => {
    const run = cli('validate', 'bad.yml', '--markers', 'sh');
    expect(run.out.split('\n')).toEqual([
      'error    bad.yml:3  run!bash  no function is registered for the marker "bash"',
      'error    bad.yml:4  big!  unknown name "totl"; did you mean "total"?',
      'warning  bad.yml:5  ci!  the variable "CI" is not declared in $vars; it is null unless the application passes it',
      '',
    ]);
    expect(run.code).toBe(1);
  });

  test('warnings alone do not fail', () => {
    const run = cli('validate', 'warn.yml');
    expect(run.out).toStartWith('warning  warn.yml:1  ci!');
    expect(run.code).toBe(0);
  });

  test('several files: every file is checked, one error fails the run', () => {
    const run = cli('validate', 'good.yml', 'bad.yml', 'warn.yml', '--markers', 'sh');
    expect(run.out).toContain('ok       good.yml');
    expect(run.out).toContain('error    bad.yml:3');
    expect(run.out).toContain('warning  warn.yml:1');
    expect(run.code).toBe(1);
  });

  test('a marker is known only when it is named', () => {
    const run = cli('validate', 'good.yml');
    expect(run.out).toContain('no function is registered for the marker "sh"');
    expect(run.code).toBe(1);
  });

  test('a file that does not exist is an error, not a crash', () => {
    const run = cli('validate', 'nope.yml');
    expect(run.out).toStartWith('error    nope.yml  cannot read the file');
    expect(run.code).toBe(1);
  });

  test('a Markdown file is checked by its front matter', () => {
    const run = cli('validate', 'page.md', '--markers', 'mdq');
    expect(run.out).toBe('error    page.md  ok!  unknown name "redy"; did you mean "ready"?\n');
    expect(run.code).toBe(1);
  });
});

describe('scripted-yaml parse', () => {
  test('prints the resolved data as JSON', () => {
    const run = cli('parse', 'good.yml', '--markers', 'sh', '--var', 'URL=https://x.test');
    expect(JSON.parse(run.out)).toEqual({
      name: 'demo',
      ready: true,
      task: 'Open https://x.test on main',
      run: { marker: 'sh', source: 'npm test' },
    });
    expect(run.code).toBe(0);
  });

  test('--var may repeat, and a value may hold "="', () => {
    const run = cli('parse', 'good.yml', '--markers', 'sh', '--var', 'URL=a=b', '--var', 'BRANCH=dev');
    expect(JSON.parse(run.out).task).toBe('Open a=b on dev');
  });

  test('--vars reads values from a JSON file, with their types; --var wins', () => {
    const run = cli('parse', 'typed.yml', '--vars', 'vars.json', '--var', 'label=cli');
    expect(JSON.parse(run.out)).toEqual({ total: 12, label: 'cli', first: 'a' });
  });

  test('a missing required variable: the reason on stderr, exit code 1, nothing on stdout', () => {
    const run = cli('parse', 'typed.yml');
    expect(run.out).toBe('');
    expect(run.err).toContain('missing required variables: amount, items');
    expect(run.code).toBe(1);
  });

  test('a file with errors is not parsed', () => {
    const run = cli('parse', 'bad.yml', '--markers', 'sh');
    expect(run.out).toBe('');
    expect(run.err).toContain('bad.yml:4  big!  unknown name "totl"');
    expect(run.code).toBe(1);
  });

  test('a marked value a formula reads is seen as its source text', () => {
    const run = cli('parse', 'reads-marker.yml', '--markers', 'sh');
    expect(JSON.parse(run.out)).toEqual({ check: 'ls chromium', shout: 'LS CHROMIUM', other: { marker: 'sh', source: 'npm test' } });
  });
});

describe('scripted-yaml', () => {
  test('without a command: usage on stderr, exit code 2', () => {
    const run = cli();
    expect(run.err).toContain('scripted-yaml validate <file>...');
    expect(run.err).toContain('scripted-yaml parse <file>');
    expect(run.code).toBe(2);
  });

  test('an unknown command and a bad --var are usage errors', () => {
    expect(cli('explode', 'good.yml').code).toBe(2);
    const run = cli('parse', 'good.yml', '--var', 'URL');
    expect(run.err).toContain('--var takes NAME=value');
    expect(run.code).toBe(2);
  });

  test('--help prints the usage and succeeds', () => {
    const run = cli('--help');
    expect(run.out).toContain('scripted-yaml validate <file>...');
    expect(run.code).toBe(0);
  });
});
