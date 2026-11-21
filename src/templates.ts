import { Platform } from './platform.js';

/** The base files that come with the package, in `templates/` beside `dist/`. A file names one as `scripted-yaml/<name>`. */
export class Templates {
  static readonly prefix = 'scripted-yaml/';

  /** The folder is found when a template is first asked for, so code bundled without one (a Worker) can still load files. */
  constructor(private readonly folder?: string) {}

  private get source(): string {
    return this.folder ?? Platform.path.join(import.meta.dirname, '../templates');
  }

  get names(): string[] {
    return Platform.fs
      .readdirSync(this.source)
      .filter((file) => file.endsWith('.yml'))
      .map((file) => file.slice(0, -'.yml'.length))
      .sort();
  }

  /** Whether a path written in a file names a bundled template, not a file beside it. */
  isTemplate(path: string): boolean {
    return path.startsWith(Templates.prefix);
  }

  /** The file of the template a path names; undefined when there is no such template. */
  file(path: string): string | undefined {
    const name = path.slice(Templates.prefix.length);
    return this.names.includes(name) ? Platform.path.join(this.source, `${name}.yml`) : undefined;
  }

  /** The first line of a template: a comment that says what it is for. */
  about(name: string): string {
    const first = Platform.fs.readFileSync(Platform.path.join(this.source, `${name}.yml`), 'utf8').split('\n', 1)[0] ?? '';
    return first.startsWith('#') ? first.slice(1).trim() : '';
  }
}
