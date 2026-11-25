# scripted-yaml

Status: implemented in `src/` and covered by `bun test`. This document is the
specification; `README.md` is the short guide; section 11 lists what the
library does differently from an earlier reading of this text, and what is
not built.

## 1. What it is

scripted-yaml is a way to write YAML files that carry small pieces of logic, and
a TypeScript library that **validates, parses and loads** such files.

The library does not run anything on its own. When to compute a formula, whether
to execute a shell command, how to read a Markdown file: these are decisions of
the application that loads the file. The library gives it the parsed file and
the tools to compute values when it chooses.

| The library does | The application does |
|---|---|
| checks a file and reports problems with line and key | decides which files to load and when |
| parses the file into data, with formulas kept as formulas | supplies values (`vars`) and computes formulas when it needs them |
| calls the application's function for each marked key (`!sh`, `!mdq`) | writes those functions: they may compute at once or return something to run later |
| applies `$extends` patches | executes commands, reads other formats, shows forms |

## 2. The main rule: a file is self-contained

Everything a file uses is written in that file. The only way to reach outside
is a `$` key at the top that names the other file by its path, so a reader
sees every dependency in the first lines. The library loads those files itself.

| Key | Reaches | Needed to load the file? |
|---|---|---|
| `$extends: ./web-testing.yml` | the file this one patches | yes |
| `$import: { ./controllers.ts: [Users] }` | names from another file | yes |
| `$dsl: ./pipeline.dsl.yml` | the shared schema, for checking | no |

`$dsl` only checks. Delete the `$dsl` line and the file still loads and
computes the same values; with the line, the library also verifies shape,
types and names. So nothing a file computes may depend on its DSL:

- a default value is declared in the file's own `$vars`, never in the DSL;
- a list item is addressed by its `id` field (`stages.explore`) with or without a DSL; a schema may name another field;
- a variable the file reads but does not declare is a warning, not an error, and is null unless the application passes it. A DSL can make such names known (`STAGE_DIR`, or any upper-case name), which removes the warning and nothing else.

This holds for functions too. A formula can call only FEEL's built-ins, a
function the file defines or declares under `$functions`, or a function the
file imports. `fileExists(...)` in a pipeline works because that pipeline has
`$import: { ./pipeline-host.ts: [fileExists] }`, or because it declares
`fileExists(path): {}` under `$functions` and the application passes it. The
application cannot slip in a function the file does not name: every name a
formula calls is written in the file, so `validate` on text alone knows it.

## 3. Syntax

A scripted-yaml file is a YAML file. Four markers say what is not plain data.

| You write | It means | Example |
|---|---|---|
| `key:` | text or data; only `{{ }}` inside text is a formula | `title: Tests for {{ vars.BASE_BRANCH }}` |
| `key!:` | the value is a formula | `when!: prerequisites.local and vars.CI` |
| `key!name:` | the value is handed to the application's function `name` | `run!sh: npm test` |
| `$keyword:` | a word of the language, not your data | `$vars`, `$value`, `$if!`, `$extends`, `$schema` |

### 3.1 Text: `key:`

A key without a marker holds plain YAML. In its strings, `{{ … }}` holds one
formula; nothing else is computed.

```yaml
title: Tests for {{ vars.BASE_BRANCH }}
task: Turn the scenarios in review.md into a plan for {{ vars.EXPLORBOT_URL }} in plan.md
```

Text is read by the `feelers` package, the template language that goes with
`feelin`: FEEL inside `{{ }}`. scripted-yaml has no template parser of its own.

- A null result renders as nothing.
- A shell block keeps its own `${NAME}`: that is not template syntax.
- A value that starts with `{{` must be quoted, or YAML reads it as a map. For a value that is only a formula, write `key!:`.

Checked with `feelers` 3.2.0: the forms above, a formula containing `}`, and a
broken formula (an error). Not checked: how to write a literal `{{`.

### 3.2 Formulas: `key!:`

A key ending in `!` holds one formula. The key's name is the part before the `!`.

```yaml
when!: vars.TEST_COMMAND != null and vars.REMOTE = null
timeout!: if vars.CI then "30m" else "10m"
free_shipping!: cart.total >= 50 and not(cart.oversized)
```

**Formulas are written in FEEL**, the expression language of the DMN standard,
run by the `feelin` package. It is used as it is: scripted-yaml adds no syntax
and removes none. `docs/examples/` holds 138 examples, each executed by
`bun test` and compared with the result written beside it.

| Kind | FEEL |
|---|---|
| Equal, not equal | `vars.method = "GET"`, `role != "viewer"`: ONE equals sign |
| Text | `"double quotes"` only |
| Logic | `a and b`, `a or b`, `not(a)`: not is a function |
| Is set | `vars.NAME != null`: an unset or empty variable is null |
| Choice | `if a then b else c`; `else` is required; there is no ternary |
| One of, within | `role in ["admin", "owner"]`, `day between 24 and 27` |
| Pick items | `cart.items[price > 10]`, `cart.items[category = "books"].name` |
| Lists | `count(list)`, `sum(list)`, `min(list)`; positions start at 1 |
| Loops | `for item in list return item.price * item.qty`, `some item in list satisfies …`, `every …` |
| Text functions | `starts with(text, "a")`, `upper case(text)`, `string join(list, ", ")` |
| Calls | `fileExists("a.yml")`, an imported function (3.7); always with brackets |
| Named steps | `{ a: 1, b: a + 1 }.b` |

A formula may span lines and hold `//` comments. It is always one expression:
there is no assignment and no statement.

