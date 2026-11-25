# Built-in functions

Every function a formula can call without declaring it. A function that is not on this page is
one the file defines or declares under `$functions`, or imports with `$import` (SPEC.md, 3.7).

Two kinds are built in:

- **One-word functions** that scripted-yaml adds: `slug`, `snakecase`, `trim`. Prefer these.
- **FEEL's own functions**, which come with the `feelin` package. Many have names of two or more
  words, written with spaces: `starts with(a, b)`, `string join(list, ", ")`. The spaces are part
  of the name.

Where both exist, write the one-word form: `lowercase(a)`, not `lower case(a)`.

A call always has brackets. A function given a value of the wrong type gives null. A `$functions`
entry or an import may not take the name of a built-in.

Every row below is run by `bun test` and compared with the result beside it.

## Text: one word

Added by scripted-yaml. Each takes one text and gives null for anything that is not text. Prefer these.

| Call | Result |
|---|---|
| `trim("  Summer Sale ")` | `"Summer Sale"` |
| `lowercase("Summer Sale")` | `"summer sale"` |
| `uppercase("Summer Sale")` | `"SUMMER SALE"` |
| `capitalize("summer sale")` | `"Summer sale"` |
| `slug("Summer Sale: 50% off!")` | `"summer-sale-50-off"` |
| `snakecase("order lineItems")` | `"order_line_items"` |
| `kebabcase("order lineItems")` | `"order-line-items"` |
| `camelcase("order line_items")` | `"orderLineItems"` |
| `pascalcase("order line_items")` | `"OrderLineItems"` |
| `titlecase("order line_items")` | `"Order Line Items"` |

## Text: from FEEL

Positions start at 1. `replace` and `matches` take a regular expression: keep those out of a rule file when you can,
and pass a function from the application instead.

| Call | Result |
|---|---|
| `string(42)` | `"42"` |
| `string length("checkout")` | `8` |
| `substring("release/2.4", 9)` | `"2.4"` |
| `substring("release/2.4", 1, 7)` | `"release"` |
| `substring before("release/2.4", "/")` | `"release"` |
| `substring after("release/2.4", "/")` | `"2.4"` |
| `contains("staging.shop.io", "staging")` | `true` |
| `starts with("release/2.4", "release/")` | `true` |
| `ends with("README.md", ".md")` | `true` |
| `split("a,b,c", ",")` | `["a","b","c"]` |
| `string join(["a", "b", "c"], ", ")` | `"a, b, c"` |
| `replace("2024-01-05", "-", "/")` | `"2024/01/05"` |
| `matches("release/2.4", "^release/")` | `true` |
| `upper case("checkout")` | `"CHECKOUT"` |
| `lower case("CHECKOUT")` | `"checkout"` |

## Numbers

| Call | Result |
|---|---|
| `number("42") + 1` | `43` |
| `decimal(3.14159, 2)` | `3.14` |
| `floor(2.7)` | `2` |
| `ceiling(2.1)` | `3` |
| `abs(-5)` | `5` |
| `round up(2.341, 2)` | `2.35` |
| `round down(2.349, 2)` | `2.34` |
| `round half up(2.345, 2)` | `2.35` |
| `round half down(2.345, 2)` | `2.35` |
| `modulo(17, 5)` | `2` |
| `sqrt(16)` | `4` |
| `exp(0)` | `1` |
| `log(1)` | `0` |
| `odd(3)` | `true` |
| `even(3)` | `false` |

## Lists

Positions start at 1. `sum`, `min`, `max` and `mean` of an empty list are null.

