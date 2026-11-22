import * as fs from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ScriptedYaml as CoreScriptedYaml, type ScriptedYamlOptions } from './scripted-yaml.js';
import { Templates } from './templates.js';

export * from './core.js';

/** `ScriptedYaml` on Node: files are read from the disk, with the package's templates, and modules are imported. */
export class ScriptedYaml extends CoreScriptedYaml {
  constructor(options: ScriptedYamlOptions = {}) {
    super({
      ...options,
      fs: options.fs ?? fs,
      templates: options.templates ?? new Templates().source,
      importModule: options.importModule ?? ((file) => import(pathToFileURL(resolve(file)).href)),
    });
  }
}
