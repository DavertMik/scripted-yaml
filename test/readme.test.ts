// README.md shows three example files and their results. This test keeps both true:
// each file appears in the README word for word, and resolving it gives what the README says.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Formula, ScriptedYaml } from '../src/index';

const root = join(import.meta.dir, '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');

class Script {
  constructor(readonly js: string) {}
}

/** One example of the README: a file in `examples/`, shown without its first comment line. */
class ReadmeExample {
  private readonly scripted = new ScriptedYaml({ markers: { js: (source: string) => new Script(source) } });
  readonly path: string;

  constructor(readonly name: string) {
    this.path = join(root, 'examples', name);
  }

  get shown(): string {
    const text = readFileSync(this.path, 'utf8');
    return text.slice(text.indexOf('\n') + 1).trim();
  }

  validate() {
    return this.scripted.validate(this.path);
  }

  load() {
    return this.scripted.load(this.path);
  }

  async resolve(vars: Record<string, unknown>) {
    return (await this.load()).resolve({ vars });
  }
}

describe('the README examples', () => {
  for (const name of ['discounts.yml', 'ui.yml', 'rpg.yml', 'order-states.yml', 'menu.yml', 'signup.yml']) {
    test(`${name} is shown word for word and has no problems`, async () => {
      const example = new ReadmeExample(name);
      expect(readme).toContain(example.shown);
      expect(await example.validate()).toEqual([]);
    });
  }

  test('shop: a vip customer with a cart of 240', async () => {
    const shop = new ReadmeExample('discounts.yml');
    expect(await shop.resolve({ cart: { subtotal: 240 }, customer: { orders: [1, 2], tags: ['vip'] } })).toEqual({
      is_vip: true,
      discount: { loyalty: 12, volume: 15, $value: 15, note: 'The bigger of the two discounts applies.' },
      to_pay: 225,
      shipping: [{ name: 'Standard', price: 0 }, { name: 'Express', price: 12.9 }],
      message: 'You pay 225 and save 15.',
    });
  });

  test('shop: a new customer with a cart of 30', async () => {
    const result = await new ReadmeExample('discounts.yml').resolve({ cart: { subtotal: 30 }, customer: { orders: [], tags: [] } });
    expect(result.to_pay).toBe(30);
    expect(result.shipping).toEqual([{ name: 'Standard', price: 4.9 }]);
  });

  test('ui: signed out on the free plan', async () => {
    expect(await new ReadmeExample('ui.yml').resolve({})).toEqual({
      signed_in: false,
      is_admin: false,
      paid: false,
      header: { title: 'Dashboard', greeting: 'Welcome' },
      sidebar: [
        { label: 'Home', icon: 'home' },
        { label: 'Upgrade', icon: 'star', action: new Script('openCheckout()') },
      ],
      theme: { accent: 'blue' },
    });
  });

  test('ui: an admin on the team plan with a flag', async () => {
    const result = await new ReadmeExample('ui.yml').resolve({ user: { name: 'Ada', role: 'admin' }, plan: 'team', flags: ['charts'] });
    expect(result.sidebar.map((item: { label: string }) => item.label)).toEqual(['Home', 'Reports', 'Admin', 'Beta charts']);
    expect(result.header.greeting).toBe('Welcome back, Ada');
    expect(result.theme.accent).toBe('gold');
  });

  const brom = {
    hero: { name: 'Brom', class: 'knight', level: 7, might: 18, intellect: 8, personality: 10, endurance: 16, accuracy: 13, speed: 11, luck: 9 },
    gear: [
      { name: 'Iron sword', stat: 'damage', amount: 4 },
      { name: 'Chain mail', stat: 'armor', amount: 6 },
      { name: 'Ring of might', stat: 'might', amount: 3 },
    ],
  };
  const ilse = {
    hero: { name: 'Ilse', class: 'sorcerer', level: 12, might: 7, intellect: 22, personality: 12, endurance: 10, accuracy: 11, speed: 14, luck: 17 },
    gear: [{ name: 'Ember cloak', stat: 'fire', amount: 5 }],
  };
  const tam = { hero: { name: 'Tam', class: 'cleric', level: 4, might: 10, intellect: 10, personality: 19, endurance: 13, accuracy: 10, speed: 10, luck: 10 } };

  test('rpg: Brom the knight', async () => {
    const { classes, ...result } = await new ReadmeExample('rpg.yml').resolve(brom);
    expect(Object.keys(classes)).toEqual(['knight', 'archer', 'cleric', 'sorcerer']);
    expect(result).toEqual({
      hero_class: { hp_per_level: 12, sp_per_level: 0, magic: 'none' },
      attributes: { might: 21, intellect: 8, personality: 10, endurance: 16, accuracy: 13, speed: 11, luck: 9 },
      casting: 8,
      stats: { hit_points: 98, spell_points: 0, armor_class: 6, to_hit: 8, damage: 7 },
      resistances: { fire: -1, water: -1, mind: 0 },
      rank: 'Novice',
      summary: 'Brom, Novice knight of level 7',
      skills: [{ name: 'Strike', damage: 7 }, { name: 'Shield Wall' }],
    });
  });

  test('rpg: Ilse the sorcerer and Tam the cleric', async () => {
    const sorcerer = await new ReadmeExample('rpg.yml').resolve(ilse);
    expect(sorcerer.stats.hit_points).toBe(60);
    expect(sorcerer.stats.spell_points).toBe(120);
    expect(sorcerer.resistances.fire).toBe(7);
    expect(sorcerer.skills).toEqual([{ name: 'Strike', damage: 1 }, { name: 'Fireball', damage: 48, cost: 8 }, { name: 'Lucky Dodge' }]);
    expect(sorcerer.rank).toBe('Veteran');
    const cleric = await new ReadmeExample('rpg.yml').resolve(tam);
    expect(cleric.skills).toEqual([{ name: 'Strike', damage: 1 }, { name: 'Heal', restores: 11, cost: 3 }]);
  });

  test('the library section: what load and resolve give for ui.yml', async () => {
    const ui = new ReadmeExample('ui.yml');
    const document = await ui.load();
    expect(document.data.paid).toBeInstanceOf(Formula);
    expect(document.data.paid.source).toBe('vars.plan != "free"');
    expect(document.data.paid.reads).toEqual(['vars.plan']);
    expect(document.data.sidebar[2].action).toEqual(new Script('openCheckout()'));
    const result = await document.resolve({ vars: { plan: 'team' } });
    expect(result.paid).toBe(true);
    expect(result.theme.accent).toBe('gold');
  });

  test('the library section: the problem shown for a misspelt name', async () => {
    const text = readFileSync(new ReadmeExample('ui.yml').path, 'utf8').replace('paid!: vars.plan', 'paid!: var.plan');
    const [problem] = await new ScriptedYaml({ markers: ['js'] }).validateText(text, { file: 'ui.yml' });
    expect(`${problem!.severity} ${problem}`).toBe('error ui.yml:10  paid!  unknown name "var"; did you mean "vars"?');
  });
});