**What the library checks in a formula.** At validation, two things and no
more: the formula is valid FEEL, and every name it uses is defined (3.4). No
formula is evaluated during validation. When a formula is computed, any
warning from `feelin` is an error with the file and key, except reading a
field of null.

**What it does not check.** FEEL returns null where other languages fail,
sometimes with no warning: `==` instead of `=`, `x in list and y` without
brackets (read as `x in (list and y)`), `list[0]`, text used as yes/no. The
library does not report these. `docs/examples/5-traps.yml` shows each one
wrong and right, with the real result.

### 3.3 Marked keys: `key!name:`

A key ending in `!name` is not a formula. Its value is handed, as written, to
the function the application registered under `name`, and whatever that
function returns becomes the value of the key.

```yaml
run!sh: |
  npx -y @testomatio/reporter run --kind detect --warn \
    ${REMOTE:+--remote "$REMOTE"} ${TEST_COMMAND:+"$TEST_COMMAND"}
```

- **No marker is built in.** `sh`, `mdq`, `url`, `sql` are names an application chooses. scripted-yaml knows none of them and ships none.
- **The library never looks inside the value.** In the block above, `${REMOTE:+…}` is bash's and stays untouched.
- **The function decides when the work happens.** It may compute the value at once (read a section from a Markdown file) or return an object that the application runs later (a command). Section 7.3 shows both.
- A marker with no registered function is a validation error.

### 3.4 Names

A name in a formula is the path to what it names, spelled as in the file.

- `vars.REMOTE` is the variable declared under `$vars`.
- `prerequisites.local` is the value at `prerequisites:` → `local`. An item of a list is addressed by its `id` field: `stages.explore`.
- A bare name is looked up in this order: names the surrounding construct gives (`$as`, a function's parameters, the `with` names of a field); sibling keys; each enclosing map; the root; then functions (3.7).
- A name found nowhere is a validation error: "unknown name `origin`; for text, remove the `!`". Names a formula declares itself (loop variables, function parameters, keys inside `{ }`) are its own. Inside `[ ]` an unknown name is taken as a field of the item and is not reported.
- A key may not have the name of a function the file defines or imports. Otherwise a key added later would silently change what existing formulas mean. A key may have the name of a FEEL built-in (`sum`, `today`).
- `key` and `key!` in the same map are a validation error.
- A key that a formula refers to must be an identifier: `test_command`, not `test-command`.

### 3.5 `$value`: a node that is a value

A map with `$value` yields that value when referenced. Its other keys stay
reachable by path and are not part of the value.

```yaml
prerequisites:
  local:
    $value!: vars.REMOTE = null
    message: Tests run on the Testomat.io CI profile. No local log to read.

when!: prerequisites.local
```

`prerequisites.local` is the boolean; `prerequisites.local.message` is the text.

A longer rule is written the same way. The keys are definitions, not steps:

```yaml
discount:
  socks!: cart.items[category = "socks"]
  free!: sublist(sort(socks, function(a, b) a.price < b.price), 1, floor(count(socks) / 3))
  bundle!: sum(append(free.price, 0))
  loyalty!: if count(customer.orders) >= 10 then cart.subtotal * 0.05 else 0
  $value!: max(bundle, loyalty)
```

When a formula reads `discount`, it gets the `$value`: `max(bundle, loyalty)`.
The other keys are not part of that value; `discount.bundle` reaches one by path.

**Nothing is computed until something reads it.** The file is declarative:
it is never run from top to bottom. Reading `discount` asks for `$value`,
which asks for `bundle` and `loyalty`; `bundle` asks for `free`; `free` asks
for `socks`. Each key is computed when first read, and once.

- The order of keys in the file means nothing.
- A key that nothing reads is never computed.
- A key that reads itself, directly or through others, is a validation error.

Two limits, both from `feelin`:

- A formula's own references are all computed before the formula runs, including one in an `if` branch that is then not taken. `feelin` copies everything it is given at the start, so a value cannot be handed to it "on demand" (tried: it reads every entry at once).
- FEEL's own `{ a: …, b: … }.b` form is different: it is one formula, computed top to bottom inside `feelin`. Keys of the file are lazy; entries of that form are not.

### 3.6 `$vars`: the inputs of a file

`$vars` is optional. It declares what a file needs from outside, and a formula reads it as `vars.NAME`. An unset or empty variable is null. The `$` is on the declaration only: a FEEL name cannot contain `$`.

```yaml
$vars:
  BASE_BRANCH: { default: origin/main }
  TESTOMATIO:  { optional: true, secret: true, about: API key of the Testomat.io project. }
  amount:      { type: number }
  cart:        { type: Cart }
  '/[A-Z][A-Z0-9_]*/': { optional: true }
```

- `type` is text when omitted. Named types are the shapes of `$schema`.
- A variable is required unless it has `optional: true` or a `default`.
- `host: true` marks a variable the application sets itself, such as `STAGE_DIR`.
- A key between slashes is a regular expression over the whole name, for "any environment variable". A name matched only by a pattern is never reported as a typo.
- A DSL may declare variables every file of its kind may read (section 5). That is for checking and gives no value.
- A domain may bind its own syntax to variables. In a router, `:project` in a path is `vars.project`.

### 3.7 Functions and `$import`

Besides FEEL's built-ins, a formula may call a function the file defines,
one it declares for the application to pass, or one it imports.

**`$functions`** defines helpers in the file. The key is the name with its
parameters in brackets; the value is the formula. The library splits the key
at `(`, `,` and `)` and hands `feelin` the FEEL definition
`function(wanted) …`. The long form, `inCart!: function(wanted) …`, works too.

```yaml
$functions:
  inCart(wanted)!: cart.items[category = wanted]
  total(items)!: sum(items.price)
```

A parameter must not have the name of a field of the items it filters:
inside `[ ]` the item's own field wins (`docs/examples/5-traps.yml`).

**A function the application passes** is a key of `$functions` without the
`!`, as a variable is a key of `$vars`. Its value is a map with `about`, or
nothing. The application passes the function to `resolve` by name (7.4).

```yaml
$functions:
  fileCount(mask):
    about: How many files match the mask.
  crowded(mask)!: fileCount(mask) > 2

specs!: fileCount("*.spec.ts")
```

Such a function has the same rules as an imported one: it is not the name of
a FEEL built-in, of another function or of a key, and it is synchronous. A
declared function the application does not pass, or passes as something
other than a synchronous function, fails `resolve` before anything is
computed. `validate` checks only that the name is declared.

**`$import`** takes names from another file. The path is relative to the
file, and the importer is chosen by the file's extension.

```yaml
$import:
  ./pipeline-host.ts: [fileExists, glob]   # names the module exports
  ./settings.yml: settings                 # one name for the whole file
  ./book.md: book                          # one name for the whole file
```

| Extension | What the name is |
|---|---|
| `.ts`, `.js` | each listed name is an export of the module, usually a function |
| `.yml`, `.yaml` | the file's data: `settings.currency`. If it is a scripted-yaml file, it is loaded as one |
| `.md` | a function that queries the document with an `mdq-cli` selector and returns the Markdown it picks: `book("h1")` |
| anything else | a validation error |

These four are built in; an application does not register importers.

**Imported functions are synchronous.** `feelin` does not wait for a promise
(checked: an async function gives `{}`). The library enforces it in two
places: when a module is imported, an `async` function among the listed
names is an error; and when a formula is computed, a function that returns a
promise is an error naming the function. `validate` on text alone cannot see
this, because it does not open the module (7.2).

**Selectors in a formula.** A FEEL string uses double quotes, so a selector
inside one uses single quotes: `book("section('Characters') table")`.
`mdq-cli` 0.1.4 accepts only double quotes in selectors; single quotes are to
be added to it. Until then a regular-expression matcher works:
`book("section(/^Characters/) table")`.

### 3.8 `$tests`: examples the file must satisfy

A file may carry its own tests: variables in, expected values out.

```yaml
$tests:
  - { about: A regular customer gets the VIP code, vars: { customer: { orders: [1, 2], tags: [vip] }, cart: { subtotal: 120 } }, expect: { is_vip: true, discount_codes.VIP20.valid: true } }
```

A test is one line: the rules of a file are written out, one key per line, and
its tests are kept compact below them.

Each test resolves the file with its `vars` and compares the keys under
`expect` with the computed values, equal as FEEL's `=` says (a map in any key
order; a number is not its text). A key under `expect` is a path to a key of
the file, as problems name it, so an id with a dash is fine:
`stages.write-plan.when`. Any other key is a formula: `count(stages)`. `$tests` is not part of the file's data. `document.test()` runs them
and returns one result per test.
On the command line: `scripted-yaml test <file>...` prints `pass` or `FAIL` per test.

