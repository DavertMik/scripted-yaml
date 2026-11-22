import gensync, { type Handler } from 'gensync';
import { Checker } from './checker.js';
import { Document, type Marker } from './document.js';
import { type Imported, Importer, ImportFailed, type ImportHost, type ImportSpec } from './importers.js';
import { type Problem, Problems, ValidationFailed } from './problem.js';
import { resolve } from 'pathe';
import { type FileSystem, type Source, SourceLoader } from './source.js';

export interface ScriptedYamlOptions {
  /**
   * One function per marker name (`run!sh:` calls `sh`), or only the names where files are just checked.
   * Functions come from each file's `$import`.
   */
  markers?: Record<string, Marker> | string[];
  fs?: FileSystem;
  templates?: string;
  importModule?: (file: string) => Promise<Record<string, unknown>>;
  strict?: boolean;
}

export interface FileOptions {
  /** The name of the file, for problems, and the place its `$dsl`, `$extends` and `$import` paths start from. */
  file?: string;
  base?: unknown;
}

/** Validates and loads scripted-yaml files. It computes nothing: see `Document.resolve`. */
export class ScriptedYaml {
  private readonly markers: Record<string, Marker | undefined> = {};
  private readonly options: ScriptedYamlOptions;
  private readonly opening = gensync((input: unknown, options: FileOptions) => this.open(input, options, []));
  private readonly module = gensync({
    sync: (spec: ImportSpec): Record<string, unknown> => {
      throw new ImportFailed(`"${spec.path}" is a module, and importing one takes a promise: use load or loadText`);
    },
    async: (spec: ImportSpec): Promise<Record<string, unknown>> => {
      if (!this.options.importModule) throw new ImportFailed(`"${spec.path}" is a module, and modules are not imported here (no importModule is given)`);
      return this.options.importModule(spec.file);
    },
  });

  constructor(options: ScriptedYamlOptions = {}) {
    if (Array.isArray(options.markers)) for (const name of options.markers) this.markers[name] = undefined;
    else Object.assign(this.markers, options.markers);
    this.options = options;
  }

  /** Checks a file and returns the problems. */
  validate(path: string): Problem[] {
    try {
      const { file, text } = this.readFile(path);
      return this.validateText(text, { file });
    } catch (error) {
      if (error instanceof ValidationFailed) return error.problems;
      throw error;
    }
  }

  /** The same check for text that is not in a file (or data already parsed). `file` names it in the problems. */
  validateText(input: unknown, options: FileOptions = {}): Problem[] {
    return this.check(input, options).problems.list;
  }

  /** Reads a file, validates it, applies `$extends`, loads each `$import` and calls each marker's function. No formula is computed. */
  async load(path: string): Promise<Document> {
    const { file, text } = this.readFile(path);
    return this.loadText(text, { file });
  }

  /** The same for text that is not in a file (or data already parsed). */
  async loadText(input: unknown, options: FileOptions = {}): Promise<Document> {
    return this.opening.async(input, options);
  }

  loadTextSync(input: unknown, options: FileOptions = {}): Document {
    return this.opening.sync(input, options);
  }

  private check(input: unknown, options: FileOptions): { source: Source | undefined; problems: Problems } {
    const file = options.file ?? '(text)';
    const problems = new Problems();
    const base = options.base === undefined ? undefined : { file: `${file} (base)`, text: options.base };
    const source = this.loader(problems).load(input, file, base);
    if (source) new Checker(source, Object.keys(this.markers), problems).run();
    if (this.options.strict) problems.strict();
    problems.sort();
    return { source, problems };
  }

  private loader(problems: Problems): SourceLoader {
    return new SourceLoader(problems, this.options.fs, this.options.templates);
  }

  private readFile(path: string): { file: string; text: string } {
    let text: string | undefined;
    try {
      text = this.loader(new Problems()).text(path);
    } catch (error) {
      throw ValidationFailed.at(path, `cannot read the file: ${(error as Error).message}`, error);
    }
    if (text === undefined) throw ValidationFailed.at(path, 'cannot read the file: it does not exist');
    return { file: path, text };
  }

  /** `chain` holds the files being loaded on the way here, to stop an import that comes back to itself. */
  private *open(input: unknown, options: FileOptions, chain: string[]): Handler<Document> {
    const file = options.file ?? '(text)';
    const { source, problems } = this.check(input, options);
    if (!source || problems.failed) throw new ValidationFailed(problems.list);

    const key = resolve(file);
    const host: ImportHost = {
      document: (spec) => {
        const target = resolve(spec.file);
        if (target === key || chain.includes(target)) throw new ImportFailed('the import comes back to this file: an import cycle');
        return this.open(spec.text, { file: spec.file }, [...chain, key]);
      },
      module: (spec) => this.module(spec),
    };
    const imports = new Map<string, Imported>();
    for (const spec of source.imports) {
      try {
        for (const imported of yield* Importer.for(spec.path)!.load(spec, host)) imports.set(imported.name, imported);
      } catch (error) {
        if (error instanceof ImportFailed) problems.error(spec.entry, error.message);
        else if (error instanceof ValidationFailed) problems.error(spec.entry, `cannot import "${spec.path}": ${error.message}`);
        else throw error;
      }
    }
    const document = new Document(file, source, imports, this.markers, problems);
    problems.sort();
    if (problems.failed) throw new ValidationFailed(problems.list);
    return document;
  }
}
