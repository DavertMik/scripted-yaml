import { evaluate } from 'feelin';

/** Tells whether a name is a function FEEL ships. `feelin` does not export its list, so it is asked. */
export class Builtins {
  private static readonly known = new Map<string, boolean>();

  static has(name: string): boolean {
    let known = Builtins.known.get(name);
    if (known === undefined) Builtins.known.set(name, (known = Builtins.ask(name)));
    return known;
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