## 4. Structure keywords

These change the shape of the result, so the result depends on the values
given. They work in every file. A program that describes a file without values
sees such a node as conditional, with its formula.

**`$if!` and `$unless!`** decide whether a node exists.

```yaml
shipping:
  - name: Standard
    price: 4.90
  - name: Express
    price!: if is_vip then 0 else 12.90
    $if!: is_home and cart.weight <= 20
  - name: International
    price: 19.90
    $unless!: is_home
```

**`$when`** changes keys of the map it sits in. Every case that matches applies, in order; `$else` applies when none did.

```yaml
checkout:
  payment_methods: [card, paypal]
  $when:
    - $if!: cart.total > 1000
      payment_methods: [card, bank_transfer]
      note: Orders over 1000 need a card or a bank transfer.
    - $else:
      note: ''
```

**`$each!` with `$as`** repeats a list item once per value. `$as` names the value. `$if!` on the same item is checked per value.

```yaml
shipping:
  - $each!: warehouses[stock > 0]
    $as: warehouse
    name: Pickup in {{ warehouse.city }}
    price: 0
    $if!: warehouse.country = destination.country
```

They need values, so they are not applied when a file is loaded. They are
applied by `resolve` (7.4).

## 5. `$schema` and `$dsl`: which keys a file has

A schema is short by design: everything is text unless marked, and only what is listed is checked.

```yaml
$schema:
  required: [categories*:Category]
  optional: [agents]
  Category:
    required: [on:Trigger, title, about, icon, agents*]
    optional: [target:Target, fills*, filters*, rules*:Rule, launch]
  Rule:
    required: [key, title]
    optional: [query, ask]
  Trigger: [requirement, deploy, pull_request, schedule]
  Target: [issue, pr]
```

That is the whole schema for `agents.yml`, written at the top of that file.

| You write | It means |
|---|---|
| `title` | a field; text unless said otherwise |
| `agents*` | many: a list, or a map whose keys are the items' names |
| `launch:Look` | a field of a named shape |
| `rules*:Rule` | many of that shape |
| `Target: [issue, pr]` | a type that is a set of allowed words |

- A named type is a capitalised key beside `required` and `optional`: a map is a shape, a list is a set of allowed words.
- A missing `required` field, a word outside its type, or one value where many are marked is an **error**. A key that is not listed is a **warning**.
- Any field may be written `key!`.

A shape may carry three more entries when a family of files needs them:

| Entry | Meaning |
|---|---|
| `key: name` | the field that identifies an item, for paths and `$extends`, when it is not `id` |
| `with: { run: [command, path, line] }` | names the application supplies to a field when it computes it |
| `rules:` | checks across the fields of one item, each `valid!` with a `message` |

