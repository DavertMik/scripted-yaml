import { Checker } from './checker.js';
import { Document, type Marker } from './document.js';
import { type Imported, Importer, ImportFailed, type ImportHost } from './importers.js';
import { Platform } from './platform.js';
import { Problem, Problems, ValidationFailed } from './problem.js';
import { type Reader, type Source, SourceLoader } from './source.js';

export interface ScriptedYamlOptions {
  /**
   * One function per marker name (`run!sh:` calls `sh`), or only the names where files are just checked.
   * This is the only thing an application registers: functions come from each file's `$import`.
   */
  markers?: Record<string, Marker> | string[];
  /**
   * Reads the files that `$extends` and `$dsl` name, for files that are not on a disk: a Worker, a browser,
   * a database. It gets the path as written and the file that names it. When it gives undefined, the disk is read.
   */
  read?: Reader;
}

export interface FileOptions {
  /** The name of the file, for problems, and the place its `$dsl`, `$extends` and `$import` paths start from. */
  file?: string;
}

/** Validates and loads scripted-yaml files. It computes nothing: see `Document.resolve`. */
export class ScriptedYaml {
  private readonly markers: Record<string, Marker | undefined> = {};
  private readonly reader?: Reader;

  constructor(options: ScriptedYamlOptions = {}) {
    this.reader = options.read;
    if (Array.isArray(options.markers)) for (const name of options.markers) this.markers[name] = undefined;
    else Object.assign(this.markers, options.markers);
  }

  /** Checks a file and returns the problems. Runs nothing: no marker function, no formula, no import. */
  async validate(path: string): Promise<Problem[]> {
    try {
      return this.validateText(this.readFile(path), { file: path });
    } catch (error) {
      if (error instanceof ValidationFailed) return error.problems;
      throw error;
    }
  }

  /** The same check for text that is not in a file (or data already parsed). `file` names it in the problems. */
  async validateText(input: unknown, options: FileOptions = {}): Promise<Problem[]> {
    return this.check(input, options.file ?? '(text)').problems.list;
  }

  /** `validateText`, without waiting: checking runs nothing, so it needs no promise. */
  validateTextSync(input: unknown, options: FileOptions = {}): Problem[] {
    return this.check(input, options.file ?? '(text)').problems.list;
  }

  /** Reads a file, validates it, applies `$extends`, loads each `$import` and calls each marker's function. No formula is computed. */
  async load(path: string): Promise<Document> {
    return this.loadText(this.readFile(path), { file: path });
  }

  /** The same for text that is not in a file (or data already parsed). */
  async loadText(input: unknown, options: FileOptions = {}): Promise<Document> {
    return this.open(input, options.file ?? '(text)', []);
  }

  /**
   * `loadText`, without waiting, for a file with no `$import`: an import loads a module, and that takes a promise.
   * Throws `ValidationFailed` for a file that imports.
   */
  loadTextSync(input: unknown, options: FileOptions = {}): Document {
    const file = options.file ?? '(text)';
    const { source, problems } = this.check(input, file);
    if (!source || problems.failed) throw new ValidationFailed(problems.list);
    for (const spec of source.imports) problems.error(spec.entry, '$import loads a module, which takes a promise: use loadText, not loadTextSync');
    if (problems.failed) throw new ValidationFailed(problems.list);
    const document = new Document(file, source, new Map(), this.markers, problems);
    if (problems.failed) throw new ValidationFailed(problems.list);
    return document;
  }

  private check(input: unknown, file: string): { source: Source | undefined; problems: Problems } {
    const problems = new Problems();
    const source = new SourceLoader(problems, this.reader).load(input, file);
    if (source) new Checker(source, Object.keys(this.markers), problems).run();
    problems.sort();
    return { source, problems };
  }

  private readFile(path: string): string {
    try {
      return Platform.fs.readFileSync(path, 'utf8');
    } catch (error) {
      throw new ValidationFailed([new Problem(path, 0, 0, '', `cannot read the file: ${(error as Error).message}`)], { cause: error });
    }
  }

  /** `chain` holds the files being loaded on the way here, to stop an import that comes back to itself. */
  private async open(input: unknown, file: string, chain: string[]): Promise<Document> {
    const { source, problems } = this.check(input, file);
    if (!source || problems.failed) throw new ValidationFailed(problems.list);

    const host: ImportHost = {
      document: (absolute) => {
        const { resolve } = Platform.path;
        if (absolute === resolve(file) || chain.includes(absolute)) throw new ImportFailed('the import comes back to this file: an import cycle');
        return this.open(this.readFile(absolute), absolute, [...chain, resolve(file)]);
      },
    };
    const imports = new Map<string, Imported>();
    for (const spec of source.imports) {
      try {
        for (const imported of await Importer.for(spec.path)!.load(spec, host)) imports.set(imported.name, imported);
      } catch (error) {
        if (error instanceof ImportFailed) problems.error(spec.entry, error.message);
        else if (error instanceof ValidationFailed) problems.error(spec.entry, `cannot import "${spec.path}": ${error.message}`);
        else throw error;
      }
    }
    const document = new Document(file, source, imports, this.markers, problems);
    if (problems.failed) throw new ValidationFailed(problems.list);
    return document;
  }
}
