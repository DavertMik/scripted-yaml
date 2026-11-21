import { Checker } from './checker.js';
import { Document, type Marker } from './document.js';
import { type FileText, type Files, MemoryFiles } from './files.js';
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
   * Where the files that `$extends`, `$dsl` and `$import` name come from, and the file `validate` and
   * `load` open. `scripted-yaml` reads the disk (`DiskFiles`); `scripted-yaml/core` reads nothing
   * unless it is given files, such as `MemoryFiles`.
   */
  files?: Files;
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

/** A file opened by `open`: the document, and the check to run once every module it imports has loaded. */
interface Opened {
  readonly document: Document;
  settle(): void;
}

/**
 * Validates and loads scripted-yaml files. It computes nothing: see `Document.resolve`.
 * Everything is synchronous except `load` and `loadText`, which import `.js` and `.ts` modules.
 */
export class ScriptedYaml {
  private readonly markers: Record<string, Marker | undefined> = {};
  private readonly files: Files;
  private readonly strict: boolean;

  constructor(options: ScriptedYamlOptions = {}) {
    if (Array.isArray(options.markers)) for (const name of options.markers) this.markers[name] = undefined;
    else Object.assign(this.markers, options.markers);
    this.files = options.files ?? new MemoryFiles();
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
    const loading: Promise<void>[] = [];
    const opened = this.open(input, options, [], loading);
    await Promise.all(loading);
    opened.settle();
    return opened.document;
  }

  /**
   * `loadText` without a promise. It does all of it but import a `.js` or `.ts` module, which takes
   * one: a file that imports a module is a problem here.
   */
  loadTextSync(input: unknown, options: FileOptions = {}): Document {
    return this.open(input, options, [], undefined).document;
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
   * to stop an import that comes back to itself. With `loading`, each module import adds its promise
   * there, and `settle` reports what failed once they are done; without it, a module is a problem.
   */
  private open(input: unknown, options: FileOptions, chain: string[], loading: Promise<void>[] | undefined): Opened {
    const file = options.file ?? '(text)';
    const { source, problems } = this.check(input, options);
    if (!source || problems.failed) throw new ValidationFailed(problems.list);

    const key = this.files.key(file);
    const children: { spec: ImportSpec; settle: () => void }[] = [];
    const host: ImportHost = {
      document: (spec) => {
        const target = this.files.key(spec.file);
        if (target === key || chain.includes(target)) throw new ImportFailed('the import comes back to this file: an import cycle');
        const opened = this.open(spec.text, { file: spec.file }, [...chain, key], loading);
        children.push({ spec, settle: opened.settle });
        return opened.document;
      },
      module: (spec) => this.files.module(spec.file),
    };
    const failed = (spec: ImportSpec, error: unknown): void => {
      if (error instanceof ImportFailed) problems.error(spec.entry, error.message);
      else if (error instanceof ValidationFailed) problems.error(spec.entry, `cannot import "${spec.path}": ${error.message}`);
      else throw error;
    };
    const imports = new Map<string, Imported>();
    const add = (list: Imported[]) => {
      for (const imported of list) imports.set(imported.name, imported);
    };
    for (const spec of source.imports) {
      const importer = Importer.for(spec.path)!;
      if (importer.waits && !loading) {
        problems.error(spec.entry, `"${spec.path}" is a module, and importing one takes a promise: use load or loadText`);
        continue;
      }
      try {
        const result = importer.load(spec, host);
        if (result instanceof Promise) loading!.push(result.then(add, (error) => failed(spec, error)));
        else add(result);
      } catch (error) {
        failed(spec, error);
      }
    }
    const document = new Document(file, source, imports, this.markers, problems);
    const settle = (): void => {
      for (const child of children) {
        try {
          child.settle();
        } catch (error) {
          failed(child.spec, error);
        }
      }
      problems.sort();
      if (problems.failed) throw new ValidationFailed(problems.list);
    };
    if (!loading) settle();
    return { document, settle };
  }
}
