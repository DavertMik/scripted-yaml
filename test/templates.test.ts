// The base files that come with the package: a file names one as `$extends: scripted-yaml/<name>`.
// examples/order-states.yml, menu.yml and signup.yml are built on them.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ScriptedYaml } from '../src/index';
import { Templates } from '../src/templates';

const root = join(import.meta.dir, '..');
const scripted = new ScriptedYaml({ markers: { js: (source: string) => source } });
const example = (name: string) => join(root, 'examples', name);
const resolve = async (name: string, vars: Record<string, unknown>) => (await scripted.load(example(name))).resolve({ vars });
const problems = async (text: string) => (await scripted.validateText(text, { file: 'mine.yml' })).map((problem) => `${problem.severity} ${problem}`);

describe('the bundled templates', () => {
  const templates = new Templates();

  test('are the files of templates/, each with a first line that says what it is for', () => {
    expect(templates.names).toEqual(['forms', 'navigation-ui', 'state-machine']);
    expect(readdirSync(join(root, 'templates')).sort()).toEqual(['forms.yml', 'navigation-ui.yml', 'state-machine.yml']);
    for (const name of templates.names) expect(templates.about(name).length).toBeGreaterThan(20);
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).files).toContain('templates');
  });

  for (const name of ['forms', 'navigation-ui', 'state-machine']) {
    test(`${name} has no problems on its own and stays within 150 lines`, async () => {
      const file = join(root, 'templates', `${name}.yml`);
      expect(await scripted.validate(file)).toEqual([]);
      expect(readFileSync(file, 'utf8').split('\n').length).toBeLessThanOrEqual(150);
    });
  }

  test('docs/templates.md describes every template and shows what the command prints', () => {
    const docs = readFileSync(join(root, 'docs/templates.md'), 'utf8');
    for (const name of templates.names) {
      expect(docs).toContain(`## \`scripted-yaml/${name}\``);
      expect(docs).toContain(`${`scripted-yaml/${name}`.padEnd(30)}  ${templates.about(name)}`);
    }
  });

  test('the file with a key of its own, as docs/templates.md shows it, has no problems', async () => {
    const docs = readFileSync(join(root, 'docs/templates.md'), 'utf8');
    const start = docs.indexOf('$extends: scripted-yaml/state-machine');
    const shown = docs.slice(start, docs.indexOf('```', start));
    expect(await problems(shown)).toEqual([]);
    const result = await (await scripted.loadText(shown, { file: 'mine.yml' })).resolve({ vars: { state: 'on', event: 'flip' } });
    expect(result).toMatchObject({ next: 'off', flips: 2 });
  });

  test('a name that is not a template is an error that lists the templates', async () => {
    expect(await problems('$extends: scripted-yaml/wizard\n')).toEqual([
      'error mine.yml:1  $extends  cannot read "scripted-yaml/wizard": there is no such template (only scripted-yaml/forms, scripted-yaml/navigation-ui, scripted-yaml/state-machine)',
    ]);
  });

  test('a name cannot climb out of the templates', async () => {
    for (const name of ['../package', '../templates/forms', 'sub/forms', 'forms.yml']) {
      const [problem] = await problems(`$extends: scripted-yaml/${name}\n`);
      expect(problem).toContain('there is no such template');
    }
  });

  test('a problem inside a template is reported under its name', async () => {
    const [problem] = await problems('$extends: scripted-yaml/state-machine\n$replace:\n  next!: nowhere\n');
    expect(problem).toContain('unknown name "nowhere"');
  });
});

describe('$schema in a patch', () => {
  const base = '$extends: scripted-yaml/state-machine\n$schema:\n  State: [on, off]\n';

  test('a type of the patch takes the place of the one in the base', async () => {
    expect(await problems(`${base}$replace:\n  transitions:\n    - { from: on, on: flip, to: off }\n`)).toEqual([]);
    expect(await problems(`${base}$replace:\n  transitions:\n    - { from: on, on: flip, to: of }\n`)).toEqual(['error mine.yml:6  transitions[1].to  "of" is not one of: on, off']);
  });

  test('without the states, no transition fits', async () => {
    const [problem] = await problems('$extends: scripted-yaml/state-machine\n$replace:\n  transitions:\n    - { from: on, on: flip, to: off }\n');
    expect(problem).toContain('"on" is not one of');
  });

  test('`optional` of the patch adds to the fields of the base: a key of your own is then known', async () => {
    const own = `${base}$add:\n  flips!: count(transitions)\n`;
    expect(await problems(own)).toEqual(['warning mine.yml:5  flips!  "flips" is not a field of the schema']);
    expect(await problems(own.replace('  State: [on, off]\n', '  State: [on, off]\n  optional: [flips]\n'))).toEqual([]);
  });
});

