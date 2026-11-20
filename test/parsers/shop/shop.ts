import type { Marker, TestResult } from '../../../src/index';
import { Parser } from '../parser';

export interface CartItem {
  name: string;
  category: string;
  price: number;
  on_sale: boolean;
}

/** What the shop rules need to know about one order. These are the file's `$vars`. */
export interface Order {
  cart: { subtotal: number; weight: number; items: CartItem[] };
  customer: { orders: unknown[]; tags: string[] };
  destination: { country: string };
  today: { month: number; day: number };
}

export interface Code {
  code: string;
  title: string;
  valid: boolean;
  /** What the customer sees when the code is not valid. */
  message: string;
}

export interface Bundle {
  name: string;
  saving?: number;
  gift?: string;
}

export interface Shipping {
  name: string;
  days: string;
  price: number;
}

export interface Quote {
  codes: Code[];
  bundles: Bundle[];
  shipping: Shipping[];
}

type Rules = {
  discount_codes: Record<string, Omit<Code, 'code'>>;
  bundles: (Bundle & { applies: boolean })[];
  shipping: Shipping[];
};

/** Reads the shop rules and says, for one order, which codes are valid, which bundles apply and what shipping costs. */
export class ShopParser extends Parser<Quote, Order> {
  /** The shop file uses no markers: everything in it is data or a formula. */
  protected markers(): Record<string, Marker> {
    return {};
  }

  async parse(file: string, order: Order): Promise<Quote> {
    const rules: Rules = await (await this.load(file)).resolve({ vars: { ...order } });
    return {
      codes: Object.entries(rules.discount_codes).map(([code, { title, valid, message }]) => ({ code, title, valid, message })),
      bundles: rules.bundles.filter((bundle) => bundle.applies).map(({ name, saving, gift }) => this.defined({ name, saving, gift })),
      shipping: rules.shipping.map(({ name, days, price }) => ({ name, days, price })),
    };
  }

  /** Runs the examples the file carries under `$tests`. */
  async check(file: string): Promise<TestResult[]> {
    return (await this.load(file)).test();
  }

  private defined(bundle: Bundle): Bundle {
    return Object.fromEntries(Object.entries(bundle).filter(([, value]) => value !== undefined)) as unknown as Bundle;
  }
}