In a framework's run template, `{{ command }}` is the name the application
supplies through `with`, not the `command:` list beside it.

**In the file or shared.** A one-off file carries its own `$schema`. When
many files share one, it moves to a DSL file, together with the variables
every file of that kind may read. A file then starts with
`$dsl: ./pipeline.dsl.yml`; the DSL file itself carries no `$dsl` line.
See `examples/pipelines/pipeline.dsl.yml`.

A DSL is for checking only (section 2). It may say that `STAGE_DIR` exists,
but the value comes from the application, and a default belongs in the
file's own `$vars`. It does not list markers or functions: markers are
registered by the application, and functions are declared or imported by each file.

**Types.** TypeScript types are generated from a `$schema`, so the data an
application gets from `load` and `resolve` is typed. How they are generated
(a command, a build step) is not designed.

## 6. `$extends`: one file changes another

A file that starts with `$extends: ./base.yml` is a patch. It has the shape of its
base, and every change says what it does.

```yaml
$extends: ./web-testing.yml

prerequisites:
  $add:
    release:
      $value!: vars.GIT_BRANCH != null and starts with(vars.GIT_BRANCH, "release/")
      message: Not a release branch.

stages:
  $before:
    lint:
      title: Lint
      run!sh: npm run lint

  review:
    task:
      $after: Keep the list to the five most important scenarios.

  explore:
    $replace:
      timeout: 10m
      when!: base and prerequisites.release

  $remove: [results]

  $after:
    notify:
      title: Notify
      run!sh: curl -fsS "$SLACK_HOOK" -d "smoke check finished"
```

| Keyword | Where | Effect |
|---|---|---|
| `$replace` | in an item | overwrites the fields listed; each must exist |
| `$before` / `$after` | in a collection (`stages`) | new items at the start / end |
| `$before` / `$after` | in one item | new items directly in front of / behind it |
| `$before` / `$after` | in a text or list field, or text under a marked key named with its marker (`run!task:`) | text or values added at the start / end |
| `$add` | in a collection without order (`prerequisites`) | new entries; none may exist yet |
| `$remove` | in a collection | drops the named entries; each must exist |
| `base` | in a formula | the inherited value, like `super` |

- A key that matches nothing in the base is an error, never a new item.
- A plain field directly under an item is an error with a hint; only `$replace` overwrites.
- The position of a key in the patch means nothing. Order is said with `$before` and `$after`.
- The library can print the resolved file, with a note on each changed line naming the file that changed it.

**The merged form.** `document.merged()` gives a patch with its base applied,
as one file that needs no base: plain data, keys as written, nothing computed.
Where a formula or a `{{ }}` reads `base`, the entry it replaced is kept beside
it under `$base`, and a `$base` holds its own `$base` for a base of a base.
Reading a file puts each `$base` back, so the merged form loads and resolves as
the patch did, and can be patched again:

```yaml
stages:
  - id: explore
    when!: base and prerequisites.release
    $base:
      when!: prerequisites.staging
```

An application that holds the base itself, not in a file, passes it:
`loadTextSync(patch, { base })`, with `base` as text or data. The patch then
names no `$extends`.

**The top keywords of a patch.** `$vars`, `$functions`, `$import`, `$tests` and
`$schema` of a patch are merged into those of the base, entry by entry: an
entry with the same name takes the place of the base's. In `$schema`, the
`required` and `optional` lists of the patch are added to the base's lists, so
a patch can make a key of its own known. `$dsl` of a patch replaces the base's.

**Templates.** The package carries base files in `templates/`. A path that
starts with `scripted-yaml/` names one of them, not a file beside this one:

```yaml
$extends: scripted-yaml/state-machine

$schema:
  State: [draft, paid]

$replace:
  transitions:
    - from: draft
      on: pay
      to: paid
```

A template brings a schema and formulas and leaves empty the parts the file
fills with `$replace`. There are three: `state-machine`, `navigation-ui` and
`forms`; the comment at the top of each says what a file writes and what it
gets. A name that is not a template is an error that lists them.

Shared bases that are not patched item by item (`extends: _javascript`,
`common.yml`) keep the rule they have today: maps merge key by key, scalars
and lists replace.

## 7. The TypeScript API

The package exports `ScriptedYaml`, `Document`, `Problem`, `ValidationFailed`,
`ResolveFailed`, `Formula`, `Text`, `TestResult`, `Variable` and `HostFunction`.

### 7.1 Creating the library object

The application registers its markers. That is the only thing it registers:
functions come from each file's `$import`, or are passed to `resolve` when the
file declares them under `$functions`.

```ts
import { ScriptedYaml } from 'scripted-yaml';

const scripted = new ScriptedYaml({
  // one function per marker name; it receives the value as written
  markers: {
    sh: (source) => new ShellCommand(source),
  },
});
```

There are no other options. One file is one scripted-yaml document: what it
needs from outside, it names itself.

**`$dsl`, `$extends` and `$import` are built in.** The library loads those
files itself; the application writes no code for them. Each names a path,
relative to the file it is written in:

| In the file | What the library does |
|---|---|
| `$dsl: ./pipeline.dsl.yml` | reads and parses that file, checks this one against it |
| `$extends: ./web-testing.yml` | loads that file the same way, then applies this patch to it |
| `$import: { ./controllers.ts: [Users] }` | imports the module and takes the names |

A path that starts with `scripted-yaml/` names a template of the package (section 6).

A file reached this way goes through the same validation as the first one,
and a path that does not exist is a problem reported on the line that names it.

### 7.2 Validating: `validate` and `validateText`