| Call | Result |
|---|---|
| `count([10, 20, 30])` | `3` |
| `sum([10, 20, 30])` | `60` |
| `min([10, 20, 30])` | `10` |
| `max([10, 20, 30])` | `30` |
| `mean([10, 20, 30])` | `20` |
| `median([10, 20, 60])` | `20` |
| `mode([1, 2, 2, 3])` | `[2]` |
| `stddev([2, 4, 4, 6])` | `1.632993161855452` |
| `product([2, 3, 4])` | `24` |
| `all([true, false])` | `false` |
| `any([true, false])` | `true` |
| `list contains(["a", "b"], "b")` | `true` |
| `index of(["a", "b", "a"], "a")` | `[1,3]` |
| `sublist(["a", "b", "c", "d"], 2, 2)` | `["b","c"]` |
| `append(["a"], "b", "c")` | `["a","b","c"]` |
| `concatenate(["a"], ["b", "c"])` | `["a","b","c"]` |
| `insert before(["a", "c"], 2, "b")` | `["a","b","c"]` |
| `remove(["a", "b", "c"], 2)` | `["a","c"]` |
| `list replace(["a", "b", "c"], 2, "x")` | `["a","x","c"]` |
| `reverse(["a", "b", "c"])` | `["c","b","a"]` |
| `union(["a", "b"], ["b", "c"])` | `["a","b","c"]` |
| `distinct values(["a", "b", "a"])` | `["a","b"]` |
| `flatten([["a"], ["b", ["c"]]])` | `["a","b","c"]` |
| `sort([3, 1, 2], function(a, b) a < b)` | `[1,2,3]` |

## Maps

FEEL calls a map a context.

| Call | Result |
|---|---|
| `get value({ free: 0, team: 12 }, "team")` | `12` |
| `get entries({ free: 0, team: 12 })` | `[{"key":"free","value":0},{"key":"team","value":12}]` |
| `context([{ key: "a", value: 1 }, { key: "b", value: 2 }])` | `{"a":1,"b":2}` |
| `context put({ a: 1 }, "b", 2)` | `{"a":1,"b":2}` |
| `context merge([{ a: 1 }, { b: 2 }])` | `{"a":1,"b":2}` |

## Logic

`not` is a function. `is` compares two values of the same type.

| Call | Result |
|---|---|
| `not(true)` | `false` |
| `is(1, 1)` | `true` |

## Dates and times

`now()` and `today()` give the current moment and day. A date is shown here through `string`.

| Call | Result |
|---|---|
| `string(date("2026-11-25"))` | `"2026-11-25"` |
| `string(date(2026, 11, 25))` | `"2026-11-25"` |
| `string(time("14:30:00"))` | `"14:30:00"` |
| `string(date and time("2026-11-25T14:30:00"))` | `"2026-11-25T14:30:00"` |
| `string(date("2026-11-25") + duration("P5D"))` | `"2026-11-30"` |
| `string(duration("P1DT12H"))` | `"P1DT12H"` |
| `string(years and months duration(date("2025-01-01"), date("2026-03-01")))` | `"P1Y2M"` |
| `string(@"2026-11-25")` | `"2026-11-25"` |
| `date("2026-11-25").year` | `2026` |
| `day of week(date("2026-11-25"))` | `"Wednesday"` |
| `day of year(date("2026-11-25"))` | `329` |
| `month of year(date("2026-11-25"))` | `"November"` |
| `week of year(date("2026-11-25"))` | `48` |
| `today() >= date("2026-01-01")` | `true` |
| `now() != null` | `true` |

## Ranges

Each compares two ranges, or a point and a range. `[1..5]` holds both ends; `(1..5)` holds neither.

| Call | Result |
|---|---|
| `before(1, [2..5])` | `true` |
| `after(9, [2..5])` | `true` |
| `meets([1..3], [3..5])` | `true` |
| `met by([3..5], [1..3])` | `true` |
| `overlaps([1..4], [3..6])` | `true` |
| `includes([1..5], 3)` | `true` |

FEEL names eight more range functions that `feelin` does not implement: `overlaps before`,
`overlaps after`, `finishes`, `finished by`, `during`, `starts`, `started by` and `coincides`.
A formula that calls one is a validation error.

## Text shaping is not a business rule

A file holds what its owner changes: conditions, thresholds, tables, texts. How a title becomes a
slug is not one of those. Use a one-word function from the first table. For any other
transformation, do not build it from `replace` and regular expressions in the file: declare a
function under `$functions` without `!` and pass it from the application, or pass the finished
value as a variable.

```yaml
$functions:
  branchName(url):
    about: The branch name for an issue URL.

branch!: branchName(vars.ISSUE_URL)
```
