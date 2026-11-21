import { cpSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The agent skills that come with the package, in `skills/` beside `dist/`. */
export class Skills {
  /** Where coding agents look for skills: Claude Code, then Codex and OpenCode. */
  static readonly agentDirs = ['.claude/skills', '.agents/skills'];

  constructor(
    private readonly source = join(import.meta.dirname, '../skills'),
    private readonly roots: Record<string, string> = { local: process.cwd(), global: homedir() },
  ) {}

  get names(): string[] {
    return readdirSync(this.source).sort();
  }

  get scopes(): string[] {
    return Object.keys(this.roots);
  }

  /** The text of every skill, one after another. */
  render(): string {
    return this.names.map((name) => readFileSync(join(this.source, name, 'SKILL.md'), 'utf8')).join('\n');
  }

  /** Copies each skill, with its examples, into every agent directory of the scope. Returns the folders written. */
  install(scope: string): string[] {
    const root = this.roots[scope];
    if (root === undefined) throw new Error(`unknown install scope "${scope}"; use ${this.scopes.join(' or ')}`);
    const written: string[] = [];
    for (const dir of Skills.agentDirs) {
      for (const name of this.names) {
        const target = join(root, dir, name);
        cpSync(join(this.source, name), target, { recursive: true });
        written.push(target);
      }
    }
    return written;
  }
}
