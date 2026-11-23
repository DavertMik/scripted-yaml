import { parse as parseTemplate } from 'feelers';
import { LazyFormula } from './lazy-formula.js';

/** Something in a file that is computed later: a formula, or text with `{{ }}`. */
export abstract class Expression {
  /** The names it reads, as written: `vars.URL`, `prerequisites.staging`. Filled when the file is checked. */
  reads: string[] = [];

  constructor(
    /** The formula or the text, as written in the file. */
    readonly source: string,
  ) {}

  /** Why it cannot be used. Empty when it is fine. */
  abstract get errors(): string[];

  /** Each FEEL formula it holds, as the names it reads. */
  abstract get formulas(): LazyFormula[];

  toString(): string {
    return this.source;
  }

  toJSON(): { source: string; reads: string[] } {
    return { source: this.source, reads: this.reads };
  }
}

/** The value of a `key!:`. One FEEL expression. */
export class Formula extends Expression {
  get errors(): string[] {
    return LazyFormula.of(this.source).errors;
  }

  get formulas(): LazyFormula[] {
    return this.errors.length > 0 ? [] : [LazyFormula.of(this.source)];
  }
}

type TemplateNode = ReturnType<typeof parseTemplate>['topNode'];

/** One `{{ }}` of a text: where it starts and ends, and its formula. */
export class TextBlock {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly formula: LazyFormula,
  ) {}
}

/** Plain text with `{{ }}` in it. `feelers` finds the blocks; each block is one FEEL formula. */
export class Text extends Expression {
  readonly blocks: TextBlock[] = [];
  private readonly problems: string[] = [];

  constructor(source: string) {
    super(source);
    this.collect(parseTemplate(source).topNode);
  }

  /** True when a string holds `{{`, so it has to be read as a template. */
  static in(value: unknown): value is string {
    return typeof value === 'string' && value.includes('{{');
  }

  get errors(): string[] {
    return this.problems;
  }

  get formulas(): LazyFormula[] {
    return this.errors.length > 0 ? [] : this.blocks.map((block) => block.formula);
  }

  /** The text with each block replaced by the value `compute` gives for it. */
  render(compute: (block: TextBlock) => unknown): string {
    let out = '';
    let at = 0;
    for (const block of this.blocks) {
      out += this.source.slice(at, block.from) + Text.show(compute(block));
      at = block.to;
    }
    return out + this.source.slice(at);
  }

  /**
   * How a value of `{{ }}` reads in text. A number drops the noise of binary floats
   * (`4.90 * 3` reads 14.7, not 14.700000000000001); a date, time or duration reads as written
   * (2026-11-22, not "2026-11-22"); lists and maps are shown as JSON.
   */
  static show(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return Number.isFinite(value) ? String(Number(value.toPrecision(15))) : String(value);
    if (typeof value !== 'object') return String(value);
    const json = (value as { toJSON?: () => unknown }).toJSON?.();
    if (typeof json === 'string') return json;
    return JSON.stringify(value, (_key, item) => (typeof item === 'number' && Number.isFinite(item) ? Number(item.toPrecision(15)) : item));
  }

  private fail(message: string): void {
    if (this.problems.length === 0) this.problems.push(message);
  }

  private collect(node: TemplateNode): void {
    if (node.type.isError) return this.fail('"{{" is not closed with "}}"');
    if (node.name === 'ConditionalSpanner' || node.name === 'LoopSpanner') return this.fail('{{#if}} and {{#loop}} are not supported in text: use $if! and $each!');
    if (node.name === 'Insert') {
      const formula = node.getChild('FeelBlock');
      if (node.lastChild?.type.isError || !formula) return this.fail('"{{" is not closed with "}}"');
      const block = LazyFormula.of(this.source.slice(formula.from, formula.to));
      for (const error of block.errors) this.fail(`in {{${block.source}}}: ${error}`);
      this.blocks.push(new TextBlock(node.from, node.to, block));
      return;
    }
    for (let child = node.firstChild; child; child = child.nextSibling) this.collect(child);
  }
}
