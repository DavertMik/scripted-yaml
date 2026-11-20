# Formula examples

Formulas (`key!:` values and `{{ }}` in text) are written in **FEEL**, the expression
language of the DMN standard, run by the [`feelin`](https://github.com/nikku/feelin) package.
We did not design this syntax and do not extend it.

Every example in this folder is executed by `bun test` and compared with the result
written beside it, so the examples cannot drift from what the language does.

| File | What it shows |
|---|---|
| `data.yml` | the data all examples run against, and the host functions |
| `1-basics.yml` | comparing, `and` / `or` / `not()`, "is set", `if then else`, numbers |
| `2-text.yml` | text: joining, searching, cutting, patterns |
| `3-lists.yml` | picking items, counting, sums, loops, `some` / `every`, sorting |
| `4-steps.yml` | formulas over several lines, comments, named steps |
| `5-traps.yml` | mistakes shown wrong and right |
| `6-domains.yml` | the formulas of the pipelines, shop and router examples |

## The dialect in ten lines

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

## Rules that prevent the silent mistakes

FEEL returns `null` instead of failing in several cases. These rules avoid them:

1. **Brackets around `x in list` when anything follows it.** `a in list and b` is read as
   `a in (list and b)`. Write `(a in list) and b`, or put the `in` test last.
2. **No truthiness.** Text and numbers are not yes/no. Write `vars.NAME != null`.
3. **A filter in `[ ]` must be a comparison.** `[on_sale = false]`, not `[not(on_sale)]`;
   `[glob(item, "src/**") = true]`, not `[glob(item, "src/**")]`.
4. **Do not name a function parameter like a field of the items it filters.**
5. **`sum` of an empty list is null.** `count` of an empty list is 0.
6. **Turn numbers into text before joining:** `"Total: " + string(n)`.

## In YAML

A formula that starts with a double quote, `[` or `{`, or that contains `: `, must be
wrapped in single quotes:

```yaml
title!: '"Test " + capitalize(vars.service)'
```

Longer formulas go in a block:

```yaml
discount!: |
  if cart.subtotal > 1000 then 15
  else if cart.subtotal > 100 then 10
  else 0
```
