/** A file another file names, as the application gives it. */
export interface FileText {
  /** The name the file goes by: in problems, and in the paths it names in turn. Two files with one name are one file. */
  readonly file: string;
  readonly text: string;
}

/**
 * Where the files that `$extends`, `$dsl` and `$import` name come from. The library never looks
 * at a disk itself: the core reads only through this class, so it runs in a browser or a Worker.
 * `DiskFiles` (from `scripted-yaml`, not `scripted-yaml/core`) reads the disk.
 */
export abstract class Files {
  /**
   * The text of a file. `path` is written as it is in the file; `from` is the name of that file, or
   * undefined for the first file. Undefined: there is no such file. Throw an Error to refuse a name
   * with a message of your own; it is reported on the line that names it.
   */
  abstract read(path: string, from: string | undefined): FileText | undefined;

  /** Whether two names are one file, for finding a file that extends or imports itself. */
  key(file: string): string {
    return file;
  }

  /** The exports of a `.js` or `.ts` module named by `$import`. Only `load` and `loadText` ask for one. */
  async module(file: string): Promise<Record<string, unknown>> {
    throw new Error(`"${file}" is a module, and modules are not imported here`);
  }
}

/** Files held in memory, by name. A file names another by its name exactly. */
export class MemoryFiles extends Files {
  private readonly files: Map<string, string>;

  constructor(files: Record<string, string> = {}) {
    super();
    this.files = new Map(Object.entries(files));
  }

  read(path: string): FileText | undefined {
    const text = this.files.get(path);
    return text === undefined ? undefined : { file: path, text };
  }

  set(name: string, text: string): this {
    this.files.set(name, text);
    return this;
  }
}
