/** Imported by app.yml when the built package runs under node, which cannot import TypeScript. */
export class Host {
  static double(value) {
    return value * 2;
  }
}

export const double = Host.double;
