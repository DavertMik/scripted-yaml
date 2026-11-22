import { DiskFiles } from './disk.js';
import { ScriptedYaml as CoreScriptedYaml, type ScriptedYamlOptions } from './scripted-yaml.js';

export * from './core.js';
export { DiskFiles } from './disk.js';

/** `ScriptedYaml` of `scripted-yaml/core`, reading the disk unless it is given other `files`. */
export class ScriptedYaml extends CoreScriptedYaml {
  constructor(options: ScriptedYamlOptions = {}) {
    super({ ...options, files: options.files ?? new DiskFiles() });
  }
}
