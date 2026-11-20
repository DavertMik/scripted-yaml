import { isAlias, isMap, isScalar, isSeq, LineCounter, parseDocument, type Document as YamlDocument, type Node as YamlNode } from 'yaml';
import { ListNode, MapNode, type Node, ScalarNode } from './node.js';
import type { Problems } from './problem.js';

/** Turns what the application passed (text, or data already parsed) into the tree the library works on. */
export abstract class SourceReader {
  constructor(
    protected readonly file: string,
    protected readonly problems: Problems,
  ) {}

  /** The root map, or undefined when the input cannot be used. Problems are collected. */
  abstract read(): MapNode | undefined;

  static for(input: unknown, file: string, problems: Problems): SourceReader {
    return typeof input === 'string' ? new YamlTextReader(input, file, problems) : new DataReader(input, file, problems);
  }

  protected notAMap(): undefined {
    this.problems.error({ file: this.file, line: 1, column: 1, path: () => '' }, 'the root of a file must be a map of keys');
    return undefined;
  }
}

/** YAML text, read by the `yaml` package. Every node keeps its line. */
export class YamlTextReader extends SourceReader {
  private readonly lines = new LineCounter();
  private document!: YamlDocument.Parsed;

  constructor(
    private readonly text: string,
    file: string,
    problems: Problems,
  ) {
    super(file, problems);
  }

  read(): MapNode | undefined {
    this.document = parseDocument(this.text, { lineCounter: this.lines, prettyErrors: false, uniqueKeys: true });
    for (const error of this.document.errors) this.report(error.pos[0], error.message, 'error');
    for (const warning of this.document.warnings) this.report(warning.pos[0], warning.message, 'warning');
    if (this.document.errors.length > 0) return undefined;
    const contents = this.document.contents;
    if (contents === null) return new MapNode(this.file, 1, 1);
    const root = this.convert(contents);
    return root instanceof MapNode ? root : this.notAMap();
  }

  private report(offset: number, message: string, severity: 'error' | 'warning'): void {
    const { line, col } = this.lines.linePos(offset);
    this.problems.add({ file: this.file, line, column: col, path: () => '' }, message, severity);
  }

  private at(node: YamlNode | null): [string, number, number] {
    const { line, col } = this.lines.linePos(node?.range?.[0] ?? 0);
    return [this.file, line, col];
  }

  private convert(node: YamlNode | null): Node {
    if (isAlias(node)) return this.convert(node.resolve(this.document) ?? null);
    if (isMap(node)) {
      const map = new MapNode(...this.at(node));
      for (const pair of node.items) {
        const key = pair.key as YamlNode | null;
        const [file, line, column] = this.at(key);
        const name = isScalar(key) ? (typeof key.value === 'string' ? key.value : (key.source ?? String(key.value))) : undefined;
        if (name === undefined) {
          this.report(key?.range?.[0] ?? 0, 'a key must be text', 'error');
          continue;
        }
        map.set(name, this.convert(pair.value as YamlNode | null), { file, line, column, path: () => name });
      }
      return map;
    }
    if (isSeq(node)) {
      const list = new ListNode(...this.at(node));
      for (const item of node.items) list.add(this.convert(item as YamlNode | null));
      return list;
    }
    const value = isScalar(node) ? node.value : null;
    const source = typeof value === 'string' ? value : ((isScalar(node) ? node.source : undefined) ?? String(value));
    return new ScalarNode(...this.at(node), value, source);
  }
}

/** Data that something else parsed, such as the front matter `mdq-cli` returns. There are no lines. */
export class DataReader extends SourceReader {
  constructor(
    private readonly data: unknown,
    file: string,
    problems: Problems,
  ) {
    super(file, problems);
  }

  read(): MapNode | undefined {
    if (this.data === null || this.data === undefined) return new MapNode(this.file, 0, 0);
    const root = this.convert(this.data);
    return root instanceof MapNode ? root : this.notAMap();
  }

  private convert(value: unknown): Node {
    if (Array.isArray(value)) {
      const list = new ListNode(this.file, 0, 0);
      for (const item of value) list.add(this.convert(item));
      return list;
    }
    if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      const map = new MapNode(this.file, 0, 0);
      for (const [key, item] of Object.entries(value)) map.set(key, this.convert(item), map);
      return map;
    }
    return new ScalarNode(this.file, 0, 0, value ?? null, String(value ?? ''));
  }
}
