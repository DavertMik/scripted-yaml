// examples/order-states.yml is a state machine on the bundled template `scripted-yaml/state-machine`.
// Here an application drives it, and the schema is shown to catch a broken machine before it runs.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Document, ScriptedYaml } from '../src/index';

const path = join(import.meta.dir, '../examples/order-states.yml');
const text = readFileSync(path, 'utf8');

class Script {
  constructor(readonly js: string) {}
}

interface Order {
  total: number;
  in_stock: boolean;
}

/** The application's side: it keeps the state, asks the file what an event does, and records the effects. */
class OrderMachine {
  private static readonly scripted = new ScriptedYaml({ markers: { js: (source: string) => new Script(source) } });
  private static readonly document: Promise<Document> = OrderMachine.scripted.load(path);
  readonly ran: string[] = [];
  state = 'draft';

  constructor(readonly order: Order) {}

  async look(event?: string) {
    return (await OrderMachine.document).resolve({ vars: { state: this.state, event, order: this.order } });
  }

  async send(event: string): Promise<string> {
    const result = await this.look(event);
    if (result.error !== null) throw new Error(result.error);
    this.state = result.next;
    for (const effect of result.effects) this.ran.push(effect.run.js);
    return this.state;
  }
}

describe('a state machine in a file', () => {
  test('the file has no problems and its own tests pass', async () => {
    expect(await new ScriptedYaml({ markers: ['js'] }).validate(path)).toEqual([]);
    const scripted = new ScriptedYaml({ markers: { js: (source: string) => new Script(source) } });
    const results = await (await scripted.load(path)).test();
    expect(results.map((result) => result.failures)).toEqual([[], [], []]);
  });

  test('what the README shows for a draft order of 50 and the event pay', async () => {
    const { transitions, ...result } = await new OrderMachine({ total: 50, in_stock: true }).look('pay');
    expect(transitions.length).toBe(6);
    expect(result).toEqual({
      effects: [
        { name: 'receipt', run: new Script('sendReceipt(order)') },
        { name: 'audit', run: new Script('audit(order, event)') },
      ],
      allowed: ['pay', 'cancel'],
      match: [{ from: 'draft', on: 'pay', to: 'paid' }],
      changed: true,
      next: 'paid',
      final: false,
      error: null,
    });
  });

  test('an order walks from draft to delivered, and the effects of each step are handed over', async () => {
    const machine = new OrderMachine({ total: 50, in_stock: true });
    expect(await machine.send('pay')).toBe('paid');
    expect(await machine.send('ship')).toBe('shipped');
    expect(await machine.send('deliver')).toBe('delivered');
    expect(machine.ran).toEqual(['sendReceipt(order)', 'audit(order, event)', 'audit(order, event)', 'audit(order, event)']);
    const end = await machine.look();
    expect(end.final).toBe(true);
    expect(end.allowed).toEqual([]);
  });

  test('an event the state does not take is refused: the state stays and nothing runs', async () => {
    const machine = new OrderMachine({ total: 50, in_stock: true });
    await expect(machine.send('ship')).rejects.toThrow('Cannot ship from draft');
    expect(machine.state).toBe('draft');
    expect(machine.ran).toEqual([]);
  });

  test('a guard removes a transition: an empty order cannot be paid, a paid one out of stock cannot ship', async () => {
    const empty = new OrderMachine({ total: 0, in_stock: true });
    expect((await empty.look()).allowed).toEqual(['cancel']);
    await expect(empty.send('pay')).rejects.toThrow('Cannot pay from draft');

    const waiting = new OrderMachine({ total: 50, in_stock: false });
    await waiting.send('pay');
    expect((await waiting.look()).allowed).toEqual(['cancel']);
    await expect(waiting.send('ship')).rejects.toThrow('Cannot ship from paid');
  });

  test('cancelling refunds only what was paid', async () => {
    const draft = new OrderMachine({ total: 50, in_stock: true });
    expect(await draft.send('cancel')).toBe('cancelled');
    expect(draft.ran).toEqual(['audit(order, event)']);

    const paid = new OrderMachine({ total: 50, in_stock: true });
    await paid.send('pay');
    expect(await paid.send('cancel')).toBe('refunded');
    expect(paid.ran).toContain('refundPayment(order)');
  });

  test('without an event the file only tells what may happen', async () => {
    const result = await new OrderMachine({ total: 50, in_stock: true }).look();
    expect(result).toMatchObject({ allowed: ['pay', 'cancel'], changed: false, next: 'draft', error: null, effects: [] });
  });

  test('every state named by a transition can be left or is final, and every state is reached', async () => {
    const { transitions } = await new OrderMachine({ total: 50, in_stock: true }).look();
    const reached = new Set<string>(['draft', ...transitions.map((row: { to: string }) => row.to)]);
    expect([...reached].sort()).toEqual(['cancelled', 'delivered', 'draft', 'paid', 'refunded', 'shipped']);
    for (const row of transitions) expect(reached.has(row.from)).toBe(true);
  });
});

describe('validation of a state machine', () => {
  const scripted = new ScriptedYaml({ markers: ['js'] });
  const problems = async (changed: string) => (await scripted.validateText(changed, { file: 'order-states.yml' })).map((problem) => `${problem.severity} ${problem}`);

  test('a transition to a state that does not exist', async () => {
    expect(await problems(text.replace('to: shipped,', 'to: shiped,'))).toEqual([
      'error order-states.yml:17  transitions[3].to  "shiped" is not one of: draft, paid, shipped, delivered, cancelled, refunded',
    ]);
  });

  test('a transition from a state that does not exist', async () => {
    const [problem] = await problems(text.replace('from: shipped, on: return', 'from: lost, on: return'));
    expect(problem).toContain('transitions[6].from  "lost" is not one of');
  });

  test('a transition without a target', async () => {
    const [problem] = await problems(text.replace('on: deliver, to: delivered', 'on: deliver'));
    expect(problem).toContain('transitions[5]  missing required field "to"');
  });

  test('a state the file did not list in State', async () => {
    const [problem] = await problems(text.replace('State: [draft, paid, shipped,', 'State: [draft, paid,'));
    expect(problem).toContain('"shipped" is not one of: draft, paid, delivered, cancelled, refunded');
  });

  test('a guard that reads a name the file does not have', async () => {
    const [problem] = await problems(text.replace('$if!: vars.order.in_stock', '$if!: in_stock'));
    expect(problem).toContain('unknown name "in_stock"');
  });

  test('a state the file never declared is only a text to a formula: declare states in the schema', async () => {
    expect(await problems(text.replace('next = "refunded"', 'next = "refundd"'))).toEqual([]);
  });
});
