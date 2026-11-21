---
name: scripted-yaml
description: Write and check scripted-yaml files - YAML with marked formulas (`key!:` in FEEL), `{{ }}` in text, application markers (`run!sh:`) and `$` keywords ($vars, $value, $functions, $import, $if, $each, $when, $schema, $dsl, $extends, $tests). Use when creating, editing, reviewing or debugging such a file (pipelines, shop rules, routers, UI descriptions, Markdown front matter), or when `scripted-yaml validate` reports a problem.
---

# scripted-yaml

A scripted-yaml file is a YAML file. Four markers say what is not plain data:

| You write | It means |
|---|---|
| `key: text` | data; in text, each `{{ formula }}` is computed |
| `key!: formula` | the value is one FEEL formula |
| `key!name: value` | the value goes, as written, to the application's function `name` (`sh`, `mdq`: the application chooses) |
| `$keyword:` | a word of the language, not data |

Every example below is a file in `examples/` beside this skill, checked by the project's tests.
After writing or changing a file, **always run `scripted-yaml validate`** (last section).

```yaml
$vars:
  STAGING_URL: { optional: true, about: Where the app under test runs. }
  BRANCH:      { default: main }
  CI:          { optional: true }

prerequisites:
  staging:
    $value!: vars.STAGING_URL != null
    message: No staging URL. Set STAGING_URL.
  browser:
    $value!sh: ls ~/.cache/ms-playwright | grep -q chromium
    message: No browser installed.

timeout!: if vars.CI != null then "30m" else "10m"

stages:
  - id: plan
    title: Plan for {{ vars.BRANCH }}
    when!: prerequisites.staging
    task: Write a test plan for {{ vars.STAGING_URL }} in plan.md.

  - id: explore
    title: Browser testing
    when!: stages.plan.when and prerequisites.browser
    run!sh: npx explorbot test plan.md
```

- **Names are paths, spelled as in the file**: `prerequisites.staging`, `vars.BRANCH`. A list item is
  named by its `id`: `stages.plan.when`. A bare name is looked up among sibling keys, then each
  enclosing map, then the top of the file. Keys a formula reads must be identifiers: `test_command`.
- **`$vars`** declares the inputs; read them as `vars.NAME`. Required unless `optional: true` or a
  `default`. Unset or empty is null. Values are not converted: text stays text.
- **`$value`** makes a map a value: `prerequisites.staging` is the boolean, `prerequisites.staging.message`
  the text. One formula cannot read both of the same map.
- **Keys are definitions, not steps.** Order means nothing; a key is computed when first read, once.
- **A marked value** (`!sh`) is never looked into. A formula that reads one gets its `toString()`:
  `"1"` is true, `"0"` is false. Do not put `{{ }}` in it: it is not filled in.

## FEEL in ten lines

```
vars.method = "GET"                         equals is ONE =; text is in double quotes
a and b     a or b     not(a)               not is a function
vars.NAME != null                           "is set"; unset or empty variables are null
if a then b else c                          else is required; no ?: ternary
x in ["a", "b"]      day between 1 and 5    one of; within
cart.items[price > 10]                      pick items; a bare name is the item's field
cart.items.price                            one field of every item
count(list)  sum(list)  min(list)           lists count from 1: list[1], list[-1]
for item in list return item.price * 2      a loop gives one result per item
some item in list satisfies item.price > 5  yes or no over a list (also: every)
```

Text functions: `starts with(a, b)`, `upper case(a)`, `string join(list, ", ")`, `string(number)`.

## Mistakes

```yaml
role: admin
ok: true
items: [a, b]
price: 5
test-command: npm test

same!: role == "admin"
allowed!: role in ["admin", "owner"] and ok
blocked!: not ok
first!: items[0]
label!: prise * 2
ready!: test-command != null
ci!: vars.CI != null
```

`scripted-yaml validate mistakes.yml` prints:

