/** Functions a file imports with $import. Synchronous: a formula cannot wait for a promise. */
export class Helpers {
  static slug(text) {
    return text.toLowerCase().replaceAll(' ', '-');
  }
}

export const slug = Helpers.slug;
