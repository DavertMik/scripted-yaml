#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { parseArgs } from 'node:util';
import { mdq } from 'mdq-cli';
import { type Marker, type Problem, ScriptedYaml, ScriptedYamlError } from './index.js';

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
    this.markers = (parsed.values.markers ?? '').split(',').filter((name) => name !== '');
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

  protected line(problem: Problem): string {
    return `${problem.severity.padEnd(7)}  ${problem}`;
  }
}

class ValidateCommand extends Command {
  readonly usage = 'scripted-yaml validate <file>... [--markers sh,mdq]';

  async run(args: Arguments): Promise<number> {
    if (args.files.length === 0) throw new UsageError('validate needs at least one file');
    const scripted = new ScriptedYaml({ markers: args.markers });
    let failed = false;
    for (const file of args.files) {
      let lines: string[];
      try {
        const problems = await scripted.validate(this.read(file), { file });
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
  readonly usage = 'scripted-yaml parse <file> [--var NAME=value]... [--vars file.json] [--markers sh,mdq]';

  async run(args: Arguments): Promise<number> {
    const [file, ...more] = args.files;
    if (file === undefined || more.length > 0) throw new UsageError('parse takes one file');
    const vars = args.vars;
    const markers: Record<string, Marker> = {};
    for (const name of args.markers) markers[name] = (source) => new MarkedValue(name, source);
    try {
      const document = await new ScriptedYaml({ markers }).parse(this.read(file), { file });
      console.log(JSON.stringify(await document.resolve({ vars }), null, 2));
      return 0;
    } catch (error) {
      if (error instanceof ScriptedYamlError) console.error(error.problems.map((problem) => this.line(problem)).join('\n'));
      else console.error(`error    ${file}  ${(error as Error).message}`);
      return 1;
    }
  }
}

/** The `scripted-yaml` command line: validate files, or print one file resolved. */
class Cli {
  private readonly commands: Record<string, Command> = { validate: new ValidateCommand(), parse: new ParseCommand() };

  get usage(): string {
    return [
      'Usage:',
      ...Object.values(this.commands).map((command) => `  ${command.usage}`),
      '',
      '  validate  prints the problems of each file; the exit code is 1 when there is an error',
      '  parse     prints the file as JSON, every formula computed from the variables given',
      '',
      '  --markers  the marker names the files use (run!sh: is the marker "sh")',
      '             parse shows a marked value as { "marker": "sh", "source": "…" }',
      '  --var      one variable, as text; --vars reads variables from a JSON file',
    ].join('\n');
  }

  async run(argv: string[]): Promise<number> {
    const [name, ...rest] = argv;
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
