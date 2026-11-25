/** Functions a file imports with $import. Synchronous: a formula cannot wait for a promise. */
export class Helpers {
  static vatRate(country) {
    return { DE: 0.19, FR: 0.2 }[country] ?? 0;
  }
}

export const vatRate = Helpers.vatRate;
