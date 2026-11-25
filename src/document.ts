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

/** The application's markers: a function per name, and the names whose value is computed like any value. */
export interface Markers {
  functions: Record<string, Marker | undefined>;
  computed: ReadonlySet<string>;
}

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

/**
 * One marked key of a loaded file: what is written under it, and the value its marker function gave.
 * The application may set `value` after loading, such as when a check finishes; `resolve` reads it then.
 */
export class Marked {
  constructor(private readonly entry: Entry) {}

  /** The path of the key, as problems name it: `stages.build.check.$value!sh`. */
  get path(): string {
    return this.entry.path();
  }

  get marker(): string {
    return this.entry.key.marker!;
  }

  /** The value as written. */
  get source(): unknown {
    return this.entry.value.toData();
  }

  /**
   * What a formula and the result get. A formula reads a boolean, a map or a list of plain data as it is;
   * anything else by its `toString()`, with "1" as true and "0" as false. `resolve` calls a computed
   * marker's function again, with the computed value, and does not read a value set here.
   */
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
   * is a `Text`, a `key!name:` is what the marker function returned: given the value as written, or,
   * for a computed marker, as this data has it.
   */
  // biome-ignore lint/suspicious/noExplicitAny: the shape is the file's own
  readonly data: any;
  /** Every marked key of the file, in order. */
  readonly marked: Marked[] = [];

  constructor(
    readonly file: string,
    private readonly source: Source,
    private readonly imports: Map<string, Imported>,
    private readonly markers: Markers,
    problems: Problems,
  ) {
    const scope = new Scope(source);
    const build = (node: Node): unknown => {
      if (node.expression) return node.expression;
      if (node instanceof ListNode) return node.items.map(build);
      if (!(node instanceof MapNode)) return node.toData();
      const data: Record<string, unknown> = {};
      for (const entry of node === source.root ? source.data : node.entries) {
        data[entry.name] = entry.key.kind === 'marked' ? this.mark(entry, build, problems) : build(entry.value);
        // A replaced entry is not data, but where a formula reads it as `base`, its markers are called too.
        for (let holder = entry; holder.base && MergedForm.readsBase(scope, holder); holder = holder.base) {
          if (holder.base.key.kind === 'marked') this.mark(holder.base, build, problems);
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
    return new Resolution(this.source, this.imports, options.vars ?? {}, options.functions, this.markers).run();
  }

  /**
   * The file as written, with `$extends` applied: one file that needs no base, as plain data to write
   * with a YAML library. Keys stay as written (`when!`, `run!sh`, `$vars`) and nothing is computed;
   * where a formula reads `base`, the entry it replaced is kept under `$base`. It loads and resolves
   * as the patch does.
   */
  merged(): Record<string, unknown> {
    return MergedForm.write(this.source);
  }

  /**
   * Runs the file's `$tests`: each resolves the file with its `vars` and compares the keys under `expect`,
   * equal as FEEL's `=` says. A key is a path to a key of the file as problems name it
   * (`stages.write-plan.when`), or a formula. The functions the file declares for the application
   * to pass are given as `functions`, the same for every test.
   */
  test(options: { functions?: Record<string, unknown> } = {}): TestResult[] {
    return this.source.tests.map((test, index) => {
      const { about, vars, expect } = (test ?? {}) as { about?: string; vars?: Record<string, unknown>; expect?: Record<string, unknown> };
      const failures: string[] = [];
      try {
        const resolution = new Resolution(this.source, this.imports, vars ?? {}, options.functions, this.markers);
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
    return new Resolution(this.source, this.imports, vars, functions, this.markers).view();
  }

  private mark(entry: Entry, build: (node: Node) => unknown, problems: Problems): unknown {
    const marker = this.markers.functions[entry.key.marker!];
    if (!marker) {
      problems.error(entry, `the marker "${entry.key.marker}" was registered by name only; loading a file needs its function`);
      return undefined;
    }
    try {
      const value = marker(this.markers.computed.has(entry.key.marker!) ? build(entry.value) : entry.value.toData());
      entry.marked = { value };
      this.marked.push(new Marked(entry));
      return value;
    } catch (error) {
      problems.error(entry, `the function of the marker "${entry.key.marker}" failed: ${(error as Error).message}`);
      return undefined;
    }
  }
}