Validation is its own call. It needs no values and runs no marker function and
no import; the only formulas it computes are schema rules over fields written out
(8 below). It takes text, so it works on a file from
disk, a form field or a database row, and it can run in a Cloudflare Worker.

```ts
const problems = scripted.validate('pipelines/web-testing.yml');                       // a file
const problems = scripted.validateText(text, { file: 'pipelines/web-testing.yml' });  // text that is not in a file

for (const problem of problems) console.log(problem.toString());
// pipelines/web-testing.yml:14  prerequisites.staging.$value!  unknown name "var"; did you mean "vars"?
// pipelines/web-testing.yml:31  stages.explore.run!bash        no function is registered for the marker "bash"
// pipelines/web-testing.yml:40  stages.results                 missing required field "title"
```

```ts
class Problem {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly key: string;                    // path of the key, as written
  readonly message: string;
  readonly severity: 'error' | 'warning';
}
```

All of it is synchronous. What it checks, in order:

1. the text is valid YAML with unique keys;
2. every `$` key is a known keyword, and `key` and `key!` do not both exist;
3. every marker has a registered name;
4. every formula and every `{{ }}` is valid FEEL;
5. every name in a formula is a key of the file, a declared variable, a FEEL built-in, or a function the file defines or imports;
6. the file fits its `$schema` or its `$dsl`;
7. every target of an `$extends` patch exists in the base;
8. every `rules:` entry of the schema holds, on each item where no field the rule reads is a `key!` formula, and the item has no `$when`. Text with `{{ }}` and a marked value are seen as written, as `resolve` sees a marked value. The other items are checked by `resolve`.

A field the schema does not list is a warning. With `new ScriptedYaml({ strict: true })`,
every warning is an error, and a file with one does not load.

Where only checking is needed (the hub, an editor), markers may be given by
name alone. Function names need nothing: they are in the file's `$import`.

```ts
const checker = new ScriptedYaml({ markers: ['sh'] });
```

**Where there is no disk.** The library reads every file through a `Files`
object. `scripted-yaml` reads the disk with `DiskFiles`. `scripted-yaml/core`
is the same library without Node: it imports no `node:` module, so it bundles
for a browser or a Cloudflare Worker, and it reads only the files it is given.

```ts
import { Files, MemoryFiles, ScriptedYaml } from 'scripted-yaml/core';

const scripted = new ScriptedYaml({ files: new MemoryFiles({ 'base.yml': text }) });

class Pipelines extends Files {
  // `path` as written, `from` the name of the file that writes it (undefined for the first file).
  read(path: string, from: string | undefined) {
    if (path in this.saved && from !== `saved:${path}`) return { file: `saved:${path}`, text: this.saved[path] };
    if (path in bundled) return { file: `bundled:${path}`, text: bundled[path] };
    throw new Error(`no pipeline "${path}" to extend`);   // reported on the line that names it
  }
}
```

`read` gives the file's text and the name it goes by. That name is in the
problems, it is the `from` of the paths it names in turn, and two files with
one name are one file when the library looks for a file that extends itself.
Undefined means there is no such file. A `.js` or `.ts` module of `$import`
comes from `files.module()`, which only `DiskFiles` has.

**What `validate` cannot check.** It runs no marker function, so it sees
nothing behind a marker: a shell command with a mistake, an mdq selector
that matches nothing, a `{{ }}` formula inside Markdown that a marker will
return. Those surface when the file is loaded, or when the application
runs what the marker produced. It reads imported files but does not load them,
so it does not know whether `./controllers.ts` really exports `Users`.

### 7.3 Loading: `load` and `loadText`

```ts
const document = await scripted.load('pipelines/web-testing.yml');                             // a file
const document = await scripted.loadText(text, { file: 'pipelines/web-testing.yml' });       // text, or data already parsed
```

Both validate first and throw `ValidationFailed`, carrying the `problems`,
when there is an error. `loadTextSync` does the same without a promise; only
importing a `.js` or `.ts` module takes one, so such an import is a problem
there. Then, once per file:

- `$extends` is applied;
- each `$import` is loaded;
- each marked key is passed to its function, and the result is stored.

**No formula is computed.** `document.data` holds the file as data, with the
markers removed from the key names:

| In the file | In `document.data` |
|---|---|
| `title: Review` | `"Review"` |
| `task: … {{ vars.URL }} …` | a `Text`: its source and the names it reads |
| `when!: prerequisites.staging` | a `Formula`: its source and the names it reads |
| `run!sh: npm test` | whatever the `sh` function returned |
| `$if!`, `$each!`, `$when` | kept as they are, with their formulas |

What a marker function returns is the application's choice. The same marker
can be eager in one application and lazy in another:

```ts
// lazy: keep the command, run it later
sh: (source) => new ShellCommand(source)
sh: (source) => ({ type: 'command', shell: source })

// eager: the value is known at load
mdq: (selector) => markdown.query(selector).text()
```

The library never changes what a marker function returned, also when it is a
string: a `{{ }}` inside it is not a formula and is left as written.

**A computed marker.** An application lists a marker under `computed` when
what is written under it is text or data like any other, and only the way it
is used is the application's: an agent's task, a question.

```ts
new ScriptedYaml({
  markers: { task: (text) => new Task(text) },
  computed: ['task'],
});
```

```yaml
- id: plan
  run!task: Write a test plan for {{ vars.URL }}
```

- `validate` checks its value as any value: a `{{ }}` that does not close, or a name that is not declared, is a problem, and the names it reads count.
- `load` calls the function with the value as `document.data` has it: `Text` for text with `{{ }}`, a `Formula` for a `key!:` inside it.
- `resolve` calls the function again, with the value computed, and puts what it returns in the result: `new Task("Write a test plan for https://staging")`. A value the application set on the marked key is not read.

