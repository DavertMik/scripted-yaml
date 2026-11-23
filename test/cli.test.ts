// The command line, run from source with bun. test/package.test.ts runs the built one with node.
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

describe('scripted-yaml skill', () => {
  const skills = ['scripted-yaml', 'scripted-yaml-convert', 'scripted-yaml-ui'];
  const source = (name: string, file: string) => readFileSync(join(root, 'skills', name, file), 'utf8');
  const at = (cwd: string, home: string, ...args: string[]) => {
    const run = Bun.spawnSync(['bun', join(root, 'src/cli.ts'), 'skill', ...args], { cwd, env: { ...process.env, HOME: home } });
    return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
  };
  const places = () => ({ project: mkdtempSync(join(tmpdir(), 'sy-project-')), home: mkdtempSync(join(tmpdir(), 'sy-home-')) });

  test('prints both skills and writes nothing', () => {
    const { project, home } = places();
    const run = at(project, home);
    expect(run.code).toBe(0);
    for (const name of skills) expect(run.out).toContain(source(name, 'SKILL.md'));
    expect(existsSync(join(project, '.claude'))).toBe(false);
  });

  test('--install copies the skills with their examples into the project, for every agent', () => {
    const { project, home } = places();
    const run = at(project, home, '--install');
    expect(run.code).toBe(0);
    for (const dir of ['.claude/skills', '.agents/skills']) {
      for (const name of skills) {
        expect(run.out).toContain(`installed ${join(project, dir, name)}\n`);
        expect(readFileSync(join(project, dir, name, 'SKILL.md'), 'utf8')).toBe(source(name, 'SKILL.md'));
      }
      expect(readFileSync(join(project, dir, 'scripted-yaml-convert/examples/pricing.yml'), 'utf8')).toBe(source('scripted-yaml-convert', 'examples/pricing.yml'));
    }
    expect(existsSync(join(home, '.claude'))).toBe(false);
  });

  test('--install global copies them into the home directory', () => {
    const { project, home } = places();
    expect(at(project, home, '--install', 'global').code).toBe(0);
    expect(existsSync(join(home, '.claude/skills/scripted-yaml/SKILL.md'))).toBe(true);
    expect(existsSync(join(home, '.agents/skills/scripted-yaml-convert/SKILL.md'))).toBe(true);
    expect(existsSync(join(project, '.claude'))).toBe(false);
  });

  test('an unknown scope is a usage error and installs nothing', () => {
    const { project, home } = places();
    const run = at(project, home, '--install', 'everywhere');
    expect(run.code).toBe(2);
    expect(run.err).toContain('--install takes local or global');
    expect(existsSync(join(project, '.claude'))).toBe(false);
  });
});

describe('scripted-yaml templates', () => {
  test('lists the templates of the package, each with what it is for', () => {
    const run = cli('templates');
    expect(run.code).toBe(0);
    const lines = run.out.trimEnd().split('\n');
    expect(lines.map((line) => line.split(' ')[0])).toEqual(['scripted-yaml/forms', 'scripted-yaml/navigation-ui', 'scripted-yaml/state-machine']);
    expect(lines[2]).toContain('A state machine');
  });
});

describe('the name and version', () => {
  const product = `scripted-yaml ${JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version}`;

  test('every command prints them first, on stderr, and its output stays clean', () => {
    for (const args of [['validate', 'good.yml', '--markers', 'sh'], ['parse', 'good.yml', '--markers', 'sh'], ['templates'], ['--help'], ['nonsense'], []]) {
      const run = cli(...args);
      expect(run.err.split('\n')[0]).toBe(product);
      expect(run.out).not.toContain(product);
    }
    expect(() => JSON.parse(cli('parse', 'good.yml', '--markers', 'sh').out)).not.toThrow();
  });

  test('--version prints them alone', () => {
    for (const flag of ['--version', '-v']) {
      const run = cli(flag);
      expect(run.out).toBe(`${product}\n`);
      expect(run.err).toBe('');
      expect(run.code).toBe(0);
    }
  });
});

describe('scripted-yaml test', () => {
  test('every test passes: one line per test, exit code 0', () => {
    const run = cli('test', 'tested.yml', '--markers', 'sh');
    expect(run.out).toBe('pass     tested.yml  A big order gets ten percent off\npass     tested.yml  A small order pays in full\n');
    expect(run.code).toBe(0);
  });

  test('a failing test says what was expected and what came; exit code 1', () => {
    const run = cli('test', 'failing.yml');
    const lines = run.out.trimEnd().split('\n');
    expect(lines.slice(0, 3)).toEqual(['pass     failing.yml  A big order', 'FAIL     failing.yml  A wrong expectation', '           discount: expected 5, got 0']);
    expect(lines[3]).toBe('FAIL     failing.yml  A missing variable');
    expect(lines[4]).toContain('subtotal');
    expect(run.code).toBe(1);
  });

  test('a file without tests says so and does not fail; several files are all run', () => {
    const run = cli('test', 'good.yml', 'tested.yml', '--markers', 'sh');
    expect(run.out).toStartWith('no tests good.yml\npass     tested.yml');
    expect(run.code).toBe(0);
  });

  test('a file with a validation error is reported and fails', () => {
    const run = cli('test', 'bad.yml', '--markers', 'sh');
    expect(run.out).toContain('error    bad.yml:3  run!bash');
    expect(run.code).toBe(1);
  });

  test('without a file it is a usage error', () => {
    expect(cli('test').code).toBe(2);
  });
});
