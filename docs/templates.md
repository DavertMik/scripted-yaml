# Templates

A template is a base file that comes with the package. Your file builds on one with
`$extends: scripted-yaml/<name>` and writes only its own part: the template brings the schema and
the formulas.

```
$ scripted-yaml templates
scripted-yaml/forms             Forms: fields with types, labels and tooltips, tabs, and the errors for the values entered.
scripted-yaml/navigation-ui     Navigation: a menu with dropdowns, and from it the current page, the breadcrumbs and the sitemap.
scripted-yaml/state-machine     A state machine: states, guarded transitions, effects. The application keeps the state and runs the effects.
```

Each template is one YAML file in [`templates/`](../templates), written in the same language as
your files. Read it: the comment at its top says what to write, and the formulas below are all
there is to it.

## How a file uses a template

A file that starts with `$extends` is a patch of its base (SPEC.md, section 6). With a template,
three parts matter:

| In your file | What it does |
|---|---|
| `$replace:` | fills the parts the template leaves empty: `transitions`, `menu`, `fields` |
| `$schema:` | is merged into the template's: a type of yours (`State: [...]`) takes the place of the template's, and your `optional: [...]` adds fields |
| `$vars:` | adds the variables your conditions read, and gives defaults |

A key of your own goes under `$add`, and into `optional` of `$schema` so it is known:

```yaml
$extends: scripted-yaml/state-machine

$schema:
  State: [on, off]
  optional: [flips]

$replace:
  transitions:
    - { from: on, on: flip, to: off }
    - { from: off, on: flip, to: on }

$add:
  flips!: count(transitions)
```

A formula of the template is changed the same way as a field: `$replace: { error!: … }`.

## `scripted-yaml/state-machine`

The application keeps the current state, passes it in with the event, stores `next` and runs the
effects. Example: [`examples/order-states.yml`](../examples/order-states.yml).

| You write | |
|---|---|
| `$schema: { State: [...] }` | the states; a transition from or to any other is a validation error |
| `$vars: { state: { default: … } }` | the first state, and whatever your guards read |
| `transitions` | rows of `from`, `on`, `to`; `$if!` on a row is its guard |
| `effects` | rows with a `name` and usually a marked `run!js:`; `$if!` says when, with `changed` and `next` |

| You pass | |
|---|---|
| `state` | the state now |
| `event` | what happened; without it the file only tells what may happen |

| You get | |
|---|---|
| `allowed` | the events the state takes now, guards applied |
| `changed` | whether the event moves the machine |
| `next` | the state after the event; the same state when it is refused |
| `final` | no transition leaves `next` |
| `error` | `"Cannot pay from draft"` when the event is refused, else null |
| `effects` | the effects whose `$if!` held |

Limits: a state passed in that is not in `State` is not an error, it gives `allowed: []`. When two
rows match the same state and event, the first wins. An effect's `$if!` reads `next`, so it fires on
entering a state; to tie it to one transition, add `match[1].on = "cancel"`.

## `scripted-yaml/navigation-ui`

One menu, and from it everything a site derives from a menu. Example:
[`examples/menu.yml`](../examples/menu.yml).

| You write | |
|---|---|
| `menu` | items with a `label`, and a `path` (a page), a `url` (a link out) or `items` (a dropdown) |
| on an item | `icon`, `badge`, `about`; `$if!` shows it to some; `$each!` repeats it |

| You pass | |
|---|---|
| `path` | the page the user is on; `/` when omitted |

| You get | |
|---|---|
| `menu` | the menu as written, hidden items dropped |
| `pages` | every item with a path, dropdowns opened: `{ label, path }` |
| `active` | the labels to highlight, from the top item down to the current page |
| `current` | the label of the current page, or null |
| `breadcrumbs` | `{ label, path }` along `active`; the path is null for a dropdown that is no page |
| `sitemap` | the paths of `pages` |

Limits: `path` is matched exactly, so `/products/phones/42` is no page of the menu. Items below the
third level are not found.

## `scripted-yaml/forms`

The fields of a form, and the errors for what the user entered. Example:
[`examples/signup.yml`](../examples/signup.yml).

| You write | |
|---|---|
| `title`, `submit` | the heading and the button |
| `tabs` | rows of `id` and `label`; leave out for a form of one page |
| `fields` | rows of `name` and `type`, with `label`, `tooltip`, `placeholder`, `tab`, `default` |
| checks on a field | `required`, `min`, `max` (the number, or the length of a text), `pattern`, `options` |
| `$if!` on a field | shows it to some: `$if!: value("plan") = "team"` |
| `rules` | checks across fields: rows of `field` and `message`; the row is an error when its `$if!` is true |

The types are `text`, `email`, `number`, `password`, `textarea`, `select`, `radio`, `checkbox`,
`date`, `file` and `hidden`. For others, give your own list: `$schema: { FieldType: [text, color] }`.

| You pass | |
|---|---|
| `values` | what the user entered, by field name; none at all draws the empty form |

| You get | |
|---|---|
| `fields`, `tabs` | as written, hidden fields dropped |
| `errors` | `{ field, tab, message }`, one per field at most, then the rules that failed |
| `valid` | there are no errors |
| `steps` | per tab: `id`, `label`, the names of its `fields`, the count of its `errors` |

Read an entered value with `value("plan")`, not `vars.values.plan`: the first is null while the
field is empty, the second fails. A number may arrive as text (`"42"`), as a form sends it; what is
not a number gives "is not a number". A rule that compares values of different kinds (a text with
a number) fails when computed: compare like with like.

## A template of your own

A template is an ordinary file, so a project can keep its own beside its files and extend it by
path: `$extends: ./templates/wizard.yml`. Write it as the bundled ones are written:

- a `$schema` that names the shapes, with an empty list for each type the file must give (`State: []`);
- empty values for the parts the file fills (`transitions: []`), so the file fills them with `$replace`;
- formulas that read those parts; helpers go in `$functions`, so they do not show in the result;
- no `$tests`: they would run in every file that extends it.

In formulas over items that may lack a field, read it with `get value(item, "path")`, which gives
null; `item.path` fails on an item without one.
