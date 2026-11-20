import { readFile } from 'node:fs/promises';
import { type Document, type Marker, type Problem, ScriptedYaml } from '../../src/index';

/** What a parser hands to scripted-yaml for one file: the text or data, and the marker functions. */
export interface Opened {
  input: unknown;
  markers: Record<string, Marker>;
}

/**
 * A small application built on scripted-yaml: it reads one kind of file and turns it into
 * something its domain understands. Each parser says which markers its files use and
 * what it makes of the loaded document.
 */
export abstract class Parser<Result, Vars = Record<string, unknown>> {
  /** The marker functions of this kind of file. */
  protected abstract markers(): Record<string, Marker>;

  /** Turns a file into the parser's result. `vars` are the values the file's `$vars` ask for. */
  abstract parse(file: string, vars: Vars): Promise<Result>;

  /** Checks a file without running anything: markers are given by name only. */
  async validate(file: string): Promise<Problem[]> {
    const { input, markers } = await this.open(file);
    return new ScriptedYaml({ markers: Object.keys(markers) }).validate(input, { file });
  }

  /** What to hand to scripted-yaml for a file. A YAML file is handed over as text. */
  protected async open(file: string): Promise<Opened> {
    return { input: await readFile(file, 'utf8'), markers: this.markers() };
  }

  /** The loaded document: validated, markers applied, nothing computed. */
  protected async load(file: string): Promise<Document> {
    const { input, markers } = await this.open(file);
    return new ScriptedYaml({ markers }).parse(input, { file });
  }
}
