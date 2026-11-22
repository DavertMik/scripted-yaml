import type { Entry } from './node.js';

/** A function a file declares under `$functions` without a formula: the application passes it to `resolve`. */
export class HostFunction {
  readonly about: string | undefined;

  constructor(
    readonly name: string,
    /** As written in the key; undefined when the key has no brackets. */
    readonly parameters: string[] | undefined,
    readonly entry: Entry,
    settings: Record<string, unknown>,
  ) {
    this.about = typeof settings.about === 'string' ? settings.about : undefined;
  }

  /** Why a passed value cannot be this function; undefined when it can. */
  mismatch(value: unknown): string | undefined {
    if (value === undefined || value === null) return `the function "${this.name}" is declared in $functions for the application to pass; it was not passed`;
    if (typeof value !== 'function') return `the function "${this.name}" must be passed as a function`;
    const kind = value.constructor?.name;
    if (kind === 'AsyncFunction' || kind === 'AsyncGeneratorFunction') return `the function "${this.name}" is async; a formula cannot wait, so passed functions must be synchronous`;
    return undefined;
  }
}
