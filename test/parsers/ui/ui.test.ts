import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { Action, UiParser } from './ui';

const file = join(import.meta.dir, 'fixtures/dashboard.yml');
const parser = new UiParser();

const ann = { name: 'Ann', role: 'member' };
const raj = { name: 'Raj', role: 'admin' };
const projects = [
  { name: 'Shop', failed: 0, archived: false },
  { name: 'Blog', failed: 2, archived: false },
  { name: 'Old', failed: 9, archived: true },
];

describe('ui parser', () => {
  test('the fixture fits its own schema', async () => {
    expect(await parser.validate(file)).toEqual([]);
  });

  test('signed out: only the sign-in button is there', async () => {
    const page = await parser.parse(file);
    expect(page.title).toBe('Dashboard');
    expect(page.components.map((component) => [component.type, component.text])).toEqual([['button', 'Sign in']]);
  });

  test('a !action key is an Action the application can call, never text', async () => {
    const [button] = (await parser.parse(file)).components;
    expect(button!.click).toBeInstanceOf(Action);
    expect(button!.click!.handler).toBe('auth.signIn');
  });

  test('signed in: $if and $unless swap the heading for the button', async () => {
    const page = await parser.parse(file, { user: ann });
    expect(page.components.map((component) => component.type)).toEqual(['heading', 'text', 'panel']);
    expect(page.components[0]!.text).toBe('Welcome back, Ann');
  });

  test('$each makes one card per project, and $if drops the archived one', async () => {
    const page = await parser.parse(file, { user: ann, projects });
    const cards = page.components.filter((component) => component.type === 'card');
    expect(cards.map((card) => [card.text, card.badge])).toEqual([
      ['Shop', 'ok'],
      ['Blog', '2 failing'],
    ]);
    expect(cards[1]!.click!.handler).toBe('projects.open');
  });

  test('$when changes the style of a component as cases match', async () => {
    const status = async (failed: number[]) => {
      const list = failed.map((count, index) => ({ name: `p${index}`, failed: count, archived: false }));
      return (await parser.parse(file, { user: ann, projects: list })).components.find((component) => component.type === 'text')!;
    };
    expect(await status([0, 0])).toEqual({ type: 'text', text: '0 of 2 projects are failing', style: 'plain' });
    expect((await status([1, 0])).style).toBe('warning');
    expect(await status([1, 1, 4])).toEqual({ type: 'text', text: '3 of 3 projects are failing', style: 'danger', hint: 'Stop the line.' });
  });

  test('nested components: an admin sees more of the panel', async () => {
    const children = async (user: object) => (await parser.parse(file, { user, theme: 'dark' })).components.at(-1)!.children!.map((child) => child.text);
    expect(await children(ann)).toEqual(['Theme is dark', 'Ask an admin to invite people.']);
    expect(await children(raj)).toEqual(['Theme is dark', 'Invite people', 'You manage this workspace.']);
  });

  test('the page renders to HTML', async () => {
    const html = await parser.render(file, { user: raj, projects: projects.slice(0, 1) });
    expect(html).toBe(
      [
        '<main title="Dashboard">',
        '  <heading>Welcome back, Raj</heading>',
        '  <text style="plain">0 of 1 projects are failing</text>',
        '  <card badge="ok" onclick="projects.open">Shop</card>',
        '  <panel>Settings',
        '    <button onclick="settings.toggleTheme">Theme is light</button>',
        '    <button onclick="members.invite">Invite people</button>',
        '    <text>You manage this workspace.</text>',
        '  </panel>',
        '</main>',
      ].join('\n'),
    );
  });

  test('a component of an unknown type is refused by the schema of the file', async () => {
    const problems = await parser.validate(join(import.meta.dir, 'fixtures/broken.yml'));
    expect(problems.map((problem) => [problem.line, problem.severity, problem.message])).toEqual([
      [10, 'error', '"slider" is not one of: heading, button'],
      [11, 'warning', '"colour" is not a field of the schema'],
    ]);
  });
});
