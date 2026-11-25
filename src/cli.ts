#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { mdq } from 'mdq-cli';
import { type Marker, type Problem, ScriptedYaml, ScriptedYamlError } from './index.js';
import { Skills } from './skills.js';
import { Templates } from './templates.js';

/** A mistake in how the command was called. */
class UsageError extends Error {}

/** A marked value as the command line shows it: it has no function to hand the value to. */
class MarkedValue {
  constructor(
    readonly marker: string,
    readonly source: unknown,
  ) {}

  /** A formula that reads the value sees the text written in the file. */
  toString(): string {
    return typeof this.source === 'string' ? this.source : JSON.stringify(this.source);
  }
}

/** What the user typed after the command. */
class Arguments {
  readonly files: string[];
  readonly markers: string[];
  /** Markers whose value is checked and computed like any value: `--computed task`. They are markers too. */
  readonly computed: string[];
  readonly install: boolean;
  private readonly pairs: string[];
  private readonly varsFile: string | undefined;

  constructor(args: string[]) {
    let parsed: ReturnType<typeof this.read>;
    try {
      parsed = this.read(args);
    } catch (error) {
      throw new UsageError((error as Error).message);
    }
    this.files = parsed.positionals;
    this.computed = (parsed.values.computed ?? '').split(',').filter((name) => name !== '');
    this.markers = [...new Set([...(parsed.values.markers ?? '').split(',').filter((name) => name !== ''), ...this.computed])];
    this.install = parsed.values.install ?? false;
    this.pairs = parsed.values.var ?? [];
    this.varsFile = parsed.values.vars;
  }

  /** The variables of `--vars file.json`, then each `--var NAME=value` over them. Values of `--var` are text. */
  get vars(): Record<string, unknown> {
    const vars: Record<string, unknown> = {};
    if (this.varsFile !== undefined) {
      try {
        Object.assign(vars, JSON.parse(readFileSync(this.varsFile, 'utf8')));
      } catch (error) {
        throw new UsageError(`cannot read --vars ${this.varsFile}: ${(error as Error).message}`);
      }
    }
    for (const pair of this.pairs) {
      const at = pair.indexOf('=');
      if (at < 1) throw new UsageError(`--var takes NAME=value, not "${pair}"`);
      vars[pair.slice(0, at)] = pair.slice(at + 1);
    }
    return vars;
  }

  private read(args: string[]) {
    return parseArgs({
      args,
      allowPositionals: true,
      options: {
        var: { type: 'string', multiple: true },
        vars: { type: 'string' },
        markers: { type: 'string' },
        computed: { type: 'string' },
        install: { type: 'boolean' },
      },
    });
  }
}

/** One command of the command line. */
abstract class Command {
  abstract readonly usage: string;

  /** Runs the command and returns the exit code. */
  abstract run(args: Arguments): Promise<number>;

  /** A YAML file is handed over as text; a Markdown file as its front matter, read by `mdq-cli`. */
  protected read(file: string): unknown {
    const text = readFileSync(file, 'utf8');
    return extname(file) === '.md' ? mdq(text).frontmatter() : text;
  }

  /** A function per marker named on the command line: it keeps the value as written. */
  protected placeholders(names: string[]): Record<string, Marker> {
    const markers: Record<string, Marker> = {};
    for (const name of names) markers[name] = (source) => new MarkedValue(name, source);
    return markers;
  }

  protected line(problem: Problem): string {
    return `${problem.severity.padEnd(7)}  ${problem}`;
  }
}

class ValidateCommand extends Command {
  readonly usage = 'scripted-yaml validate <file>... [--markers sh,mdq] [--computed task]';

  async run(args: Arguments): Promise<number> {
    if (args.files.length === 0) throw new UsageError('validate needs at least one file');
    const scripted = new ScriptedYaml({ markers: args.markers, computed: args.computed });
    let failed = false;
    for (const file of args.files) {
      let lines: string[];
      try {
        const problems = scripted.validateText(this.read(file), { file });
        failed ||= problems.some((problem) => problem.severity === 'error');
        lines = problems.length > 0 ? problems.map((problem) => this.line(problem)) : [`ok       ${file}`];
      } catch (error) {
        failed = true;
        lines = [`error    ${file}  cannot read the file: ${(error as Error).message}`];
      }
      console.log(lines.join('\n'));
    }
    return failed ? 1 : 0;
  }
}

class ParseCommand extends Command {
  readonly usage = 'scripted-yaml parse <file> [--var NAME=value]... [--vars file.json] [--markers sh,mdq] [--computed task]';

  async run(args: Arguments): Promise<number> {
    const [file, ...more] = args.files;
    if (file === undefined || more.length > 0) throw new UsageError('parse takes one file');
    const vars = args.vars;
    try {
      const document = await new ScriptedYaml({ markers: this.placeholders(args.markers), computed: args.computed }).loadText(this.read(file), { file });
      console.log(JSON.stringify(document.resolve({ vars }), null, 2));
      return 0;
    } catch (error) {
      if (error instanceof ScriptedYamlError) console.error(error.problems.map((problem) => this.line(problem)).join('\n'));
      else console.error(`error    ${file}  ${(error as Error).message}`);
      return 1;
    }
  }
}

