import slugify from '@sindresorhus/slugify';
import { camelCase, capitalCase, kebabCase, pascalCase, snakeCase } from 'change-case';
import { evaluate } from 'feelin';

type TextFunction = (text: unknown) => string | null;

/**
 * The text functions scripted-yaml adds to FEEL's. Each name is one word: FEEL's own `lower case` reads badly in a formula.
 * Each takes one text and gives null for anything else, as FEEL's built-ins do.
 */
export class TextFunctions {
  private static readonly conversions: Record<string, (text: string) => string> = {
    trim: (text) => text.trim(),
    lowercase: (text) => text.toLowerCase(),
    uppercase: (text) => text.toUpperCase(),
    capitalize: (text) => text.charAt(0).toUpperCase() + text.slice(1),
    slug: (text) => slugify(text, { decamelize: false }),
    snakecase: (text) => snakeCase(text),
    kebabcase: (text) => kebabCase(text),
    camelcase: (text) => camelCase(text),
    pascalcase: (text) => pascalCase(text),
    titlecase: (text) => capitalCase(text),
  };

  private static readonly table = new Map<string, TextFunction>(
    Object.entries(TextFunctions.conversions).map(([name, convert]) => [name, (text: unknown) => (typeof text === 'string' ? convert(text) : null)]),
  );

  static get names(): string[] {
    return [...TextFunctions.table.keys()];
  }

  static get(name: string): TextFunction | undefined {
    return TextFunctions.table.get(name);
  }
}

/** Tells whether a name is a built-in function: one FEEL ships, or one of `TextFunctions`. `feelin` does not export its list, so it is asked. */
export class Builtins {
  private static readonly known = new Map<string, boolean>();

  static has(name: string): boolean {
    let known = Builtins.known.get(name);
    if (known === undefined) Builtins.known.set(name, (known = TextFunctions.get(name) !== undefined || Builtins.ask(name)));
    return known;
  }

  /** Why a function or an import may not have this name. */
  static taken(what: string, name: string): string {
    const advice = TextFunctions.get(name) ? `remove it and call ${name}(text), which is built in, or give it another name` : 'give it another name';
    return `the ${what} "${name}" has the name of a built-in function; ${advice}`;
  }

  /** Why one formula may not both read a key and call the built-in of the same name. */
  static clash(name: string): string {
    return `"${name}" is read as a key and called as a built-in function in one formula; put the call in a key of its own`;
  }

  /** Puts into a context for `feelin` the function behind a built-in name that FEEL itself does not ship. */
  static provide(context: Record<string, unknown>, name: string): void {
    const own = TextFunctions.get(name);
    if (own) context[name] = own;
  }

  /** Calls `name()` with nothing: `feelin` warns NO_FUNCTION_FOUND for a name it does not ship. */
  private static ask(name: string): boolean {
    try {
      return !evaluate(`${name}()`, {}).warnings.some((warning) => warning.type === 'NO_FUNCTION_FOUND');
    } catch {
      return false;
    }
  }
}