```
error    mistakes.yml:9  blocked!  unknown name "not ok"; for text, remove the "!"
error    mistakes.yml:11  label!  unknown name "prise"; did you mean "price"?
error    mistakes.yml:12  ready!  unknown name "test"; a key with a dash cannot be read by a formula: name it with an underscore
error    mistakes.yml:12  ready!  unknown name "command"; a key with a dash cannot be read by a formula: name it with an underscore
warning  mistakes.yml:13  ci!  the variable "CI" is not declared in $vars; it is null unless the application passes it
```

Right: `role = "admin"`, `(role in ["admin", "owner"]) and ok`, `not(ok)`, `items[1]`, `test_command`,
and `CI: { optional: true }` under `$vars` (`examples/fixed.yml`).

Validation checks the syntax of a formula and that every name in it is defined; nothing more. It
does not report `same`, `allowed` and `first` above, nor these; they are wrong only when computed:

- **Equals is ONE `=`**; `x in list and y` is read as `x in (list and y)`: put brackets around the `in` test; lists count from 1, there is no `[0]`.
- **No truthiness.** `vars.NAME and ok` is null. Write `vars.NAME != null and ok`. `$if!` refuses null.
- **Text plus number is an error.** Write `"Total: " + string(n)`.
- **`sum` of an empty list is null.** Write `sum(append(list, 0))`.
- **A filter must be a comparison**: `[on_sale = false]`, not `[not(on_sale)]`.
- **A function parameter must not be named like a field of the items it filters.** A name a formula makes (a loop variable, a parameter, an entry of `{ }`) is its own in the whole formula: do not also read a key of that name there.
- In YAML, a formula that starts with `"`, `[` or `{`, or holds `: ` or ` #`, goes in single quotes:
  `label!: '"Price: " + string(price)'`. Quote a text value that starts with `{{`.

## Functions, structure, tests

```yaml
$vars:
  cart:     {}
  customer: {}
  cities:   { default: [] }

$functions:
  inCart(wanted)!: vars.cart.items[category = wanted]
  total(items)!: sum(append(items.price, 0))

is_vip!: count(vars.customer.orders) >= 10 or "vip" in vars.customer.tags

discount:
  loyalty!: if is_vip then vars.cart.subtotal * 0.05 else 0
  books!: if count(inCart("books")) >= 3 then total(inCart("books")) * 0.1 else 0
  $value!: max(loyalty, books)
  note: The bigger of the two discounts applies.

to_pay!: vars.cart.subtotal - discount

shipping:
  - name: Standard
    price!: if to_pay >= 50 then 0 else 4.90
  - name: Express
    price: 12.90
    $if!: is_vip
  - name: Economy
    price: 2.50
    $unless!: is_vip
  - $each!: vars.cities
    $as: city
    name: Pickup in {{ city }}
    price: 0
    $if!: city != "Paris"

checkout:
  payment_methods: [card, paypal]
  $when:
    - $if!: to_pay > 1000
      payment_methods: [card, bank_transfer]
      note: Orders over 1000 need a card or a bank transfer.
    - $else:
      note: ''

$tests:
  - about: A regular customer with three books
    vars:
      customer: { orders: [], tags: [vip] }
      cities: [Lyon, Paris]
      cart: { subtotal: 60, items: [{ category: books, price: 10 }, { category: books, price: 20 }, { category: books, price: 30 }] }
    expect:
      discount: 6
      discount.note: The bigger of the two discounts applies.
      to_pay: 54
      shipping.name: [Standard, Express, Pickup in Lyon]
      checkout.payment_methods: [card, paypal]
```

- **`$functions`**: `name(parameters)!: formula`. Not the name of a FEEL built-in or of a key.
- **`$if!` / `$unless!`** keep or drop the list item or map they sit in. They must give true or false.
- **`$each!`** repeats a list item per value, named by `$as`; `$if!` beside it is checked per value.
- **`$when`** changes keys of its map: every matching case applies, in order; `$else` when none did.
- **`$tests`**: `vars` in, `expect` out, as paths. The application runs them with `document.test()`.