Without `computed`, a marker gets its value as written, `{{ }}` and all: a
shell command may hold `${{ github.sha }}`.

A patch adds text to the text under a marked key as it does to plain text, when
it names the key with the same marker: `run!task: { $after: Be brief. }`.

### 7.4 Computing: all variables in, all values out

There is one call. The application passes every variable the file needs and
gets the whole file back as plain data, with every formula computed.

```ts
const result = document.resolve({ vars: process.env });

result.stages[0].when;        // true
result.stages[0].task;        // the text, with every {{ }} filled in
```

- **All variables.** `vars` is checked against the file's `$vars` first. A required variable that is missing is an error that lists all the missing ones, before anything is computed.
- **All declared functions.** `functions` holds, by name, each function the file declares under `$functions` without a formula: `document.resolve({ vars, functions: { fileCount } })`. One that is missing, not a function, or async is an error before anything is computed. `document.functions` lists them, with their parameters and `about`. `document.test({ functions })` passes them to every test, and an imported scripted-yaml file gets them too.
- **All values.** Every `key!` holds its value, every `{{ }}` is filled in, and `$if` / `$unless` / `$each` / `$when` are applied. The result contains no formulas.
- **One pass, by reference.** Formulas are computed in the order they refer to each other (3.5), each once.
- **Marked keys are unchanged unless a formula read them.** What a marker function returned at load is in the result as it is: a `ShellCommand` stays a `ShellCommand`. One that a formula read holds the value that was read (see below). A computed marker holds what its function returned for the computed value (7.3).
- **Keywords are not data.** `$vars`, `$functions`, `$import`, `$schema`, `$dsl`, `$extends` and `$tests` are in neither `document.data` nor the result. `$value` is the one `$` key that stays.

There is no call that computes a single key.

A file whose values change over time is resolved again with the new
variables. A pipeline runner that learns `STAGE_DIR` only when a stage starts
calls `resolve` then, with `STAGE_DIR` added.

**A marker's value is computed only when a formula needs it.** This is the
same rule as for keys (3.5): nothing is computed until something reads it.

```yaml
prerequisites:
  browser:
    $value!sh: ls ~/.cache/ms-playwright | grep -q chromium
  can_explore:
    $value!: prerequisites.staging and prerequisites.browser     # reads browser

stages:
  - id: explore
    when!: prerequisites.can_explore
    run!sh: npx explorbot test plan.md                           # nothing reads this
```

When a formula reads a value a marker function returned, the library gives a
boolean as it is, and a list or a map of plain data (an array, or an object made
as `{ }` is) as data, so a formula reads its fields. For anything else it calls
the value's `toString()` and gives the formula the text. Two texts have a
meaning of their own: `"1"` is true and `"0"` is false. Any other text stays
text.

```yaml
prerequisites:
  git:
    $value!extract: { sha: the commit under test }

stages:
  - id: report
    when!: prerequisites.git != null
    run!task: Report on {{ prerequisites.git.sha }}
```

The application finds the values and sets `{ sha: "4f2a…" }` on the marked
key; it leaves `null` when it found none, so `prerequisites.git.sha` is null
then and `prerequisites.git != null` is false.

The application may also give a marked key its value after loading, such as
when it ran the checks itself, with a promise: `document.marked` lists every
marked key (`path`, `marker`, `source`), and setting its `value` is what the
next `resolve` reads.

- `can_explore` reads `browser`, so `browser.toString()` is called. The application's `ShellCommand` runs the command there and returns `"1"` when it exits 0, `"0"` otherwise. The formula sees `true` or `false`, and so does the result.
- No formula reads `stages.explore.run`. `toString()` is not called, and the result holds the `ShellCommand` as it is.

```ts
class ShellCommand {
  constructor(readonly shell: string) {}

  /** Called by scripted-yaml only when a formula reads this value. */
  toString() {
    return Bun.spawnSync(['sh', '-c', this.shell]).exitCode === 0 ? '1' : '0';
  }
}
```

`toString()` cannot wait, so a value computed this way is computed
synchronously: `spawnSync`, not `spawn`.

### 7.5 What the library leaves to the application

These were rules of the language in the earlier draft. They are now things an
application builds from the pieces above:

- that `$value!sh` means "true when the command exits 0" (the `toString()` of its own class);
- that a shell block reads variables from the environment;
- what an mdq selector returns: text, rows, or an error when nothing matches;
- which message to show when a stage is skipped (`Formula.reads` gives the keys a condition depends on);
- a form built from `$vars`, and "this variable unlocks that stage".

## 8. Example: a pipeline

The file, shortened from `examples/pipelines/web-testing.yml`:

```yaml
$dsl: ./pipeline.dsl.yml
name: web-testing
target: pr

$vars:
  EXPLORBOT_VERSION: { default: latest }

prerequisites:
  staging:
    $value!: vars.EXPLORBOT_URL != null
    message: No staging URL. Set EXPLORBOT_URL to test in a browser.
  browser:
    $value!sh: ls "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}" | grep -q chromium
    message: No browser. Run npx playwright install --with-deps chromium.
  can_explore:
    $value!: prerequisites.staging and prerequisites.browser
    message: Browser testing needs a staging URL and a browser.

stages:
  - id: plan
    title: Test plan
    session: qa
    when!: prerequisites.staging
    task: Turn the scenarios in review.md into a test plan for {{ vars.EXPLORBOT_URL }} in plan.md.

  - id: explore
    title: Browser testing
    when!: prerequisites.can_explore
    run!sh: EXPLORBOT_OUTPUT="$STAGE_DIR/explorbot" npx explorbot test "$STAGE_DIR/plan.md" '*'
    timeout: 30m
```

