/** Functions a test file imports with `$import`. All synchronous, except `slow` (used to prove the rule). */
export class Host {
  static fileExists(path: string): boolean {
    return path === 'coverage.tests.yml';
  }

  static double(value: number): number {
    return value * 2;
  }

  static async slow(value: number): Promise<number> {
    return value;
  }

  static promised(value: number): Promise<number> {
    return Promise.resolve(value);
  }
}

export const fileExists = Host.fileExists;
export const double = Host.double;
export const slow = Host.slow;
export const promised = Host.promised;