describe('scripted-yaml/navigation-ui: examples/menu.yml', () => {
  const pages = [
    { label: 'Home', path: '/' },
    { label: 'Phones', path: '/products/phones' },
    { label: 'Laptops', path: '/products/laptops' },
    { label: 'Gaming', path: '/products/laptops/gaming' },
  ];

  test('has no problems', async () => {
    expect(await scripted.validate(example('menu.yml'))).toEqual([]);
  });

  test('a page in a dropdown of a dropdown: the trail, the breadcrumbs, the sitemap', async () => {
    const { menu, ...result } = await resolve('menu.yml', { path: '/products/laptops/gaming' });
    expect(menu.map((item: { label: string }) => item.label)).toEqual(['Home', 'Products', 'Docs']);
    expect(result).toEqual({
      pages,
      active: ['Products', 'Laptops', 'Gaming'],
      current: 'Gaming',
      breadcrumbs: [
        { label: 'Products', path: null },
        { label: 'Laptops', path: '/products/laptops' },
        { label: 'Gaming', path: '/products/laptops/gaming' },
      ],
      sitemap: ['/', '/products/phones', '/products/laptops', '/products/laptops/gaming'],
    });
  });

  test('the first page by default; a page that is not in the menu has no trail', async () => {
    expect(await resolve('menu.yml', {})).toMatchObject({ active: ['Home'], current: 'Home' });
    expect(await resolve('menu.yml', { path: '/nowhere' })).toMatchObject({ active: [], current: null, breadcrumbs: [] });
  });

  test('an item with `$if!` is in the menu, the pages and the sitemap only for those who see it', async () => {
    const admin = await resolve('menu.yml', { path: '/admin', user: { role: 'admin' } });
    expect(admin.menu.map((item: { label: string }) => item.label)).toEqual(['Home', 'Products', 'Admin', 'Docs']);
    expect(admin.sitemap).toContain('/admin');
    expect(admin.current).toBe('Admin');
    const reader = await resolve('menu.yml', { path: '/admin', user: { role: 'reader' } });
    expect(reader.sitemap).not.toContain('/admin');
    expect(reader.current).toBeNull();
  });

  test('items below the third level validate and are not found: the template says so', async () => {
    const text = readFileSync(example('menu.yml'), 'utf8').replace('              path: /products/laptops/gaming\n', '              path: /g\n              items:\n                - label: Deep\n                  path: /deep\n');
    expect(text).toContain('label: Deep');
    expect(await problems(text)).toEqual([]);
    const result = await (await scripted.loadText(text, { file: example('menu.yml') })).resolve({ vars: { path: '/deep' } });
    expect(result.sitemap).not.toContain('/deep');
    expect(result.current).toBeNull();
    expect(readFileSync(join(root, 'templates/navigation-ui.yml'), 'utf8')).toContain('Items below the third level are not found');
  });

  test('a link out is in the menu and not a page', async () => {
    const { menu, sitemap } = await resolve('menu.yml', {});
    expect(menu.at(-1)).toEqual({ label: 'Docs', url: 'https://docs.example.com' });
    expect(sitemap.length).toBe(4);
  });

  test('an item without a label is an error', async () => {
    const text = readFileSync(example('menu.yml'), 'utf8').replace('- label: Phones\n          path: /products/phones', '- path: /products/phones');
    expect(text).not.toContain('label: Phones');
    const [problem] = await problems(text);
    expect(problem).toContain('missing required field "label"');
  });
});