A pipeline that calls a function imports it, as `examples/pipelines/regression.yml` does:

```yaml
$import:
  ./pipeline-host.ts: [fileExists]

prerequisites:
  coverage:
    $value!: fileExists("coverage.tests.yml")
    message: No coverage.tests.yml.
```

The application's side. Loading a pipeline executes nothing: `sh` only wraps
the text.

```ts
/** A shell command found in a pipeline. Kept, not run, until the runner decides. */
class ShellCommand {
  constructor(readonly shell: string) {}

  /** As a value in a formula: "1" when the command exits 0, else "0". */
  toString() {
    return Bun.spawnSync(['sh', '-c', this.shell]).exitCode === 0 ? '1' : '0';
  }
}

class Pipelines {
  private readonly scripted = new ScriptedYaml({
    markers: { sh: (source: string) => new ShellCommand(source) },
  });

  validate(name: string) {
    return this.scripted.validate(`pipelines/${name}.yml`);
  }

  load(name: string) {
    return this.scripted.load(`pipelines/${name}.yml`);     // its $dsl line is followed by the library
  }
}
```

After `load`, before any value exists:

```ts
const pipeline = await new Pipelines().load('web-testing');

pipeline.data.name;                               // "web-testing"
pipeline.data.stages[1].timeout;                  // "30m"
pipeline.data.stages[1].run;                      // ShellCommand { shell: 'EXPLORBOT_OUTPUT="$STAGE_DIR/explorbot" npx …' }
pipeline.data.stages[1].when.reads;               // ["prerequisites.can_explore"]
pipeline.data.prerequisites.browser.$value;       // ShellCommand { shell: 'ls "${PLAYWRIGHT_BROWSERS_PATH:-…' }
```

Running it is the runner's code. It passes all variables and gets all values:

```ts
class PipelineRun {
  constructor(
    private readonly pipeline: Document,
    private readonly shell: Shell,
    private readonly agent: Agent,
  ) {}

  async start() {
    const result = this.pipeline.resolve({ vars: process.env });

    for (const stage of result.stages) {
      if (stage.when === false) continue;
      if (stage.run instanceof ShellCommand) await this.shell.run(stage.run.shell);
      else await this.agent.send(stage.task);
    }
  }
}
```

In `result`, `stages[0].when` is `true` or `false`, `stages[0].task` is the
finished text, and `stages[1].run` is still the `ShellCommand` from `load`:
the runner executes it, the library never does. `can_explore` read
`prerequisites.browser`, so its `toString()` ran and
`prerequisites.browser.$value` is `true` or `false`.

A node with `$value` stays a map in the result, with `$value` computed and its
other keys beside it: `{ $value: true, message: "No browser. …" }`. A formula
that reads the node gets the value; the application reads `.$value`.

The hub checks a pipeline a user typed, with marker names only:

```ts
const checker = new ScriptedYaml({ markers: ['sh'] });
const problems = checker.validateText(request.body, { file: 'my-pipeline.yml' });
```

## 9. Example: Markdown with front matter

Long prompts read better as Markdown. This is a `.md` file that starts with a
YAML block between two `---` lines; the file is `examples/markdown/web-testing.md`.

```markdown
---
name: web-testing
target: pr
description!mdq: section1 paragraph[0]

$vars:
  EXPLORBOT_URL: { optional: true }

stages:
  - id: review
    title: Review
    session: qa
    task!mdq: section("Review")

  - id: plan
    title: Test plan
    session: qa
    when!: vars.EXPLORBOT_URL != null
    task!mdq: section("Test plan")
    checks!mdq: section("Test plan") item
---

# Web testing

Review a pull request, test the change in a browser, explain what broke.

## Review

Review this pull request as a QA engineer.
List the scenarios worth checking in a browser. /qa-review-pr

## Test plan

Turn the browser scenarios in review.md into an Explorbot test plan
for the staging site in plan.md. /explorbot-plan

- Cover the changed pages first.
- Skip anything behind a feature flag.
```

**scripted-yaml does not read this file.** It is Markdown, and a Markdown
parser reads it. `mdq-cli` already separates the YAML block at the top from
the Markdown below. The application hands the first to scripted-yaml, with
`mdq` registered as a marker over the second:

```ts
import { mdq } from 'mdq-cli';

const markdown = mdq(await readFile('examples/markdown/web-testing.md', 'utf8'));

const scripted = new ScriptedYaml({
  markers: { mdq: (selector) => markdown.query(selector).text() },
});

const pipeline = await scripted.loadText(markdown.frontmatter(), { file: 'web-testing.md' });
```

`markdown.frontmatter()` is the YAML block as data, already parsed by
`mdq-cli`, so `loadText` accepts data as well as text. Problems found in data
are reported by key, without a line number.

The value of a `!mdq` key is the Markdown its selector picks, as text.

What the application gets:

```ts
pipeline.data.description;
// "Review a pull request, test the change in a browser, explain what broke."

pipeline.data.stages[0].task;
// "## Review\n\nReview this pull request as a QA engineer.\nList the scenarios worth checking in a browser. /qa-review-pr\n\n"

pipeline.data.stages[1].checks;
// "- Cover the changed pages first.\n- Skip anything behind a feature flag."

const result = pipeline.resolve({ vars: { EXPLORBOT_URL: 'https://staging.example.com' } });

result.stages[1].when;      // true   (false when EXPLORBOT_URL is null)
result.stages[1].task;
// "## Test plan\n\nTurn the browser scenarios in review.md into an Explorbot test plan\nfor the staging site in plan.md. /explorbot-plan\n\n- Cover the changed pages first.\n- Skip anything behind a feature flag.\n"
```

