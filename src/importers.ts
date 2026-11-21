import { Platform } from './platform.js';
import { mdq } from 'mdq-cli';
import type { Document } from './document.js';
import type { Entry } from './node.js';

/** One line of `$import`: a path and the names taken from it. */
export class ImportSpec {
  constructor(
    /** The path as written in the file. */
    readonly path: string,
    readonly absolute: string,
    /** What is written beside the path: a list of names, or one name. */
    readonly wanted: unknown,
    readonly entry: Entry,
  ) {}
}

/** A name a file imported, and what it stands for. */
export class Imported {
  constructor(
    readonly name: string,
    /** A function, data, or (for a scripted-yaml file) the loaded document. */
    readonly value: unknown,
    readonly document = false,
  ) {}
}

/** An import that cannot be done. The message is shown on the line of the import. */
export class ImportFailed extends Error {}

/** What an importer may ask of the library: to load another scripted-yaml file. */
export interface ImportHost {
  document(absolute: string): Promise<Document>;
}

/** Brings names from another file into a formula. One importer per kind of file, chosen by extension. */
export abstract class Importer {
  private static readonly all: Importer[] = [];

  /** The extensions this importer reads, with the dot. */
  abstract readonly extensions: string[];

  /** The names a spec brings in, read from the file's text alone. Throws ImportFailed when the spec is wrong. */
  abstract names(spec: ImportSpec): string[];

  /** Opens the file and returns what each name stands for. Throws ImportFailed. */
  abstract load(spec: ImportSpec, host: ImportHost): Promise<Imported[]>;

  static for(path: string): Importer | undefined {
    if (Importer.all.length === 0) Importer.all.push(new ModuleImporter(), new YamlImporter(), new MarkdownImporter());
    return Importer.all.find((importer) => importer.extensions.includes(Platform.path.extname(path)));
  }

  static get supported(): string[] {
    Importer.for('');
    return Importer.all.flatMap((importer) => importer.extensions);
  }

  /** A path that does not exist is a problem; where there is no disk, so is every path. */
  exists(spec: ImportSpec): boolean {
    try {
      return Platform.fs.existsSync(spec.absolute);
    } catch {
      return false;
    }
  }

  protected oneName(spec: ImportSpec): string[] {
    if (typeof spec.wanted !== 'string') throw new ImportFailed(`"${spec.path}" is imported under one name: ${spec.path}: name`);
    return [spec.wanted];
  }
}

/** `.ts` and `.js`: each listed name is an export of the module. */
export class ModuleImporter extends Importer {
  readonly extensions = ['.ts', '.js'];

  names(spec: ImportSpec): string[] {
    const list = typeof spec.wanted === 'string' ? [spec.wanted] : spec.wanted;
    if (!Array.isArray(list) || list.some((name) => typeof name !== 'string')) throw new ImportFailed(`"${spec.path}" needs the list of names to import: [first, second]`);
    return list;
  }

  async load(spec: ImportSpec): Promise<Imported[]> {
    let module: Record<string, unknown>;
    try {
      module = await import(Platform.url.pathToFileURL(spec.absolute).href);
    } catch (error) {
      throw new ImportFailed(`cannot import "${spec.path}": ${(error as Error).message}`);
    }
    return this.names(spec).map((name) => {
      if (!(name in module)) throw new ImportFailed(`"${spec.path}" does not export "${name}"`);
      const value = module[name];
      const kind = typeof value === 'function' ? value.constructor.name : '';
      if (kind === 'AsyncFunction' || kind === 'AsyncGeneratorFunction') throw new ImportFailed(`"${name}" from "${spec.path}" is an async function; a formula cannot wait, so imported functions must be synchronous`);
      return new Imported(name, value);
    });
  }
}

/** `.yml` and `.yaml`: one name for the file's data. The file is loaded as a scripted-yaml file. */
export class YamlImporter extends Importer {
  readonly extensions = ['.yml', '.yaml'];

  names(spec: ImportSpec): string[] {
    return this.oneName(spec);
  }

  async load(spec: ImportSpec, host: ImportHost): Promise<Imported[]> {
    const [name] = this.names(spec);
    return [new Imported(name!, await host.document(spec.absolute), true)];
  }
}

/** `.md`: one name, a function from an `mdq-cli` selector to the Markdown it picks. */
export class MarkdownImporter extends Importer {
  readonly extensions = ['.md'];

  names(spec: ImportSpec): string[] {
    return this.oneName(spec);
  }

  async load(spec: ImportSpec): Promise<Imported[]> {
    const [name] = this.names(spec);
    let text: string;
    try {
      text = Platform.fs.readFileSync(spec.absolute, 'utf8');
    } catch (error) {
      throw new ImportFailed(`cannot read "${spec.path}": ${(error as Error).message}`);
    }
    const markdown = mdq(text);
    return [new Imported(name!, (selector: string) => markdown.query(selector).text())];
  }
}