class TestCommand extends Command {
  readonly usage = 'scripted-yaml test <file>... [--markers sh,mdq] [--computed task]';

  async run(args: Arguments): Promise<number> {
    if (args.files.length === 0) throw new UsageError('test needs at least one file');
    const scripted = new ScriptedYaml({ markers: this.placeholders(args.markers), computed: args.computed });
    let failed = false;
    for (const file of args.files) {
      const lines: string[] = [];
      try {
        const results = (await scripted.loadText(this.read(file), { file })).test();
        if (results.length === 0) lines.push(`no tests ${file}`);
        for (const result of results) {
          failed ||= !result.passed;
          lines.push(`${result.passed ? 'pass' : 'FAIL'}     ${file}  ${result.about}`, ...result.failures.map((failure) => `           ${failure}`));
        }
      } catch (error) {
        failed = true;
        if (error instanceof ScriptedYamlError) lines.push(...error.problems.map((problem) => this.line(problem)));
        else lines.push(`error    ${file}  ${(error as Error).message}`);
      }
      console.log(lines.join('\n'));
    }
    return failed ? 1 : 0;
  }
}

class SkillCommand extends Command {
  readonly usage = 'scripted-yaml skill [--install [local|global]]';
  private readonly skills = new Skills();

  async run(args: Arguments): Promise<number> {
    const [scope = 'local', ...more] = args.files;
    if (!args.install) {
      if (args.files.length > 0) throw new UsageError('skill takes no file; to install, add --install');
      console.log(this.skills.render());
      return 0;
    }
    if (more.length > 0 || !this.skills.scopes.includes(scope)) throw new UsageError(`--install takes ${this.skills.scopes.join(' or ')}`);
    for (const folder of this.skills.install(scope)) console.log(`installed ${folder}`);
    return 0;
  }
}

class TemplatesCommand extends Command {
  readonly usage = 'scripted-yaml templates';
  private readonly templates = new Templates();

  async run(args: Arguments): Promise<number> {
    if (args.files.length > 0) throw new UsageError('templates takes no file');
    for (const name of this.templates.names) console.log(`${(Templates.prefix + name).padEnd(30)}  ${this.templates.about(name)}`);
    return 0;
  }
}

/** The name and version of the package, read from its package.json beside `dist/`. */
class Product {
  private readonly manifest = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')) as { name: string; version: string };

  toString(): string {
    return `${this.manifest.name} ${this.manifest.version}`;
  }
}

/** The `scripted-yaml` command line: validate files, print one file resolved, or install the agent skills. */
class Cli {
  private readonly commands: Record<string, Command> = { validate: new ValidateCommand(), parse: new ParseCommand(), test: new TestCommand(), skill: new SkillCommand(), templates: new TemplatesCommand() };

  private readonly product = new Product();

  get usage(): string {
    return [
      'Usage:',
      ...Object.values(this.commands).map((command) => `  ${command.usage}`),
      '',
      '  validate  prints the problems of each file; the exit code is 1 when there is an error',
      '  parse     prints the file as JSON, every formula computed from the variables given',
      '  test      runs the $tests of each file; the exit code is 1 when a test fails or a file has an error',
      '  skill     prints the skills that teach a coding agent to write these files and to move',
      '            application logic into them; --install copies them into .claude/skills and',
      '            .agents/skills of this project (local, the default) or of your home (global)',
      '  templates lists the base files of the package; a file builds on one with',
      '            $extends: scripted-yaml/<name>',
      '',
      '  --version  prints the name and version; every command prints them first, on stderr',
      '  --markers  the marker names the files use (run!sh: is the marker "sh")',
      '             parse shows a marked value as { "marker": "sh", "source": "…" }',
      '  --computed markers whose value is checked and computed like any value: {{ }} in run!task:',
      '  --var      one variable, as text; --vars reads variables from a JSON file',
    ].join('\n');
  }

  async run(argv: string[]): Promise<number> {
    const [name, ...rest] = argv;
    if (name === '--version' || name === '-v') {
      console.log(`${this.product}`);
      return 0;
    }
    // Every run says what is running. On stderr, so the output of a command stays clean for a pipe.
    console.error(`${this.product}`);
    if (name === '--help' || name === '-h') {
      console.log(this.usage);
      return 0;
    }
    try {
      const command = name === undefined ? undefined : this.commands[name];
      if (!command) throw new UsageError(name === undefined ? 'no command given' : `unknown command "${name}"`);
      return await command.run(new Arguments(rest));
    } catch (error) {
      if (!(error instanceof UsageError)) throw error;
      console.error(`${error.message}\n\n${this.usage}`);
      return 2;
    }
  }
}

process.exitCode = await new Cli().run(process.argv.slice(2));
