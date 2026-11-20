// The package as an application gets it: built to dist/, imported by its name through the
// "exports" map of package.json, and its command line run with node.
import { beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const fixtures = join(import.meta.dir, 'fixtures');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const run = (command: string[], cwd = root) => {
  const done = Bun.spawnSync(command, { cwd });
  return { code: done.exitCode, out: done.stdout.toString(), err: done.stderr.toString() };
};

beforeAll(() => {
  const build = run(['bun', 'run', 'build']);
  if (build.code !== 0) throw new Error(`bun run build failed:\n${build.out}\n${build.err}`);
}, 120_000);

describe('the built package', () => {
  test('the build produces what package.json points at', () => {
    expect(manifest.exports['.']).toEqual({ types: './dist/index.d.ts', import: './dist/index.js' });
    for (const path of [manifest.exports['.'].import, manifest.exports['.'].types, manifest.main, manifest.types, manifest.bin['scripted-yaml']]) {
      expect(existsSync(join(root, path))).toBe(true);
    }
  });

  test('the types name the public classes', () => {
    const types = readFileSync(join(root, 'dist/index.d.ts'), 'utf8');
    for (const name of ['ScriptedYaml', 'Document', 'Problem', 'ValidationFailed', 'ResolveFailed', 'Formula', 'Text']) expect(types).toContain(name);
  });

  test('the bundle keeps its dependencies outside: they are installed with the package', () => {
    const bundle = readFileSync(join(root, 'dist/index.js'), 'utf8');
    for (const dependency of Object.keys(manifest.dependencies)) expect(bundle).toContain(`from "${dependency}"`);
  });

  test('node imports "scripted-yaml" by name and loads, resolves and validates a file', () => {
    const consumer = run(['node', join(fixtures, 'package/consumer.mjs')]);
    expect(consumer.err).toBe('');
    expect(JSON.parse(consumer.out)).toEqual({
      greeting: 'Hello node',
      twice: 20,
      title: '# Dune',
      command: 'npm test',
      formula: true,
      text: true,
      problem: 'x.yml:1  run!bash  no function is registered for the marker "bash"',
      refused: true,
      unresolved: true,
    });
  });

  test('bun imports "scripted-yaml" by name too', async () => {
    const name = 'scripted-yaml';
    const built = await import(name);
    expect(await new built.ScriptedYaml().validate('a!: 1 + 1\n')).toEqual([]);
    expect(import.meta.resolve('scripted-yaml')).toEndWith('/dist/index.js');
  });

  test('the built command line starts with a node shebang', () => {
    expect(readFileSync(join(root, 'dist/cli.js'), 'utf8')).toStartWith('#!/usr/bin/env node\n');
  });

  test('node runs the built command line: validate', () => {
    const good = run(['node', join(root, 'dist/cli.js'), 'validate', 'good.yml', '--markers', 'sh'], join(fixtures, 'cli'));
    expect(good).toEqual({ code: 0, out: 'ok       good.yml\n', err: '' });
    const bad = run(['node', join(root, 'dist/cli.js'), 'validate', 'bad.yml', '--markers', 'sh'], join(fixtures, 'cli'));
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('error    bad.yml:4  big!  unknown name "totl"');
  });

  test('node runs the built command line: parse', () => {
    const parsed = run(['node', join(root, 'dist/cli.js'), 'parse', 'app.yml', '--markers', 'sh', '--var', 'NAME=cli'], join(fixtures, 'package'));
    expect(parsed.err).toBe('');
    expect(JSON.parse(parsed.out)).toEqual({ greeting: 'Hello cli', twice: 20, title: '# Dune\n\n', run: { marker: 'sh', source: 'npm test' } });
    expect(parsed.code).toBe(0);
  });

  test('node runs the built command line: a Markdown file', () => {
    const page = run(['node', join(root, 'dist/cli.js'), 'validate', 'page.md', '--markers', 'mdq'], join(fixtures, 'cli'));
    expect(page.out).toContain('unknown name "redy"');
    expect(page.code).toBe(1);
  });
});
