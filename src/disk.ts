import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type FileText, Files } from './files.js';
import { Templates } from './templates.js';

/** Files on the disk: a path is beside the file that names it, and `scripted-yaml/<name>` is a template of the package. */
export class DiskFiles extends Files {
  constructor(private readonly templates = new Templates()) {
    super();
  }

  read(path: string, from: string | undefined): FileText | undefined {
    if (this.templates.isTemplate(path)) return this.template(path);
    const file = from === undefined ? path : join(dirname(from), path);
    try {
      return { file, text: readFileSync(file, 'utf8') };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new Error(`${from === undefined ? 'cannot read the file' : `cannot read "${path}"`}: ${(error as Error).message}`, { cause: error });
    }
  }

  key(file: string): string {
    return (this.templates.isTemplate(file) && this.templates.file(file)) || resolve(file);
  }

  async module(file: string): Promise<Record<string, unknown>> {
    return import(pathToFileURL(resolve(file)).href);
  }

  private template(path: string): FileText {
    const file = this.templates.file(path);
    if (!file) throw new Error(`cannot read "${path}": there is no such template (only ${this.templates.names.map((name) => Templates.prefix + name).join(', ')})`);
    return { file: path, text: readFileSync(file, 'utf8') };
  }
}
