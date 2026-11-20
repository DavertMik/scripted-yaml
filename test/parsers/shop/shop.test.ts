import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { type Order, ShopParser } from './shop';

const file = join(import.meta.dir, 'fixtures/shop.yml');
const parser = new ShopParser();

const item = (name: string, category: string, price: number, on_sale = false) => ({ name, category, price, on_sale });

const order = (changes: Partial<Order> = {}): Order => ({
  cart: {
    subtotal: 120,
    weight: 3,
    items: [item('Dune', 'books', 10), item('Emma', 'books', 8, true), item('Ubik', 'books', 12), item('Socks', 'socks', 4)],
  },
  customer: { orders: [], tags: [] },
  destination: { country: 'NL' },
  today: { month: 7, day: 2 },
  ...changes,
});

describe('shop parser', () => {
  test('the fixture is a valid file', async () => {
    expect((await parser.validate(file)).filter((problem) => problem.severity === 'error')).toEqual([]);
  });

  test('says which discount codes are valid for a cart and a customer', async () => {
    const quote = await parser.parse(file, order());
    expect(quote.codes.filter((code) => code.valid).map((code) => code.code)).toEqual(['WELCOME10', 'SUMMER15', 'FREESHIP']);
  });

  test('a code that is not valid carries the message for the customer, filled in', async () => {
    const quote = await parser.parse(file, order());
    const vip = quote.codes.find((code) => code.code === 'VIP20')!;
    expect(vip.valid).toBe(false);
    expect(vip.message).toBe('This code is for customers with 10 orders or more.');
  });

  test('a regular customer loses the welcome code and gains the VIP one', async () => {
    const quote = await parser.parse(file, order({ customer: { orders: [1, 2, 3], tags: ['vip'] } }));
    expect(quote.codes.filter((code) => code.valid).map((code) => code.code)).toEqual(['SUMMER15', 'VIP20', 'FREESHIP']);
  });

  test('says what shipping costs: only the options left after $if and $unless', async () => {
    const quote = await parser.parse(file, order());
    expect(quote.shipping).toEqual([
      { name: 'Standard', days: '3-5', price: 0 },
      { name: 'Express', days: '1-2', price: 12.9 },
      { name: 'Pickup point', days: '2-4', price: 0 },
    ]);
  });

  test('a heavy parcel abroad goes by freight or international', async () => {
    const heavy = order({ cart: { subtotal: 30, weight: 40, items: [] }, destination: { country: 'US' } });
    expect((await parser.parse(file, heavy)).shipping).toEqual([
      { name: 'Freight', days: '5-8', price: 90 },
      { name: 'International', days: '7-14', price: 19.9 },
    ]);
  });

  test('bundles that apply are listed with what they save', async () => {
    const quote = await parser.parse(file, order());
    expect(quote.bundles).toEqual([{ name: 'Three books, the third at half price', saving: 4 }]);
  });

  test('a bundle may give a gift instead of a saving', async () => {
    const big = order({ cart: { subtotal: 200, weight: 3, items: [] } });
    expect((await parser.parse(file, big)).bundles).toEqual([{ name: 'Spend 150, get a tote bag', gift: 'tote-bag' }]);
  });

  test('an order without a cart is refused before anything is computed', async () => {
    const { cart: _cart, ...rest } = order();
    await expect(parser.parse(file, rest as Order)).rejects.toThrow('cart');
  });

  test('the tests the file carries pass', async () => {
    const results = await parser.check(file);
    expect(results.map((result) => [result.about, result.failures])).toEqual([
      ['A regular customer gets the VIP code and free express', []],
      ['A first order from abroad pays international shipping', []],
    ]);
  });
});
