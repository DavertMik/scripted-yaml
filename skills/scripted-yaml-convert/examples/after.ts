// After: the code loads, asks pricing.yml for the total, and saves. No price rule is left here.
import { join } from 'node:path';
import { ScriptedYaml } from 'scripted-yaml';
import type { Store } from './before';

export class Billing {
  private readonly pricing = new ScriptedYaml().load(join(import.meta.dirname, 'pricing.yml'));

  constructor(private readonly store: Store) {}

  async invoice(id: string): Promise<number> {
    const account = await this.store.account(id);
    const { total } = (await this.pricing).resolve({ vars: { account } });
    await this.store.saveInvoice(id, total);
    return total;
  }
}
