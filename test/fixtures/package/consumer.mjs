// Run with node by test/package.test.ts. It imports the package by its name, as an installed
// application would: node resolves "scripted-yaml" through the "exports" map of package.json to dist/.
import { fileURLToPath } from 'node:url';
import { Formula, Problem, ResolveFailed, ScriptedYaml, Text, ValidationFailed } from 'scripted-yaml';

class ShellCommand {
  constructor(shell) {
    this.shell = shell;
  }
}

const scripted = new ScriptedYaml({ markers: { sh: (source) => new ShellCommand(source) } });
const file = fileURLToPath(new URL('./app.yml', import.meta.url));

const document = await scripted.load(file);
const result = await document.resolve({ vars: { NAME: 'node' } });
const [problem] = await scripted.validateText('run!bash: x\n', { file: 'x.yml' });
const refused = await scripted.loadText('a!: nope\n', { file: 'x.yml' }).catch((error) => error);
const unresolved = await (await scripted.loadText('$vars:\n  N: {}\n', { file: 'x.yml' })).resolve().catch((error) => error);

console.log(
  JSON.stringify({
    greeting: result.greeting,
    twice: result.twice,
    title: result.title.trim(),
    command: result.run instanceof ShellCommand ? result.run.shell : null,
    formula: document.data.twice instanceof Formula,
    text: document.data.greeting instanceof Text,
    problem: problem instanceof Problem ? problem.toString() : null,
    refused: refused instanceof ValidationFailed,
    unresolved: unresolved instanceof ResolveFailed,
  }),
);
