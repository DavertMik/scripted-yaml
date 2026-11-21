---
name: scripted-yaml-convert
description: Use when asked to convert, extract, migrate or move existing application logic (business rules, pricing, discounts, permissions, feature flags, UI visibility, game rules, hard-coded tables and thresholds, if/else chains) out of code into scripted-yaml files, to add a new rule file or spec to a project that has some, or to decide which part of a codebase is worth putting into YAML.
---

# Converting application logic to scripted-yaml

Move the smallest piece of **decision logic** out of the code into one short YAML file, and prove
the behaviour did not change. Minimal on everything: area, variables, functions, keys, lines.

The purpose is **one place for each business rule**: the file its owner opens to read and change
it. A rule written twice, or spread over several files, misses that purpose.

For the syntax (`key!:`, `$vars`, `$value`, `$functions`, `$if!`, `$each!`, `$tests`, FEEL and its
mistakes) read the `scripted-yaml` skill first. This skill is only about what to move and how much.

## 1. Narrow down

Do not read the whole application. Start from the one place the user named, or search for where
rules are decided: chains of `if`/`switch` over plain values, tables of constants, thresholds,
wording that depends on a condition.

| Moves to YAML: what its owner will want to change | Stays in code: what the owner never looks at |
|---|---|
| conditions, thresholds, rates, limits | reading and writing (database, network, files) |
| magic values and constants written into the code | anything async, timers, retries |
| lookup tables, lists of options, formats supported | loops that keep state, algorithms, parsing |
| which items show, which are allowed | error handling, logging, types |
| texts the user sees, and text that depends on the data | ids, keys and wiring only the code needs |

A formula cannot wait, write or raise the application's own errors. A piece that does, stays.
For each value ask: would the owner of the rule change it later? Yes: it goes to the file. It only
makes the code work: it stays in code, even if it sits beside the rule today.

## 2. Look for the rule before you write it

Before a new file or a new key, search the project's YAML files (`$vars`, `!:` keys) and the code
for the same rule: the same threshold, the same table, the same condition under another name.

- **It is already in a YAML file**: read it from there; add to that file. Do not declare it again.
- **It is in the code more than once** (the VIP test in checkout and again in emails): one key, and
  every place reads it. Say to the user which copies you found and whether they agreed.
- **Two rules are nearly the same**: reorganise the data so one formula serves both: a table with
  a row per case, a function with a parameter, a list with `$each!`. Not two formulas that differ
  by a number.

## 3. Pick the minimal area

One function or one method, where the rules sit between "load" and "save"; rules there that share
inputs are one area. Say to the user what you picked and what you left, then go on. Do not convert
a second function in the same change.

## 4. Write the file, smallest first

In this order, each only as far as the code needs:

1. **`$vars`**: only the inputs the rules read. Pass the object the code already has
   (`account`), not one variable per field. No variable for a constant: a constant is a key.
2. **Tables**: values repeated per case (`if plan === 'team' …`) become one map of rows and one
   lookup: `plan!: get value(plans, vars.account.plan)`.
3. **Keys**: one key per step of the old code, named as the code names it, in `snake_case`. A
   variable the code overwrites step by step becomes one key per step, the last reading the others.
   A key the code reads is a plain key: a map with `$value` comes back from `resolve` as a map.
   A list the code reads has maps as items (`- name: vip`, `$if!: …`), not bare words.
4. **Repeatable parts**: the same expression three times becomes one `$functions` entry; the same
   list item per value becomes `$each!`. Twice is not a reason: leave it written out.
5. **Structure**: a `$dsl` file only when several files have the same format. For one file the
   shape is written in the file itself, as `$schema`, or left out.
6. **`$tests`**: one per branch of the old code, with the numbers the old code gives. Rules are
   block YAML, one key per line; each test is one line: `- { about: …, vars: { … }, expect: { … } }`.

