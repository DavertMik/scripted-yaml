import type { Imported } from './importers.js';
import { Platform } from './platform.js';
import { type Entry, ListNode, MapNode, type Node, ScalarNode } from './node.js';
import { Problem, type Problems, ScriptedYamlError, ValidationFailed } from './problem.js';
import { Resolution } from './resolution.js';
import type { Source } from './source.js';
import type { Variable } from './variables.js';

/** The application's function for one marker. It receives the value as written; what it returns becomes the value. */
// biome-ignore lint/suspicious/noExplicitAny: the value is whatever YAML held under the key
export type Marker = (source: any) => unknown;

/** The result of one test of `$tests`. */
export class TestResult {
  constructor(
    readonly about: string,
    /** One line per expectation that did not hold. Empty when the test passed. */
    readonly failures: string[],
  ) {}

  get passed(): boolean {
    return this.failures.length === 0;
  }
}

/** A loaded file: its data with formulas kept as formulas, and the way to compute them. */
export class Document {
  /**
   * The file as data, markers removed from the key names. A `key!:` is a `Formula`, text with `{{ }}`
   * is a `Text`, a `key!name:` is what the marker function returned.
   */
  // biome-ignore lint/suspicious/noExplicitAny: the shape is the file's own
  readonly data: any;

  constructor(
    readonly file: string,
    private readonly source: Source,
    private readonly imports: Map<string, Imported>,
    markers: Record<string, Marker | undefined>,
    problems: Problems,
  ) {
    const build = (node: Node): unknown => {
      if (node.expression) return node.expression;
      if (node instanceof ListNode) return node.items.map(build);
      if (!(node instanceof MapNode)) return node.toData();
      const data: Record<string, unknown> = {};
      for (const entry of node === source.root ? source.data : node.entries) {
        data[entry.name] = entry.key.kind === 'marked' ? this.mark(entry, markers, problems) : build(entry.value);
      }
      return data;
    };
    this.data = build(source.root);
  }

  /** The variables the file declares under `$vars`. */
  get variables(): Variable[] {
    return [...this.source.variables.declared.values()];
  }

  /**
   * All variables in, all values out: the whole file as plain data, every formula computed,
   * `$if` / `$unless` / `$each` / `$when` applied. Throws `ResolveFailed`.
   */
  // biome-ignore lint/suspicious/noExplicitAny: the shape is the file's own
  async resolve(options: { vars?: Record<string, unknown> } = {}): Promise<any> {
    return new Resolution(this.source, this.imports, options.vars ?? {}).run();
  }

  /** `resolve`, without waiting: computing needs no promise. */
  // biome-ignore lint/suspicious/noExplicitAny: the shape is the file's own
  resolveSync(options: { vars?: Record<string, unknown> } = {}): any {
    return new Resolution(this.source, this.imports, options.vars ?? {}).run();
  }

  /**
   * The file as written, with `$extends` applied: one file that needs no base. Keys stay as written
   * (`when!`, `run!sh`, `$vars`) and nothing is computed. A formula that reads `base` gets the base's
   * formula in its place. Write it with a YAML library to save it.
   */
  merged(): Record<string, unknown> {
    return Merged.of(this.source.root);
  }

  /** Runs the file's `$tests`: each resolves the file with its `vars` and compares the paths under `expect`. */
  async test(): Promise<TestResult[]> {
    return this.source.tests.map((test, index) => {
      const { about, vars, expect } = (test ?? {}) as { about?: string; vars?: Record<string, unknown>; expect?: Record<string, unknown> };
      const failures: string[] = [];
      try {
        const resolution = new Resolution(this.source, this.imports, vars ?? {});
        resolution.run();
        for (const [path, expected] of Object.entries(expect ?? {})) {
          const actual = resolution.probe(path);
          if (!Platform.same(actual, expected)) failures.push(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        }
      } catch (error) {
        if (!(error instanceof ScriptedYamlError)) throw error;
        failures.push(error.message);
      }
      return new TestResult(about ?? `test ${index + 1}`, failures);
    });
  }

  /** The file as a formula of another file reads it, when it is imported with `$import`. */
  view(vars: Record<string, unknown>): unknown {
    return new Resolution(this.source, this.imports, vars).view();
  }

  private mark(entry: Entry, markers: Record<string, Marker | undefined>, problems: Problems): unknown {
    const marker = markers[entry.key.marker!];
    if (!marker) {
      problems.error(entry, `the marker "${entry.key.marker}" was registered by name only; loading a file needs its function`);
      return undefined;
    }
    try {
      const value = marker(entry.value.toData());
      entry.marked = { value };
      return value;
    } catch (error) {
      problems.error(entry, `the function of the marker "${entry.key.marker}" failed: ${(error as Error).message}`);
      return undefined;
    }
  }
}

/** The tree after `$extends` as plain data, keys as written, with each `base` written out. */
class Merged {
  static of(map: MapNode): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const entry of map.entries) data[entry.key.raw] = Merged.value(entry);
    return data;
  }

  private static value(entry: Entry): unknown {
    if (entry.key.kind === 'formula' && entry.value instanceof ScalarNode && entry.base) return Merged.formula(entry);
    return Merged.node(entry.value);
  }

  private static node(node: Node): unknown {
    if (node instanceof MapNode) return Merged.of(node);
    if (node instanceof ListNode) return node.items.map((item) => Merged.node(item));
    return node.toData();
  }

  /** The formula with `base` replaced by what it stood for, in brackets. */
  private static formula(entry: Entry): string {
    const source = (entry.value as ScalarNode).source;
    if (!entry.value.expression?.reads.some((name) => name === 'base' || name.startsWith('base.'))) return source;
    const base = entry.base!;
    let inlined: string;
    if (base.key.kind === 'formula' && base.value instanceof ScalarNode) inlined = base.base ? Merged.formula(base) : base.value.source;
    else if (base.key.kind === 'plain' && base.value instanceof ScalarNode) inlined = JSON.stringify(base.value.value ?? null);
    else {
      const what = base.key.kind === 'marked' ? 'a marked value' : 'a map or a list';
      throw new ValidationFailed([new Problem(entry.file, entry.line, entry.column, entry.path(), `base is ${what}, which a formula cannot hold: the file cannot be written without its base`, 'error')]);
    }
    return Merged.replaceBase(source, `(${inlined})`);
  }

  /** Every `base` that is a name, not part of a longer name, a field or a text. */
  private static replaceBase(source: string, by: string): string {
    return source
      .split(/("(?:[^"\\]|\\.)*")/)
      .map((part, index) => (index % 2 ? part : part.replace(/(?<![\w.])base(?![\w])/g, by)))
      .join('');
  }
}
