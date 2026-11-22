import { evaluate } from 'feelin';
import type { HostFunction } from './functions.js';
import type { Imported } from './importers.js';
import { MergedForm } from './merged.js';
import { type Entry, ListNode, MapNode, type Node } from './node.js';
import { type Problems, ScriptedYamlError } from './problem.js';
import { Resolution } from './resolution.js';
import { Scope } from './scope.js';
import type { Source } from './source.js';
import type { Variable } from './variables.js';

/** The application's function for one marker. It receives the value as written; what it returns becomes the value. */
// biome-ignore lint/suspicious/noExplicitAny: the value is whatever YAML held under the key
export type Marker = (source: any) => unknown;

/** What `resolve` is given: the variables, and the functions the file declares for the application to pass. */
export interface ResolveOptions {
  vars?: Record<string, unknown>;
  /** By name. Each must be synchronous: a formula cannot wait. */
  functions?: Record<string, unknown>;
}

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

export class Marked {
  constructor(private readonly entry: Entry) {}

  get path(): string {
    return this.entry.path();
  }

  get marker(): string {
    return this.entry.key.marker!;
  }

  get source(): unknown {
    return this.entry.value.toData();
  }

  get value(): unknown {
    return this.entry.marked?.value;
  }

  set value(value: unknown) {
    this.entry.marked = { value };
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
  readonly marked: Marked[] = [];

  constructor(
    readonly file: string,
    private readonly source: Source,
    private readonly imports: Map<string, Imported>,
    markers: Record<string, Marker | undefined>,
    problems: Problems,
  ) {
    const scope = new Scope(source);
    const build = (node: Node): unknown => {
      if (node.expression) return node.expression;
      if (node instanceof ListNode) return node.items.map(build);
      if (!(node instanceof MapNode)) return node.toData();
      const data: Record<string, unknown> = {};
      for (const entry of node === source.root ? source.data : node.entries) {
        data[entry.name] = entry.key.kind === 'marked' ? this.mark(entry, markers, problems) : build(entry.value);
        for (let holder = entry; holder.base && MergedForm.readsBase(scope, holder); holder = holder.base) {
          if (holder.base.key.kind === 'marked') this.mark(holder.base, markers, problems);
          else build(holder.base.value);
        }
      }
      return data;
    };
    this.data = build(source.root);
  }

  /** The variables the file declares under `$vars`. */
  get variables(): Variable[] {
    return [...this.source.variables.declared.values()];
  }

  /** The functions the file declares under `$functions` for the application to pass. */
  get functions(): HostFunction[] {
    return [...this.source.hosted.values()];
  }

  /**
   * All variables in, all values out: the whole file as plain data, every formula computed,
   * `$if` / `$unless` / `$each` / `$when` applied. Throws `ResolveFailed`.
   */
  // biome-ignore lint/suspicious/noExplicitAny: the shape is the file's own
  resolve(options: ResolveOptions = {}): any {
    return new Resolution(this.source, this.imports, options.vars ?? {}, options.functions).run();
  }

  merged(): Record<string, unknown> {
    return MergedForm.write(this.source);
  }

  /** Runs the file's `$tests`. */
  test(options: { functions?: Record<string, unknown> } = {}): TestResult[] {
    return this.source.tests.map((test, index) => {
      const { about, vars, expect } = (test ?? {}) as { about?: string; vars?: Record<string, unknown>; expect?: Record<string, unknown> };
      const failures: string[] = [];
      try {
        const resolution = new Resolution(this.source, this.imports, vars ?? {}, options.functions);
        resolution.run();
        for (const [path, expected] of Object.entries(expect ?? {})) {
          const actual = resolution.probe(path);
          if (!Document.same(actual, expected)) failures.push(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        }
      } catch (error) {
        if (!(error instanceof ScriptedYamlError)) throw error;
        failures.push(error.message);
      }
      return new TestResult(about ?? `test ${index + 1}`, failures);
    });
  }

  private static same(actual: unknown, expected: unknown): boolean {
    return evaluate('actual = expected', { actual, expected }).value === true;
  }

  /** The file as a formula of another file reads it, when it is imported with `$import`. */
  view(vars: Record<string, unknown>, functions: Record<string, unknown> = {}): unknown {
    return new Resolution(this.source, this.imports, vars, functions).view();
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
      this.marked.push(new Marked(entry));
      return value;
    } catch (error) {
      problems.error(entry, `the function of the marker "${entry.key.marker}" failed: ${(error as Error).message}`);
      return undefined;
    }
  }
}