A state machine, a menu or a form starts from a template of the package (`scripted-yaml templates`),
not from an empty file.

Leave out: a key nobody reads, a function called once, `$import` of a helper a formula can express,
comments that repeat the key name.

## 5. One rule, one file, kept short

**One business rule lives in one file, of at most 150 lines.** A rule spread over three files
(data here, formulas there, a schema beside them) is a smell: the rule was not organised into one
point. When a file grows past 150 lines, in this order:

1. Move back to code what its owner never changes (step 1).
2. Unify what repeats (step 2): a table and one formula for ten near-equal keys.
3. Only then split, and by rule, not by kind: `pricing.yml` and `shipping.yml`, each whole and
   resolved on its own. Not `pricing-data.yml` and `pricing-formulas.yml`.

When one rule needs another's result, import it: `$import: { ./pricing.yml: pricing }`, then
`pricing.total`. Do not copy the value.

## 6. Wire it

Add `scripted-yaml` to the dependencies. Load once, resolve per call with all variables, read the
keys the code needs. Keep the old rules until step 7 is done.

## 7. Prove nothing changed, then delete the old rules

1. `scripted-yaml validate <file>` prints `ok` and the file name.
2. `scripted-yaml test <file>` prints `pass` for every test of the file. The tests the code
   already had still pass.
3. For a few inputs, the old rules and the new file give the same value. Check the edges: zero, an
   empty list, the smallest plan. Where the old code rounds, round in the formula too:
   `round half up(total, 2)`.
4. FEEL is stricter than JavaScript: a field that is missing makes `resolve` fail, and null is
   not false (`not(null)` is null). Where the data can lack a field, fill it in the code before
   `resolve`, or compare in the formula: `vars.order.express = true`.
5. Remove the old rules from the code, every copy found in step 2: two copies of a rule are worse
   than either one.

## Example

Before (`examples/before.ts`), the rules sit between loading and saving:

```ts
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
```

After, `examples/pricing.yml`: one variable, one table, five keys, no function, no schema.

```yaml
# Pricing: what an account pays. Loading and saving stay in the code.

$vars:
  account: { about: "plan, seats, yearly, nonprofit" }

plans:
  free:     { per_seat: 0,  included: 3 }
  team:     { per_seat: 12, included: 5 }
  business: { per_seat: 20, included: 10 }

plan!: get value(plans, vars.account.plan)
paid_seats!: max(0, vars.account.seats - plan.included)
months!: if vars.account.yearly then 12 else 1

discount:
  yearly!: if vars.account.yearly then 0.25 else 0
  nonprofit!: if vars.account.nonprofit then 0.5 else 0
  $value!: max(yearly, nonprofit)

total!: paid_seats * plan.per_seat * months * (1 - discount)

$tests:
  - { about: "A team of 8, paid monthly", vars: { account: { plan: team, seats: 8, yearly: false, nonprofit: false } }, expect: { total: 36 } }
  - { about: "A nonprofit business of 14, paid yearly", vars: { account: { plan: business, seats: 14, yearly: true, nonprofit: true } }, expect: { discount: 0.5, total: 480 } }
  - { about: A free account under its included seats, vars: { account: { plan: free, seats: 2, yearly: false, nonprofit: false } }, expect: { paid_seats: 0, total: 0 } }
```

And the code that is left (`examples/after.ts`):

```ts
export class Billing {
  private readonly pricing = new ScriptedYaml().load(join(import.meta.dirname, 'pricing.yml'));

  constructor(private readonly store: Store) {}

  async invoice(id: string): Promise<number> {
    const account = await this.store.account(id);
    const { total } = await (await this.pricing).resolve({ vars: { account } });
    await this.store.saveInvoice(id, total);
    return total;
  }
}
```

## Report

Tell the user: the area moved and why that one; the copies of the rule you found and unified; what
stayed in code; the variables the file needs;
the line count of each file; the inputs for which old and new gave the same values.
