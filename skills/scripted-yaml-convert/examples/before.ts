// Before: the price rules sit between loading the account and saving the invoice.
export interface Account {
  plan: 'free' | 'team' | 'business';
  seats: number;
  yearly: boolean;
  nonprofit: boolean;
}

export interface Store {
  account(id: string): Promise<Account>;
  saveInvoice(id: string, total: number): Promise<void>;
}

export class Billing {
  constructor(private readonly store: Store) {}

  async invoice(id: string): Promise<number> {
    const account = await this.store.account(id);

    let perSeat = 0;
    let included = 3;
    if (account.plan === 'team') {
      perSeat = 12;
      included = 5;
    } else if (account.plan === 'business') {
      perSeat = 20;
      included = 10;
    }
    const paidSeats = Math.max(0, account.seats - included);
    let discount = 0;
    if (account.yearly) discount = 0.25;
    if (account.nonprofit) discount = Math.max(discount, 0.5);
    const months = account.yearly ? 12 : 1;
    const total = paidSeats * perSeat * months * (1 - discount);

    await this.store.saveInvoice(id, total);
    return total;
  }
}
