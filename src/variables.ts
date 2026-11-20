import { MapNode, type Node } from './node.js';
import type { Located, Problems } from './problem.js';

/** One variable a file declares under `$vars`. */
export class Variable {
  readonly optional: boolean;
  readonly secret: boolean;
  readonly host: boolean;
  readonly type: string | undefined;
  readonly about: string | undefined;
  readonly default: unknown;

  constructor(
    readonly name: string,
    settings: Record<string, unknown>,
  ) {
    this.optional = settings.optional === true;
    this.secret = settings.secret === true;
    this.host = settings.host === true;
    this.type = typeof settings.type === 'string' ? settings.type : undefined;
    this.about = typeof settings.about === 'string' ? settings.about : undefined;
    this.default = settings.default;
  }

  /** The application must pass it: it has no default and is not optional. */
  get required(): boolean {
    return !this.optional && this.default === undefined;
  }

  /** Why a value does not fit the declared type; undefined when it fits or the type is not one we know. */
  mismatch(value: unknown): string | undefined {
    const fits: Record<string, boolean> = {
      text: typeof value === 'string',
      number: typeof value === 'number',
      boolean: typeof value === 'boolean',
      list: Array.isArray(value),
    };
    if (value === null || this.type === undefined || fits[this.type] !== false) return undefined;
    return `variable "${this.name}" must be a ${this.type}; variables are not converted`;
  }
}

/** The inputs of a file: what `$vars` declares, and the names a DSL makes known. */
export class Variables {
  readonly declared = new Map<string, Variable>();
  private readonly patterns: RegExp[] = [];
  private readonly known = new Set<string>();

  /** Reads a `$vars` map. With `forChecking`, the names only become known: a DSL gives no value and asks for none. */
  add(node: Node | undefined, problems: Problems, forChecking = false): this {
    if (!node) return this;
    if (!(node instanceof MapNode)) {
      problems.error(node, '$vars must be a map of variable names');
      return this;
    }
    for (const entry of node.entries) {
      const name = entry.key.raw;
      if (name.length > 2 && name.startsWith('/') && name.endsWith('/')) this.pattern(name.slice(1, -1), entry, problems);
      else if (forChecking) this.known.add(name);
      else this.declare(name, entry.value, problems);
    }
    return this;
  }

  /** True when `vars.NAME` is no typo: declared, matched by a pattern, or known from a DSL. */
  knows(name: string): boolean {
    return this.declared.has(name) || this.known.has(name) || this.patterns.some((pattern) => pattern.test(name));
  }

  /** The values formulas see: defaults filled in, empty text turned into null. */
  values(input: Record<string, unknown>): { values: Record<string, unknown>; missing: string[]; mismatches: string[] } {
    const values: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(input)) values[name] = value === '' || value === undefined ? null : value;
    const missing: string[] = [];
    const mismatches: string[] = [];
    for (const variable of this.declared.values()) {
      values[variable.name] ??= variable.default ?? null;
      if (values[variable.name] === null && variable.required) missing.push(variable.name);
      const mismatch = variable.mismatch(values[variable.name]);
      if (mismatch) mismatches.push(mismatch);
    }
    return { values, missing, mismatches };
  }

  private declare(name: string, node: Node, problems: Problems): void {
    const settings = node.toData();
    if (settings !== null && !(node instanceof MapNode)) {
      problems.error(node, `variable "${name}" is declared with a map: { default: …, optional: true }`);
      return;
    }
    this.declared.set(name, new Variable(name, (settings ?? {}) as Record<string, unknown>));
  }

  private pattern(body: string, at: Located, problems: Problems): void {
    try {
      this.patterns.push(new RegExp(`^(?:${body})$`));
    } catch (error) {
      problems.error(at, `not a regular expression: ${(error as Error).message}`);
    }
  }
}
