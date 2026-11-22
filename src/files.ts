import { basename, dirname, isAbsolute, join, resolve } from 'pathe';

/**
 * What the library reads files with: `node:fs`, or an `fs` of `memfs` where there is no disk.
 * Only these methods are used.
 */
export interface FileSystem {
  readFileSync(path: string, encoding: 'utf8'): { toString(): string };
  readdirSync(path: string): unknown[];
}

/** A file another file names, as it was read. */
export interface FileText {
  /** The name the file goes by: in problems, and in the paths it names in turn. */
  readonly file: string;
  readonly text: string;
}

/** The prefix of a path that names a template of the package, `scripted-yaml/<name>`. */
export const TEMPLATE_PREFIX = 'scripted-yaml/';

/**
 * Finds the files that `$extends`, `$dsl` and `$import` name: a path is beside the file that names it,
 * and `scripted-yaml/<name>` is `<name>.yml` in the templates directory.
 */
export class FileReader {
  constructor(
    private readonly fs: FileSystem | undefined,
    private readonly templates: string | undefined,
  ) {}

  /** The text of a file. Undefined: there is no such file. Throws an Error whose message is the problem. */
  read(path: string, from: string | undefined): FileText | undefined {
    if (FileReader.isTemplate(path)) return this.template(path);
    const file = from === undefined || isAbsolute(path) ? path : join(dirname(from), path);
    const text = this.text(file, from === undefined ? 'cannot read the file' : `cannot read "${path}"`);
    return text === undefined ? undefined : { file, text };
  }

  /** The one name of a file, for finding a file that extends or imports itself. */
  key(file: string): string {
    return FileReader.isTemplate(file) && this.templates ? this.templateFile(file) : resolve(file);
  }

  static isTemplate(path: string): boolean {
    return path.startsWith(TEMPLATE_PREFIX);
  }

  private template(path: string): FileText {
    const refused = `cannot read "${path}"`;
    if (!this.templates) throw new Error(`${refused}: templates are not read here (no templates directory is given)`);
    const name = path.slice(TEMPLATE_PREFIX.length);
    const text = basename(name) === name ? this.text(this.templateFile(path), refused) : undefined;
    if (text !== undefined) return { file: path, text };
    const names = this.fs!.readdirSync(this.templates)
      .map(String)
      .filter((name) => name.endsWith('.yml'))
      .map((name) => TEMPLATE_PREFIX + name.slice(0, -'.yml'.length))
      .sort();
    throw new Error(`${refused}: there is no such template (only ${names.join(', ')})`);
  }

  private templateFile(path: string): string {
    return resolve(this.templates!, `${path.slice(TEMPLATE_PREFIX.length)}.yml`);
  }

  private text(file: string, refused: string): string | undefined {
    if (!this.fs) return undefined;
    try {
      return this.fs.readFileSync(file, 'utf8').toString();
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return undefined;
      throw new Error(`${refused}: ${(error as Error).message}`, { cause: error });
    }
  }
}
