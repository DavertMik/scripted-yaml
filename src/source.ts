import { Importer, ImportFailed, ImportSpec } from './importers.js';
import { type Entry, MapNode, type Node, ScalarNode, Signature } from './node.js';
import { Platform } from './platform.js';
import { Patch } from './patch.js';
import type { Problems } from './problem.js';
import { SourceReader } from './reader.js';
import { Schema } from './schema.js';
import { Templates } from './templates.js';
import { Variables } from './variables.js';

/** One file as written: its tree after `$extends`, and what its top `$` keys say. Nothing is computed. */
export class Source {
  /** `$` keys that are words of the language at the top of a file, not data. */
  static readonly rootKeywords = ['$vars', '$functions', '$import', '$schema', '$dsl', '$extends', '$tests'];

  readonly variables = new Variables();
  /** `$functions`, by name. */
  readonly functions = new Map<string, Entry>();
  readonly imports: ImportSpec[] = [];
  /** Every imported name, with the line of `$import` that brings it. */
  readonly imported = new Map<string, ImportSpec>();
  schema?: Schema;

  constructor(
    readonly file: string,
    readonly root: MapNode,
    private readonly loader: SourceLoader,
    private readonly problems: Problems,
  ) {
    this.variables.add(root.get('$vars')?.value, problems);
    this.readFunctions(root.get('$functions')?.value);
    this.readImports(root.get('$import')?.value);
    const dsl = this.readDsl(root.get('$dsl'));
    const schema = root.get('$schema')?.value ?? dsl?.get('$schema')?.value;
    if (schema) this.schema = new Schema(schema, problems);
  }

  /** The entries that are the file's data: everything but the top keywords. */
  get data(): Entry[] {
    return this.root.entries.filter((entry) => !Source.rootKeywords.includes(entry.name));
  }

  /** The `$tests` of the file, as plain data. */
  get tests(): unknown[] {
    const tests = this.root.get('$tests')?.value.toData();
    return Array.isArray(tests) ? tests : [];
  }

  private readFunctions(node: Node | undefined): void {
    if (!node) return;
    if (!(node instanceof MapNode)) return this.problems.error(node, '$functions must be a map: name(parameter)!: formula');
    for (const entry of node.entries) {
      const signature = new Signature(entry.name);
      if (entry.key.kind !== 'formula') {
        this.problems.error(entry, `a function is a formula: write "${signature.name}(…)!: …"`);
        continue;
      }
      if (signature.parameters && entry.value instanceof ScalarNode) entry.formula = signature.define(entry.value.source);
      this.functions.set(signature.name, entry);
    }
  }

  private readImports(node: Node | undefined): void {
    if (!node) return;
    if (!(node instanceof MapNode)) return this.problems.error(node, '$import must be a map: path: names');
    for (const entry of node.entries) {
      const path = entry.key.raw;
      const importer = Importer.for(path);
      if (!importer) {
        this.problems.error(entry, `cannot import "${path}": there is no importer for ${Platform.path.extname(path) || 'this kind of'} files (only ${Importer.supported.join(', ')})`);
        continue;
      }
      const spec = new ImportSpec(path, this.loader.absolute(entry.file, path), entry.value.toData(), entry);
      try {
        for (const name of importer.names(spec)) this.imported.set(name, spec);
        if (!importer.exists(spec)) throw new ImportFailed(`cannot import "${path}": the file does not exist`);
        this.imports.push(spec);
      } catch (error) {
        this.problems.error(entry, (error as Error).message);
      }
    }
  }

  /** Reads the DSL file named by `$dsl`: the variables it makes known, and its tree for the schema. */
  private readDsl(entry: Entry | undefined): MapNode | undefined {
    if (!entry) return undefined;
    if (!(entry.value instanceof ScalarNode) || typeof entry.value.value !== 'string') {
      this.problems.error(entry, '$dsl names one file by its path');
      return undefined;
    }
    const dsl = this.loader.read(entry, entry.value.value);
    this.variables.add(dsl?.get('$vars')?.value, this.problems, true);
    return dsl;
  }
}

/**
 * The application's way to read a file that `$extends` or `$dsl` names, in place of the disk.
 * It gets the path as written and the file that names it, and gives the text, or the text with the
 * name the file goes by (for problems and its own relative paths). Undefined: the disk is read.
 */
export type Reader = (path: string, from: string) => string | { file: string; text: string } | undefined;

/** Reads a file and the files it names with `$extends` and `$dsl`. */
export class SourceLoader {
  private readonly templates = new Templates();

  constructor(
    private readonly problems: Problems,
    private readonly reader?: Reader,
  ) {}

  /** The source for text or data. Undefined when it cannot be read at all; the problems say why. */
  load(input: unknown, file: string): Source | undefined {
    const root = this.tree(input, file, [Platform.path.resolve(file)]);
    return root && new Source(file, root, this, this.problems);
  }

  /** Where a path written in a file points: beside that file, or a template of the package for `scripted-yaml/<name>`. */
  absolute(file: string, path: string): string {
    if (this.templates.isTemplate(path)) return this.templates.file(path) ?? path;
    const { dirname, resolve } = Platform.path;
    return resolve(dirname(file), path);
  }

  /** Reads the tree of a file that another file names. A problem is reported on the line that names it. */
  read(from: Entry, path: string, chain: string[] = []): MapNode | undefined {
    const { dirname, join, resolve } = Platform.path;
    const given = this.reader?.(path, from.file);
    if (given !== undefined) {
      const { file, text } = typeof given === 'string' ? { file: join(dirname(from.file), path), text: given } : given;
      if (chain.includes(resolve(file))) {
        this.problems.error(from, `"${path}" extends itself, directly or through other files`);
        return undefined;
      }
      return this.tree(text, file, [...chain, resolve(file)]);
    }
    const absolute = this.absolute(from.file, path);
    if (chain.includes(absolute)) {
      this.problems.error(from, `"${path}" extends itself, directly or through other files`);
      return undefined;
    }
    if (this.templates.isTemplate(path) && !this.templates.file(path)) {
      this.problems.error(from, `cannot read "${path}": there is no such template (only ${this.templates.names.map((name) => Templates.prefix + name).join(', ')})`);
      return undefined;
    }
    let text: string;
    try {
      text = Platform.fs.readFileSync(absolute, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      this.problems.error(from, `cannot read "${path}": ${code === 'ENOENT' ? 'the file does not exist' : (error as Error).message}`);
      return undefined;
    }
    const named = this.templates.isTemplate(path) ? path : join(dirname(from.file), path);
    return this.tree(text, named, [...chain, absolute]);
  }

  private tree(input: unknown, file: string, chain: string[]): MapNode | undefined {
    const root = SourceReader.for(input, file, this.problems).read();
    const base = root?.get('$extends');
    if (!root || !base) return root;
    if (!(base.value instanceof ScalarNode) || typeof base.value.value !== 'string') {
      this.problems.error(base, '$extends names one file by its path');
      return undefined;
    }
    const target = this.read(base, base.value.value, chain);
    if (!target) return undefined;
    new Patch(root, target, this.problems).apply();
    return target;
  }
}
