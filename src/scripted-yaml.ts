import gensync, { type Handler } from 'gensync';
import { Checker } from './checker.js';
import { Document, type Marker } from './document.js';
import { FileReader, type FileSystem, type FileText } from './files.js';
import { type Imported, Importer, ImportFailed, type ImportHost, type ImportSpec } from './importers.js';
import { type Problem, Problems, ValidationFailed } from './problem.js';
import { type Source, SourceLoader } from './source.js';

export interface ScriptedYamlOptions {
  /**
   * One function per marker name (`run!sh:` calls `sh`), or only the names where files are just checked.
   * Functions come from each file's `$import`.
   */
  markers?: Record<string, Marker> | string[];
  /**
   * What the files that `validate`, `load`, `$extends`, `$dsl` and `$import` name are read with.
   * `scripted-yaml` reads the disk with `node:fs`; in a browser or a Worker, give the `fs` of `memfs`.
   * Without one, no file is read.
   */
  fs?: FileSystem;
  /** The directory of the templates that `scripted-yaml/<name>` names. `scripted-yaml` gives its own. */
  templates?: string;
  /** The exports of a `.js` or `.ts` file that `$import` names. `scripted-yaml` imports it from the disk. */
  importModule?: (file: string) => Promise<Record<string, unknown>>;
  /** Every warning is an error: a file with a warning does not load. */
  strict?: boolean;
}

export interface FileOptions {
  /** The name of the file, for problems, and the place its `$dsl`, `$extends` and `$import` paths start from. */
  file?: string;
  /**
   * The text or data the input patches. The input is then a patch of it, as if it named it with
   * `$extends`; in problems, the base is named after the file, with " (base)".
   */
  base?: unknown;
}

/**
 * Validates and loads scripted-yaml files. It computes nothing: see `Document.resolve`.
 * Everything is synchronous except `load` and `loadText`, which import `.js` and `.ts` modules.
 */
export class ScriptedYaml {
  private readonly markers: Record<string, Marker | undefined> = {};
  private readonly files: FileReader;
  private readonly importModule: ScriptedYamlOptions['importModule'];
  private readonly strict: boolean;
  /** `open` from the start, as `sync` and `async`: one way of loading, with or without a promise. */
  private readonly opening = gensync((input: unknown, options: FileOptions) => this.open(input, options, []));
  /** A module's exports: the async way waits for them; the sync way cannot. */
  private readonly module = gensync({
    sync: (spec: ImportSpec): Record<string, unknown> => {
      throw new ImportFailed(`"${spec.path}" is a module, and importing one takes a promise: use load or loadText`);
    },
    async: (spec: ImportSpec): Promise<Record<string, unknown>> => {
      if (!this.importModule) throw new ImportFailed(`"${spec.path}" is a module, and modules are not imported here (no importModule is given)`);
      return this.importModule(spec.file);
    },
  });

  constructor(options: ScriptedYamlOptions = {}) {
    if (Array.isArray(options.markers)) for (const name of options.markers) this.markers[name] = undefined;
    else Object.assign(this.markers, options.markers);
    this.files = new FileReader(options.fs, options.templates);
    this.importModule = options.importModule;
    this.strict = options.strict ?? false;
  }

  /** Checks a file and returns the problems. Runs no marker function and no import; computes only the schema rules whose fields are written out. */
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

  /**
   * `loadText` without a promise. It does all of it but import a `.js` or `.ts` module, which takes
   * one: a file that imports a module is a problem here.
   */
  loadTextSync(input: unknown, options: FileOptions = {}): Document {
    return this.opening.sync(input, options);
  }

  private check(input: unknown, options: FileOptions): { source: Source | undefined; problems: Problems } {
    const file = options.file ?? '(text)';
    const problems = new Problems();
    const base = options.base === undefined ? undefined : { file: `${file} (base)`, text: options.base };
    const source = new SourceLoader(problems, this.files).load(input, file, base);
    if (source) new Checker(source, Object.keys(this.markers), problems).run();
    if (this.strict) problems.strict();
    problems.sort();
    return { source, problems };
  }

  private readFile(path: string): FileText {
    let found: FileText | undefined;
    try {
      found = this.files.read(path, undefined);
    } catch (error) {
      throw ValidationFailed.at(path, (error as Error).message, error);
    }
    if (!found) throw ValidationFailed.at(path, 'cannot read the file: it does not exist');
    return found;
  }

  /**
   * Validates a file and loads what it imports. `chain` holds the files being loaded on the way here,
   * to stop an import that comes back to itself.
   */
  private *open(input: unknown, options: FileOptions, chain: string[]): Handler<Document> {
    const file = options.file ?? '(text)';
    const { source, problems } = this.check(input, options);
    if (!source || problems.failed) throw new ValidationFailed(problems.list);

    const key = this.files.key(file);
    const host: ImportHost = {
      document: (spec) => {
        const target = this.files.key(spec.file);
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
