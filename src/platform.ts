import type * as Fs from 'node:fs';
import type * as NodePath from 'node:path';
import type * as Url from 'node:url';

type PathModule = Pick<typeof NodePath, 'dirname' | 'extname' | 'join' | 'resolve'>;

/**
 * Node's own modules, where there is a Node or a Bun. They are asked for when used, not imported, so
 * the library also loads in a browser: there, files come through the `read` option, and a path is a
 * plain `/` path.
 */
export class Platform {
  /** The file system, or a reason it is missing. */
  static get fs(): typeof Fs {
    const fs = Platform.builtin<typeof Fs>('fs');
    if (!fs) throw new Error('there is no file system here: give ScriptedYaml a read option');
    return fs;
  }

  static get url(): typeof Url {
    const url = Platform.builtin<typeof Url>('url');
    if (!url) throw new Error('there is no module loader here: $import of a script needs Node or Bun');
    return url;
  }

  static get path(): PathModule {
    return Platform.builtin<typeof NodePath>('path') ?? SlashPath;
  }

  /** Whether two values read from YAML are the same: text, numbers, booleans, null, lists and maps. */
  static same(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return Number.isNaN(a) && Number.isNaN(b);
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => Platform.same(item, b[index]));
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && Platform.same(left[key], right[key]));
  }

  private static builtin<T>(name: string): T | undefined {
    const process = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
    return process?.getBuiltinModule?.(name) as T | undefined;
  }
}

/** Paths with `/`, for a place without Node: a browser. The current folder is `/`. */
class SlashPath {
  static dirname(path: string): string {
    const at = path.lastIndexOf('/');
    if (at < 0) return '.';
    return at === 0 ? '/' : path.slice(0, at);
  }

  static extname(path: string): string {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const at = name.lastIndexOf('.');
    return at <= 0 ? '' : name.slice(at);
  }

  static join(...parts: string[]): string {
    return SlashPath.normalize(parts.filter((part) => part !== '').join('/'));
  }

  static resolve(...parts: string[]): string {
    let path = '/';
    for (const part of parts) path = part.startsWith('/') ? part : `${path}/${part}`;
    return SlashPath.normalize(path);
  }

  private static normalize(path: string): string {
    const absolute = path.startsWith('/');
    const out: string[] = [];
    for (const segment of path.split('/')) {
      if (segment === '' || segment === '.') continue;
      if (segment === '..' && out.length > 0 && out.at(-1) !== '..') out.pop();
      else if (segment !== '..' || !absolute) out.push(segment);
    }
    const joined = out.join('/');
    if (absolute) return `/${joined}`;
    return joined || '.';
  }
}