The Markdown is returned as written. The library does not fill `{{ }}` in a
marker's result (7.3); values that depend on variables belong in the YAML,
like `when!` above.

Two things in that output come from `mdq-cli`, not from scripted-yaml:

- A `section` comes back with its heading line (`## Review`). To get the body alone, select what is inside it (`section("Review") paragraph`), or add a body selector to `mdq-cli`.
- A list comes back as Markdown text, not as a list of values. An application that wants rows of a table as data calls `.rows()` in its marker instead of `.text()`.

## 10. YAML pitfalls

All tested with the `yaml` package.

1. **A `!` value cannot start with a quote, a backtick, `[` or `{`.** FEEL text is in double quotes, so wrap the whole value in single quotes: `title!: '"Test " + vars.service'`. For a sentence with a variable, plain text with `{{ }}` is simpler.
2. **A value cannot start with `!`, `*` or `&`.** YAML reads them as a tag, an alias and an anchor, and silently drops `!x`. FEEL has no `!` anyway: write `not(x)`.
3. **`: ` and ` #` inside a value** need the whole value quoted. This is why there is no ternary.
4. **`{{ }}` at the start of a value, or inside a flow list,** is read by YAML as a map. Quote the value, or use a block list.
5. **A file with Markdown below a second `---` is not YAML.** It is a Markdown file; a Markdown parser reads it and hands the top block to scripted-yaml (section 9).
6. **`!if:` and `@if:` are not valid keys**, and `agents[]` is not valid inside a flow list. Hence `if!`, `$if` and `agents*`.

## 11. The implementation

`src/` implements this document. `bun test` runs the contract
(`test/scripted-yaml.test.ts`), edge cases, every file in `examples/` loaded
whole, five small applications built on the library (`test/parsers/`:
pipeline, router, markdown, ui, shop), the command line, and the built
package imported by name.

Where the code settles something this text left open:

- `$if!` and `$unless!` must give true or false, and `$each!` a list; null is an error.
- One formula cannot read a node's `$value` and a key beside it (`check` and `check.message`).
- A formula that reads a key and also declares a local of the same name does not get the key.
- An omitted `type` in `$vars` is not checked; `text`, `number`, `boolean` and `list` are checked when written; a named type is ignored.
- `rules:` of a schema are checked for syntax and names at validation. They are computed at validation on items whose fields hold no formula, and in `resolve` on the others.
- A list field takes a list: one value written alone is an error, not a list of one.
- An imported YAML file is loaded as scripted-yaml and resolved with the importing file's variables.
- Text added by a patch with `$before` / `$after` is joined with a new line.
- Markers given by name only can validate but not parse.
- To learn whether a name is a FEEL built-in, the library asks `feelin` by calling `name()`; `feelin` does not publish its list.

Not built:

- TypeScript types generated from `$schema`.
- The resolved file printed with a note on each line a patch changed (section 6).
- A way for the application to supply the `with:` names of a schema.
- Single quotes in `mdq` selectors: `mdq-cli` 0.1.4 rejects them; the regular-expression form works.

Not verified: the library inside a Cloudflare Worker, and `$import` of a
`.ts` file on a Node version without built-in TypeScript support (it was run
on Node 22.21 and on Bun).

## 12. Decisions and open questions

**Decided** (2026-11-20).

1. A function a formula calls comes only from FEEL, `$functions` or `$import`. The application passes only the functions a file declares under `$functions` (changed 2026-11-22; until then it passed none).
2. `$import` has built-in importers for `.ts`, `.js`, `.yml` / `.yaml` and `.md`, chosen by extension. Any other extension is an error.
3. Imported functions are synchronous, and the library enforces it.
   Validation of a formula is its syntax and whether its names are defined. Nothing else, and nothing is evaluated.
4. The library never changes a marker function's result, so `{{ }}` in Markdown returned by `!mdq` is not filled.
5. An unset or empty variable is null.
6. In a patch, the inherited value is `base`.
7. `$if!`, `$unless!` and `$each!` carry the `!`: they are formulas.
8. Variables are not converted. A formula sees the value the application passed.
9. `mdq-cli` will accept single quotes in selectors.
10. A file can carry tests (`$tests`, 3.8), and TypeScript types are generated from `$schema`.
11. **No parser of our own.** YAML is read by `yaml`, formulas by `feelin`, text with `{{ }}` by `feelers`, selectors by `mdq-cli`. The library only splits a key at its last `!`, and a schema word at `*` and `:`.
    Not needed: a limit on loops, telling old pipeline files from new ones, editor support.
12. One file is one scripted-yaml document. There is no `dsl` option and no `files` option; a DSL is named by the file's own `$dsl` line.
13. A marker's value is computed only when a formula reads it, by its `toString()`; `"1"` is true and `"0"` is false. Otherwise it stays as the marker function returned it (7.4). There is no `settle`.
    Front matter is read by a Markdown parser, not by scripted-yaml. There is no `rest`.

**Still open.**

14. **The prefix of `vars`.** Declared as `$vars`, read as `vars.NAME`, because FEEL rejects `$` in a name. Tested with `feelin`: `_vars` and `?vars` are accepted as names; `$`, `@`, `#`, `%`, `~`, `^`, `&` are not.
15. **What a `.md` import returns.** Written here as a function from a selector to Markdown text. Tables as rows would need a second form.
16. **The exact form of `$tests`** and how types are generated.
17. From the earlier draft, never confirmed: a variable is required unless optional or defaulted; a plain field in a patch is an error; an unlisted key in a schema is a warning; a key may not have the name of a function.