## `$import`: functions and data from other files

```yaml
$import:
  ./helpers.js: [slug]          # names the module exports
  ./settings.yml: settings      # one name for the whole file
  ./handbook.md: handbook       # a function: selector in, Markdown out

title: Summer Sale
path!: '"/pages/" + slug(title)'
free_from: Free shipping from {{ settings.free_shipping_from }} {{ settings.currency }}
releases!: handbook("section(/^Releases/) paragraph")
```

`scripted-yaml parse import.yml` gives `path` as `"/pages/summer-sale"`, `free_from` as
`"Free shipping from 50 EUR"` and `releases` as `"We release on Tuesdays.\n"`.

A formula calls only FEEL built-ins, `$functions` and imported names. Imported functions are
synchronous. Paths are relative to the file. In an `mdq` selector inside a formula, match text
with a regular expression (`section(/^Releases/)`): double quotes would end the FEEL text.

## `$schema` and `$dsl`: which keys a file has

```yaml
$schema:
  required: [name, agents*:Agent]
  optional: [target:Target, lead]
  Agent:
    key: name
    required: [name, role:Role]
    optional: [about, tools*]
  Role: [reviewer, tester]
  Target: [issue, pr]

name: qa-team
target: pr
agents:
  - name: ann
    role: reviewer
    tools: [git, gh]
  - name: raj
    role: tester
    about: Runs the browser tests.

lead!: agents.ann.role
```

`field` is text, `field*` is many (a list, or a map keyed by name), `field:Type` has a named shape
or is one of a set of words. `key:` names the field that identifies an item (`id` when omitted).
A missing or wrong field is an error; a key that is not listed is a warning
(`examples/team-wrong.yml`):

```
error    team-wrong.yml:10  target  "branch" is not one of: issue, pr
warning  team-wrong.yml:11  colour  "colour" is not a field of the schema
error    team-wrong.yml:13  agents[1]  missing required field "role"
error    team-wrong.yml:15  agents[2].role  "manager" is not one of: reviewer, tester
```

When many files share a schema, it lives in its own file and each file starts with
`$dsl: ./pipeline.dsl.yml`. A DSL only checks: defaults belong in the file's own `$vars`.

## `$extends`: a patch of another file

The base, `examples/base.yml`, has the stages `lint`, `test` (with `when!` and a `task`) and `report`. The patch:

```yaml
$extends: ./base.yml

$vars:
  RELEASE: { optional: true }

$replace:
  name: release-checks

stages:
  $before:
    install:
      title: Install
      run!sh: npm ci

  test:
    $replace:
      when!: base and vars.RELEASE != null
    task:
      $after: Fail on the first broken test.
    $after:
      coverage:
        title: Coverage
        run!sh: npm run coverage

  $remove: [report]
```

The result has the stages `install, lint, test, coverage`. Every change says what it does:
`$replace` overwrites fields that exist; `$before` / `$after` add items to a list, beside one item,
or text to a text field; `$add` adds entries to a map; `$remove` drops entries; `base` is the
inherited value. A plain field in a patch is an error, and so is a key the base does not have.

## Checking a file

```
scripted-yaml validate <file>... [--markers sh,mdq]
scripted-yaml parse <file> [--var NAME=value]... [--vars file.json] [--markers sh,mdq]
```

1. `validate` prints `ok`, or one line per problem: severity, `file:line`, key, message. The exit
   code is 1 when there is an error. Name the markers the files use: `--markers sh`. A `.md` file
   is checked by its front matter.
2. Fix every error. Fix warnings too, unless the variable really comes from outside undeclared.
3. `parse` prints the file as JSON with every formula computed, for the variables you pass. Use it
   to see that conditions give true or false, not null. A marked value shows as
   `{ "marker": "sh", "source": "…" }`; a formula that reads one sees its source text there.
