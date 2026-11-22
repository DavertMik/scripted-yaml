import { basename, dirname, isAbsolute, join, resolve } from 'pathe';
import { HostFunction } from './functions.js';
import { Importer, ImportFailed, ImportSpec } from './importers.js';
import { MergedForm } from './merged.js';
import { type Entry, MapNode, type Node, ScalarNode, Signature } from './node.js';
import { Patch } from './patch.js';
import type { Problems } from './problem.js';
import { SourceReader } from './reader.js';
import { Schema } from './schema.js';
import { Variables } from './variables.js';

/** One file as written: its tree after `$extends`, and what its top `$` keys say. Nothing is computed. */
export class Source {
  /** `$` keys that are words of the language at the top of a file, not data. */
  static readonly rootKeywords = ['$vars', '$functions', '$import', '$schema', '$dsl', '$extends', '$tests'];

  readonly variables = new Variables();
  /** `$functions`, by name. */
  readonly functions = new Map<string, Entry>();
  /** `$functions` without a formula: the application passes them, by name. */
  readonly hosted = new Map<string, HostFunction>();
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
      if (entry.key.kind === 'plain') {
        this.host(signature, entry);
        continue;
      }
      if (entry.key.kind !== 'formula') {
        this.problems.error(entry, `a function is a formula: write "${signature.name}(…)!: …"`);
        continue;
      }
      if (this.hosted.has(signature.name)) this.problems.error(entry, `the function "${signature.name}" is declared twice in $functions; keep one`);
      if (signature.parameters && entry.value instanceof ScalarNode) entry.formula = signature.define(entry.value.source);
      this.functions.set(signature.name, entry);
    }
  }

  /** A function the application passes: `name(parameters): { about: … }`, or with no value. */
  private host(signature: Signature, entry: Entry): void {
    const settings = entry.value.toData();
    if (settings !== null && !(entry.value instanceof MapNode)) {
      this.problems.error(entry, `"${entry.key.raw}" declares a function the application passes, with a map: { about: … }; for a formula, write "${entry.key.raw}!"`);
      return;
    }
    if (this.functions.has(signature.name) || this.hosted.has(signature.name)) {
      this.problems.error(entry, `the function "${signature.name}" is declared twice in $functions; keep one`);
      return;
    }
    this.hosted.set(signature.name, new HostFunction(signature.name, signature.parameters, entry, (settings ?? {}) as Record<string, unknown>));
  }

  private readImports(node: Node | undefined): void {
    if (!node) return;
    if (!(node instanceof MapNode)) return this.problems.error(node, '$import must be a map: path: names');
    for (const entry of node.entries) {
      const path = entry.key.raw;
      const importer = Importer.for(path);
      if (!importer) {
        this.problems.error(entry, `cannot import "${path}": there is no importer for this kind of file (only ${Importer.supported.join(', ')})`);
        continue;
      }
      const found = this.loader.find(entry, path, 'import');
      const spec = new ImportSpec(path, found?.file ?? path, found?.text ?? '', entry.value.toData(), entry);
      try {
        for (const name of importer.names(spec)) this.imported.set(name, spec);
        if (found) this.imports.push(spec);
      } catch (error) {
        if (!(error instanceof ImportFailed)) throw error;
        this.problems.error(entry, error.message);
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

export interface FileSystem {
  readFileSync(path: string, encoding: 'utf8'): { toString(): string };
  readdirSync(path: string): unknown[];
}

const TEMPLATE = 'scripted-yaml/';

/** Reads a file and the files it names with `$extends` and `$dsl`. */
export class SourceLoader {
  constructor(
    private readonly problems: Problems,
    private readonly fs?: FileSystem,
    private readonly templates?: string,
  ) {}

  load(input: unknown, file: string, base?: { file: string; text: unknown }): Source | undefined {
    const chain = [resolve(file)];
    const root = base ? this.patched(input, file, base, chain) : this.tree(input, file, chain);
    return root && new Source(file, root, this, this.problems);
  }

  find(from: Entry, path: string, purpose: 'read' | 'import' = 'read'): { file: string; text: string } | undefined {
    const file = path.startsWith(TEMPLATE) || isAbsolute(path) ? path : join(dirname(from.file), path);
    try {
      const text = path.startsWith(TEMPLATE) ? this.template(path) : this.text(file);
      if (text !== undefined) return { file, text };
      this.problems.error(from, `cannot ${purpose} "${path}": the file does not exist`);
    } catch (error) {
      this.problems.error(from, `cannot ${purpose} "${path}": ${(error as Error).message}`);
    }
    return undefined;
  }

  text(file: string): string | undefined {
    try {
      return this.fs?.readFileSync(file, 'utf8').toString();
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private template(path: string): string {
    if (!this.templates) throw new Error('templates are not read here (no templates directory is given)');
    const name = path.slice(TEMPLATE.length);
    const text = basename(name) === name ? this.text(join(this.templates, `${name}.yml`)) : undefined;
    if (text !== undefined) return text;
    const names = this.fs!.readdirSync(this.templates)
      .map(String)
      .filter((file) => file.endsWith('.yml'))
      .map((file) => TEMPLATE + file.slice(0, -'.yml'.length))
      .sort();
    throw new Error(`there is no such template (only ${names.join(', ')})`);
  }

  /** Reads the tree of a file that another file names. */
  read(from: Entry, path: string, chain: string[] = []): MapNode | undefined {
    const found = this.find(from, path);
    if (!found) return undefined;
    const key = resolve(found.file);
    if (chain.includes(key)) {
      this.problems.error(from, `"${path}" extends itself, directly or through other files`);
      return undefined;
    }
    return this.tree(found.text, found.file, [...chain, key]);
  }

  private tree(input: unknown, file: string, chain: string[]): MapNode | undefined {
    const root = this.parse(input, file);
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

  private patched(input: unknown, file: string, base: { file: string; text: unknown }, chain: string[]): MapNode | undefined {
    const root = this.parse(input, file);
    const extended = root?.get('$extends');
    if (extended) {
      this.problems.error(extended, 'a patch given its base by the application does not name one with $extends');
      return undefined;
    }
    const target = this.tree(base.text, base.file, [...chain, resolve(base.file)]);
    if (!root || !target) return undefined;
    new Patch(root, target, this.problems).apply();
    return target;
  }

  private parse(input: unknown, file: string): MapNode | undefined {
    const root = SourceReader.for(input, file, this.problems).read();
    if (root) new MergedForm(this.problems).restore(root);
    return root;
  }
}
