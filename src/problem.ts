export type Severity = 'error' | 'warning';

/** Anything in a file a problem can point at: a node or a key. */
export interface Located {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  path(): string;
}

/** One thing wrong with a file: where it is, and what. */
export class Problem {
  constructor(
    readonly file: string,
    readonly line: number,
    readonly column: number,
    /** Path of the key, as written in the file. */
    readonly key: string,
    readonly message: string,
    readonly severity: Severity = 'error',
  ) {}

  toString(): string {
    const where = this.line > 0 ? `${this.file}:${this.line}` : this.file;
    return [where, this.key, this.message].filter((part) => part !== '').join('  ');
  }
}

/** Collects the problems of one validation or one resolve. */
export class Problems {
  readonly list: Problem[] = [];

  error(at: Located, message: string): void {
    this.add(at, message, 'error');
  }

  warning(at: Located, message: string): void {
    this.add(at, message, 'warning');
  }

  add(at: Located, message: string, severity: Severity): void {
    this.list.push(new Problem(at.file, at.line, at.column, at.path(), message, severity));
  }

  /** Puts the problems in reading order: file by file as first met, then by line. */
  sort(): void {
    const files = [...new Set(this.list.map((problem) => problem.file))];
    this.list.sort((a, b) => files.indexOf(a.file) - files.indexOf(b.file) || a.line - b.line);
  }

  /** Makes every warning an error. */
  strict(): void {
    this.list.forEach((problem, index) => {
      if (problem.severity === 'warning') this.list[index] = new Problem(problem.file, problem.line, problem.column, problem.key, problem.message, 'error');
    });
  }

  get errors(): Problem[] {
    return this.list.filter((problem) => problem.severity === 'error');
  }

  get failed(): boolean {
    return this.list.some((problem) => problem.severity === 'error');
  }
}

/** Base of the errors the library throws. It always carries the problems that caused it. */
export abstract class ScriptedYamlError extends Error {
  readonly problems: Problem[];

  constructor(problems: Problem[], options?: ErrorOptions) {
    super(problems.filter((problem) => problem.severity === 'error').join('\n'), options);
    this.name = new.target.name;
    this.problems = problems;
  }
}

/** Thrown by `load`, `loadText` and `loadTextSync` when a file has errors. */
export class ValidationFailed extends ScriptedYamlError {
  /** One problem with a whole file, such as a file that cannot be read. */
  static at(file: string, message: string, cause?: unknown): ValidationFailed {
    return new ValidationFailed([new Problem(file, 0, 0, '', message)], { cause });
  }
}

/** Thrown by `resolve` when values are missing or a formula fails. */
export class ResolveFailed extends ScriptedYamlError {}
