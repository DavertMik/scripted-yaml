// Bundled for a browser by test/package.test.ts, then run. Everything comes through "scripted-yaml/core":
// the files are in memory, and nothing is asynchronous.
import { MemoryFiles, ScriptedYaml } from 'scripted-yaml/core';

const files = new MemoryFiles({ base: 'stages:\n  - id: build\n    when!: true\n' });
const scripted = new ScriptedYaml({ files });
const patch = '$vars:\n  GO: { default: true }\n$extends: base\nstages:\n  build:\n    $replace:\n      when!: base and vars.GO\n$tests:\n  - expect:\n      stages.build.when: true\n';
const document = scripted.loadTextSync(patch, { file: 'patch' });
const { $vars, $tests, ...merged } = document.merged();

console.log(
  JSON.stringify({
    problems: scripted.validateText(patch, { file: 'patch' }),
    result: document.resolve(),
    merged,
    tests: document.test().map((result) => result.passed),
  }),
);
