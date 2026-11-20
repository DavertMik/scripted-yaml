import { existsSync } from 'node:fs';

/**
 * Functions pipeline formulas may call. A pipeline imports the ones it uses:
 *
 *   $import:
 *     ./pipeline-host.ts: [fileExists]
 *
 * Every function here is synchronous: a formula cannot wait for a promise.
 */
export class PipelineHost {
  static fileExists(path: string): boolean {
    return existsSync(path);
  }

  static glob(path: string, pattern: string): boolean {
    return new Bun.Glob(pattern).match(path);
  }
}

export const fileExists = PipelineHost.fileExists;
export const glob = PipelineHost.glob;
