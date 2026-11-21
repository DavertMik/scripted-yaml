import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** The base files that come with the package, in `templates/` beside `dist/`. A file names one as `scripted-yaml/<name>`. */
export class Templates {
  static readonly prefix = 'scripted-yaml/';

  constructor(private readonly source = join(import.meta.dirname, '../templates')) {}

  get names(): string[] {
    return readdirSync(this.source)
      .filter((file) => file.endsWith('.yml'))
      .map((file) => basename(file, '.yml'))
      .sort();
  }

  /** Whether a path written in a file names a bundled template, not a file beside it. */
  isTemplate(path: string): boolean {
    return path.startsWith(Templates.prefix);
  }

  /** The file of the template a path names; undefined when there is no such template. */
  file(path: string): string | undefined {
    const name = path.slice(Templates.prefix.length);
    return this.names.includes(name) ? join(this.source, `${name}.yml`) : undefined;
  }

  /** The first line of a template: a comment that says what it is for. */
  about(name: string): string {
    const first = readFileSync(join(this.source, `${name}.yml`), 'utf8').split('\n', 1)[0] ?? '';
    return first.startsWith('#') ? first.slice(1).trim() : '';
  }
}