describe('scripted-yaml/forms: examples/signup.yml', () => {
  const good = { email: 'ada@example.com', password: 'long-enough', confirm: 'long-enough', age: 30, plan: 'free', company: null };

  test('has no problems', async () => {
    expect(await scripted.validate(example('signup.yml'))).toEqual([]);
  });

  test('good values: valid, no errors, every tab clean', async () => {
    const result = await resolve('signup.yml', { values: good });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.steps).toEqual([
      { id: 'account', label: 'Account', fields: ['email', 'password', 'confirm'], errors: 0 },
      { id: 'profile', label: 'Profile', fields: ['age', 'plan'], errors: 0 },
    ]);
    expect(result.fields[0]).toEqual({ name: 'email', type: 'email', label: 'Email', tab: 'account', required: true, tooltip: 'We never share it.' });
  });

  test('wrong values: one error per field, a rule across fields, counted per tab', async () => {
    const result = await resolve('signup.yml', { values: { email: 'ada@', password: 'short', confirm: 'other', age: 12, plan: 'team', company: null } });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      { field: 'email', tab: 'account', message: 'Email is not an email address' },
      { field: 'password', tab: 'account', message: 'Password must be at least 8' },
      { field: 'age', tab: 'profile', message: 'Age must be at least 18' },
      { field: 'company', tab: 'profile', message: 'Company is required' },
      { field: 'confirm', tab: 'account', message: 'The passwords differ' },
    ]);
    expect(result.steps.map((step: { errors: number }) => step.errors)).toEqual([3, 2]);
  });

  test('an empty form: only the required fields complain', async () => {
    const empty = { email: null, password: null, confirm: null, age: null, plan: null, company: null };
    const result = await resolve('signup.yml', { values: empty });
    expect(result.errors.map((error: { message: string }) => error.message)).toEqual(['Email is required', 'Password is required', 'Repeat the password is required', 'Plan is required']);
  });

  test('no values at all: the empty form resolves, to be drawn', async () => {
    const result = await resolve('signup.yml', {});
    expect(result.fields.map((field: { name: string }) => field.name)).toEqual(['email', 'password', 'confirm', 'age', 'plan']);
    expect(result.errors.length).toBe(4);
    expect(result.valid).toBe(false);
  });

  test('a number may arrive as text; what is not a number says so', async () => {
    const messages = async (age: unknown) => (await resolve('signup.yml', { values: { ...good, age } })).errors.map((error: { message: string }) => error.message);
    expect(await messages('30')).toEqual([]);
    expect(await messages('12')).toEqual(['Age must be at least 18']);
    expect(await messages('130')).toEqual(['Age must be at most 120']);
    expect(await messages('17.5')).toEqual(['Age must be at least 18']);
    expect(await messages('old')).toEqual(['Age is not a number']);
    expect(await messages(true)).toEqual(['Age is not a number']);
  });

  test('a value of the wrong kind gives one error, not a failure', async () => {
    const messages = async (values: object) => (await resolve('signup.yml', { values: { ...good, ...values } })).errors.map((error: { message: string }) => error.message);
    expect(await messages({ email: 5 })).toEqual(['Email is not an email address']);
    expect(await messages({ email: true })).toEqual(['Email is not an email address']);
    expect(await messages({ password: 12345, confirm: 12345 })).toEqual(['Password must be at least 8']);
  });

  test('each check: too big, not an option, a field shown by a condition', async () => {
    const messages = async (values: object) => (await resolve('signup.yml', { values: { ...good, ...values } })).errors.map((error: { message: string }) => error.message);
    expect(await messages({ age: 130 })).toEqual(['Age must be at most 120']);
    expect(await messages({ plan: 'gold' })).toEqual(['Plan is not one of the options']);
    expect(await messages({ plan: 'team' })).toEqual(['Company is required']);
    expect(await messages({ plan: 'team', company: 'Acme' })).toEqual([]);
  });

  test('a field type the template does not know is an error', async () => {
    const text = readFileSync(example('signup.yml'), 'utf8').replace('name: age\n      type: number', 'name: age\n      type: nummber');
    const [problem] = await problems(text);
    expect(problem).toContain('"nummber" is not one of: text, email, number');
  });
});
