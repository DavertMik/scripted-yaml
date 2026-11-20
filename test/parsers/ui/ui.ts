import type { Marker } from '../../../src/index';
import { Parser } from '../parser';

/** What `click!action: projects.open` becomes: the name of a handler of the application. */
export class Action {
  constructor(readonly handler: string) {}
}

export interface Component {
  type: string;
  text?: string;
  click?: Action;
  badge?: string;
  style?: string;
  hint?: string;
  children?: Component[];
}

export interface Page {
  title: string;
  components: Component[];
}

/** Reads a YAML description of a page and gives the components that are switched on for the given values. */
export class UiParser extends Parser<Page> {
  protected markers(): Record<string, Marker> {
    return { action: (handler: string) => new Action(handler) };
  }

  async parse(file: string, vars: Record<string, unknown> = {}): Promise<Page> {
    const { title, components } = await (await this.load(file)).resolve({ vars });
    return { title, components };
  }

  /** The page as HTML-like text, one component per line. */
  async render(file: string, vars: Record<string, unknown> = {}): Promise<string> {
    const page = await this.parse(file, vars);
    return [`<main title="${page.title}">`, ...page.components.flatMap((component) => this.lines(component, '  ')), '</main>'].join('\n');
  }

  private lines(component: Component, indent: string): string[] {
    const attributes = Object.entries({ badge: component.badge, style: component.style, title: component.hint, onclick: component.click?.handler })
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => ` ${name}="${value}"`)
      .join('');
    const open = `${indent}<${component.type}${attributes}>${component.text ?? ''}`;
    const close = `</${component.type}>`;
    if (!component.children) return [open + close];
    return [open, ...component.children.flatMap((child) => this.lines(child, `${indent}  `)), indent + close];
  }
}
