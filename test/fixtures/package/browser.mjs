// Bundled for a browser by test/package.test.ts, then run. A browser build of "scripted-yaml" is its
// core: the files are in memfs, and nothing is asynchronous.
import { Volume } from 'memfs';
import { ScriptedYaml } from 'scripted-yaml';

const fs = Volume.fromJSON({ '/flows/base.yml': 'stages:\n  - id: build\n    when!: true\n' });
const scripted = new ScriptedYaml({ fs });
const patch = '$vars:\n  GO: { default: true }\n$extends: base.yml\nstages:\n  build:\n    $replace:\n      when!: base and vars.GO\n$tests:\n  - expect:\n      stages.build.when: true\n';
const document = scripted.loadTextSync(patch, { file: '/flows/patch.yml' });
const { $vars, $tests, ...merged } = document.merged();

console.log(
  JSON.stringify({
    problems: scripted.validateText(patch, { file: '/flows/patch.yml' }),
    result: document.resolve(),
    merged,
    tests: document.test().map((result) => result.passed),
  }),
);
