import { readFile } from 'node:fs/promises';
import { mdq } from 'mdq-cli';
import type { Marker } from '../../../src/index';
import { type Opened, Parser } from '../parser';

// biome-ignore lint/suspicious/noExplicitAny: the shape is the front matter's own
type Page = any;

/**
 * Reads a Markdown file whose front matter is a scripted-yaml file (SPEC section 9).
 * scripted-yaml does not read Markdown: `mdq-cli` separates the YAML block from the text below,
 * and the markers query that text.
 */
export class MarkdownParser extends Parser<Page> {
  /** Without a document there is nothing to query: this is only the list of marker names. */
  protected markers(): Record<string, Marker> {
    return { mdq: () => '', rows: () => [] };
  }

  async parse(file: string, vars: Record<string, unknown> = {}): Promise<Page> {
    return (await this.load(file)).resolve({ vars });
  }

  /** The front matter goes to scripted-yaml as data, already parsed by `mdq-cli`; the markers query the Markdown. */
  protected async open(file: string): Promise<Opened> {
    const markdown = mdq(await readFile(file, 'utf8'));
    return {
      input: markdown.frontmatter(),
      markers: {
        mdq: (selector: string) => markdown.query(selector).text().trim(),
        rows: (selector: string) => markdown.query(selector).rows(),
      },
    };
  }
}
