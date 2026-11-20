import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { evaluate as evaluateText } from 'feelers';
import { evaluate } from 'feelin';
import { parse } from 'yaml';

const root = join(import.meta.dir, '..');

/** The functions an application plugs in. They are not part of FEEL. */
class HostFunctions {
  fileExists = (path: string) => path === 'coverage.tests.yml';
  capitalize = (text: string) => text[0]!.toUpperCase() + text.slice(1);
  truncate = (text: string, length: number) => (text.length > length ? `${text.slice(0, length)}…` : text);
  glob = (path: string, pattern: string) => new Bun.Glob(pattern).match(path);
}

type Example = { about: string; feel: string; result?: unknown; warns?: boolean; error?: boolean; data?: object };

/** One cookbook file: runs every example and compares it with the result written beside it. */
class Cookbook {
  private static readonly shared = parse(readFileSync(join(root, 'docs/examples/data.yml'), 'utf8'));
  readonly examples: Example[];

  constructor(readonly file: string) {
    this.examples = parse(readFileSync(join(root, 'docs/examples', file), 'utf8')).examples;
  }

  check(example: Example): void {
    const context = { ...Cookbook.shared, ...new HostFunctions(), ...example.data };
    if (example.error) {
      expect(() => evaluate(example.feel, context)).toThrow();
      return;
    }
    const { value, warnings } = evaluate(example.feel, context);
    expect(value).toEqual(example.result as any);
    expect(warnings.length > 0).toBe(example.warns === true);
  }
}

for (const file of readdirSync(join(root, 'docs/examples')).filter((name) => /^\d.*\.yml$/.test(name)).sort()) {
  describe(`docs/examples/${file}`, () => {
    const cookbook = new Cookbook(file);
    cookbook.examples.forEach((example, index) => {
      test(`${index + 1}. ${example.about.slice(0, 70)}`, () => cookbook.check(example));
    });
  });
}

/** Every `key!:` value (a formula) and every text with `{{ }}` (a template) found in a YAML file. */
class FormulaFinder {
  readonly found: { where: string; source: string }[] = [];
  readonly texts: { where: string; source: string }[] = [];

  constructor(file: string) {
    this.walk(parse(readFileSync(file, 'utf8')), '');
  }

  private walk(value: unknown, where: string): void {
    if (typeof value === 'string') {
      if (value.includes('{{')) this.texts.push({ where, source: value });
    } else if (Array.isArray(value)) {
      value.forEach((item) => this.walk(item, where));
    } else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        const mark = key.match(/!(\w*)$/);
        if (mark && mark[1]) continue;
        if (mark && typeof item !== 'object') this.found.push({ where: `${where}/${key}`, source: String(item) });
        else this.walk(item, `${where}/${key}`);
      }
    }
  }
}

describe('every formula in examples/ is valid FEEL', () => {
  const files: string[] = [];
  const list = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) list(path);
      else if (path.endsWith('.yml')) files.push(path);
    }
  };
  list(join(root, 'examples'));

  for (const file of files) {
    test(file.split('/examples/')[1]!, () => {
      const finder = new FormulaFinder(file);
      const failures: string[] = [];
      for (const { where, source } of finder.texts) {
        try {
          evaluateText(source, {});
        } catch (error) {
          failures.push(`${where}: ${source} -> ${(error as Error).message}`);
        }
      }
      for (const { where, source } of finder.found) {
        try {
          evaluate(source, {});
        } catch (error) {
          failures.push(`${where}: ${source} -> ${(error as Error).message}`);
        }
      }
      expect(failures).toEqual([]);
    });
  }
});
