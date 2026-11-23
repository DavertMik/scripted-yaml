/**
 * Keys of a file are data, never JavaScript internals. A key named `__proto__` is set as an own
 * property (a plain `object[key] = value` would replace the object's prototype instead), and
 * `has` asks only about own properties, so `constructor` or `toString` are not taken as present.
 */
export function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
  else target[key] = value;
}

export function has(target: object, key: string): boolean {
  return Object.hasOwn(target, key);
}
