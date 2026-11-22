// The package as an application gets it: built to dist/, imported by its name through the
// "exports" map of package.json, and its command line run with node.
import { beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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
    const types = readFileSync(join(root, 'dist/core.d.ts'), 'utf8') + readFileSync(join(root, 'dist/index.d.ts'), 'utf8');
    for (const name of ['ScriptedYaml', 'Document', 'Problem', 'ValidationFailed', 'ResolveFailed', 'Formula', 'Text', 'Files', 'MemoryFiles', 'DiskFiles', 'Marked']) expect(types).toContain(name);
  });

  test('the bundle keeps its dependencies outside: they are installed with the package', () => {
    const bundle = readdirSync(join(root, 'dist'))
      .filter((file) => file.endsWith('.js'))
      .map((file) => readFileSync(join(root, 'dist', file), 'utf8'))
      .join('\n');
    for (const dependency of Object.keys(manifest.dependencies)) expect(bundle).toContain(`from "${dependency}"`);
  });

  test('"scripted-yaml/core" shares its classes with "scripted-yaml"', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: the two entries are compared name by name
    const main: Record<string, any> = await import('scripted-yaml');
    // biome-ignore lint/suspicious/noExplicitAny: the two entries are compared name by name
    const core: Record<string, any> = await import('scripted-yaml/core');
    for (const name of ['Document', 'Problem', 'ValidationFailed', 'ResolveFailed', 'Formula', 'Text', 'Files', 'MemoryFiles']) expect(main[name]).toBe(core[name]);
    expect(new main.ScriptedYaml()).toBeInstanceOf(core.ScriptedYaml);
    const failure = await new main.ScriptedYaml().loadText('a!: nope\n').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(core.ValidationFailed);
  });

  test('"scripted-yaml/core" bundles for a browser with no node: import, and validates, loads, resolves and merges there', () => {
    const entry = join(fixtures, 'package/browser.mjs');
    const out = join(root, 'dist-browser-test.js');
    try {
      const build = run(['bun', 'build', entry, '--target', 'browser', '--outfile', out]);
      expect(build.code).toBe(0);
      const bundle = readFileSync(out, 'utf8');
      for (const importing of ['from "node:', "from 'node:", 'require("node:', 'import("node:']) expect(bundle).not.toContain(importing);
      const browser = run(['node', out]);
      expect(browser.err).toBe('');
      expect(JSON.parse(browser.out)).toEqual({
        problems: [],
        result: { stages: [{ id: 'build', when: true }] },
        merged: { stages: [{ id: 'build', 'when!': 'base and vars.GO', $base: { 'when!': true } }] },
        tests: [true],
      });
    } finally {
      rmSync(out, { force: true });
    }
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

  test('the built package finds its templates', async () => {
    const name = 'scripted-yaml';
    const built = await import(name);
    const text = '$extends: scripted-yaml/state-machine\n$schema:\n  State: [on, off]\n$replace:\n  transitions:\n    - { from: on, on: flip, to: off }\n';
    expect(new built.ScriptedYaml().validateText(text)).toEqual([]);
    expect(run(['node', manifest.bin['scripted-yaml'], 'templates']).out).toContain('scripted-yaml/forms');
  });

  test('bun imports "scripted-yaml" by name too', async () => {
    const name = 'scripted-yaml';
    const built = await import(name);
    expect(new built.ScriptedYaml().validateText('a!: 1 + 1\n')).toEqual([]);
    expect(import.meta.resolve('scripted-yaml')).toEndWith('/dist/index.js');
  });

  test('the built command line starts with a node shebang', () => {
    expect(readFileSync(join(root, 'dist/cli.js'), 'utf8')).toStartWith('#!/usr/bin/env node\n');
  });

  test('node runs the built command line: validate', () => {
    const good = run(['node', join(root, 'dist/cli.js'), 'validate', 'good.yml', '--markers', 'sh'], join(fixtures, 'cli'));
    expect(good).toEqual({ code: 0, out: 'ok       good.yml\n', err: `scripted-yaml ${manifest.version}\n` });
    const bad = run(['node', join(root, 'dist/cli.js'), 'validate', 'bad.yml', '--markers', 'sh'], join(fixtures, 'cli'));
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('error    bad.yml:4  big!  unknown name "totl"');
  });

  test('node runs the built command line: parse', () => {
    const parsed = run(['node', join(root, 'dist/cli.js'), 'parse', 'app.yml', '--markers', 'sh', '--var', 'NAME=cli'], join(fixtures, 'package'));
    expect(parsed.err).toBe(`scripted-yaml ${manifest.version}\n`);
    expect(JSON.parse(parsed.out)).toEqual({ greeting: 'Hello cli', twice: 20, title: '# Dune\n\n', run: { marker: 'sh', source: 'npm test' } });
    expect(parsed.code).toBe(0);
  });

  test('node runs the built command line: a Markdown file', () => {
    const page = run(['node', join(root, 'dist/cli.js'), 'validate', 'page.md', '--markers', 'mdq'], join(fixtures, 'cli'));
    expect(page.out).toContain('unknown name "redy"');
    expect(page.code).toBe(1);
  });
});
