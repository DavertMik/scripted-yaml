# scripted-yaml

YAML files that carry small pieces of logic, and a TypeScript library that validates, parses and loads them.

```
npm install scripted-yaml
```

Runs on Node 22 or newer and on Bun. A file that imports a `.ts` module with `$import` needs a
runtime that loads TypeScript itself: Bun, or Node 22.18 and newer.

**Load only files you trust.** `load` and `parse` import the modules a file names with `$import`,
which runs their code. `validate` never does: it imports nothing and computes nothing.

## A file

```yaml
$vars:
  EXPLORBOT_URL: { optional: true }

prerequisites:
  staging:
    $value!: vars.EXPLORBOT_URL != null
    message: No staging URL. Set EXPLORBOT_URL to test in a browser.

stages:
  - id: plan
    title: Test plan
    when!: prerequisites.staging
    task: Turn the scenarios into a test plan for {{ vars.EXPLORBOT_URL }}.
    run!sh: npx explorbot plan
```

| You write | It means |
|---|---|
| `key:` | text or data; `{{ }}` inside text is a formula |
| `key!:` | the value is a formula, written in FEEL |
| `key!name:` | the value is handed to the application's function `name` |
| `$keyword:` | a word of the language: `$vars`, `$value`, `$if!`, `$unless!`, `$each!`, `$when`, `$functions`, `$import`, `$schema`, `$dsl`, `$extends`, `$tests` |

Formulas are FEEL, run by `feelin`. Text templates are read by `feelers`. YAML is read by `yaml`.
scripted-yaml has no parser of its own. [`docs/examples/`](https://github.com/DavertMik/scripted-yaml/tree/main/docs/examples) holds tested FEEL examples, including the common mistakes.

## The library

```ts
import { ScriptedYaml } from 'scripted-yaml';

class ShellCommand {
  constructor(readonly shell: string) {}
}

// The only option: one function per marker. `run!sh: npm test` calls `sh("npm test")`.
const scripted = new ScriptedYaml({
  markers: { sh: (source: string) => new ShellCommand(source) },
});

const problems = await scripted.validate(text, { file: 'pipeline.yml' });   // checks; runs nothing
for (const problem of problems) console.log(problem.severity, problem.toString());
// error pipeline.yml:12  stages.plan.when!  unknown name "prerequisite"; did you mean "prerequisites"?

const document = await scripted.load('pipeline.yml');     // validates, applies markers; computes nothing
document.data.stages[0].when.source;                      // "prerequisites.staging"   (a Formula)
document.data.stages[0].when.reads;                       // ["prerequisites.staging"]
document.data.stages[0].task.reads;                       // ["vars.EXPLORBOT_URL"]     (a Text)
document.data.stages[0].run;                              // ShellCommand { shell: "npx explorbot plan" }

const result = await document.resolve({ vars: { EXPLORBOT_URL: 'https://staging.example.com' } });
result.stages[0].when;                                    // true
result.stages[0].task;                                    // "Turn the scenarios into a test plan for https://staging.example.com."
result.prerequisites.staging;                             // { $value: true, message: "No staging URL. …" }
result.stages[0].run === document.data.stages[0].run;     // true: the library never runs or changes it
```

- `validate(text, { file })` returns `Problem`s: `file`, `line`, `column`, `key`, `message`, `severity`. It needs no values. Where files are only checked, markers may be given by name: `new ScriptedYaml({ markers: ['sh'] })`.
- `parse(textOrData, { file })` and `load(path)` validate first and throw `ValidationFailed` (with `.problems`) on an error. Then `$extends` is applied, each `$import` is loaded and each marker function is called once. Formulas stay formulas.
- `document.resolve({ vars })` returns plain data: every formula computed, `$if` / `$unless` / `$each` / `$when` applied. It throws `ResolveFailed` when a required variable is missing, a formula gives a FEEL warning, or a rule of the schema is broken.
- `document.test()` runs the file's `$tests` and returns one `TestResult` (`about`, `passed`, `failures`) per test.
- `document.variables` lists what the file declares under `$vars`.

## The command line

```
scripted-yaml validate <file>... [--markers sh,mdq]
scripted-yaml parse <file> [--var NAME=value]... [--vars file.json] [--markers sh,mdq]
```

`validate` prints one line per problem and exits with 1 when there is an error. `parse` prints the
resolved file as JSON; a marked value is shown as `{ "marker": "sh", "source": "…" }`. A `.md` file is
read by its front matter.

```
$ scripted-yaml validate pipeline.yml --markers sh
ok       pipeline.yml
```

## Rules worth knowing

- A file is self-contained. It reaches outside only through `$dsl`, `$extends` and `$import`, by path.
- Functions a formula calls come from FEEL, from `$functions`, or from `$import` (`.ts`, `.js`, `.yml`, `.yaml`, `.md`). They are synchronous.
- Nothing is computed until something reads it. Keys are definitions, not steps.
- A marker's value that a formula reads is taken through its `toString()`; `"1"` is true, `"0"` is false. Once read, the result holds that value; a value nothing reads stays as the marker function returned it.
- Validation checks a formula's syntax and that each name it uses is defined; it computes nothing. Inside `[ ]` an unknown name is taken as a field of the item.
- Any warning of `feelin` is an error with the file and key, except reading a field of null.
- `$if!` and `$unless!` must give true or false: null is an error, because FEEL has no truthiness.

## In the repository

Source: <https://github.com/DavertMik/scripted-yaml>

| Path | What |
|---|---|
| `src/` | the library and the command line |
| `test/scripted-yaml.test.ts` | the contract |
| `test/edge.test.ts`, `test/files.test.ts` | edge cases; `$extends`, `$schema`, `$dsl`, `$tests`; the files of `examples/` loaded whole |
| `test/parsers/` | five small applications built on the library: pipeline, router, markdown, ui, shop |
| `examples/` | real files in the format |
| `skills/scripted-yaml/SKILL.md` | a skill that teaches an agent to write and check these files |

```
bun test            # everything; test/package.test.ts builds dist/ first
bun run typecheck
bun run build       # dist/index.js, dist/cli.js and the type declarations
```

[`SPEC.md`](https://github.com/DavertMik/scripted-yaml/blob/main/SPEC.md) is the full specification. Licence: MIT.
