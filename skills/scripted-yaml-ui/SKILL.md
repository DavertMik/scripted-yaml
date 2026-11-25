---
name: scripted-yaml-ui
description: Use when asked to build, add or improve a UI, admin panel, editor or settings page where people review and edit scripted-yaml files (rules, pipelines, pricing, flags, menus, any `.yml` with `key!:` formulas, `$vars`, `$schema` or `$dsl`), in a standalone app or embedded in an existing one.
---

# An editor UI for scripted-yaml files

Build an admin UI where the owner of a rule finds it, reads it and changes it without reading
YAML. Rich, per-field controls first. Raw YAML is one switch away, never the default.

For the language itself (`key!:`, `$vars`, `$value`, `$if!`, `$each!`, `$when`, `$tests`, FEEL),
read the `scripted-yaml` skill first. This skill is about the screen.

**The core**, built first and finished before anything else: cards with a dimmed preview (§1),
stacks of files that share a `$dsl` (§1), the sidebar editor (§2), a control per field (§3),
draggable lists with `+` and `–` (§4), controls chosen by the schema (§5), highlighted formulas
(§6) and the switch to raw YAML (§2). Items marked *(later)* come after the core works.

## 0. Look at the application first

The framework, the components and the look are yours to choose, from what the project has.

| The project | Do |
|---|---|
| Has a UI (React, Vue, Svelte, Rails views, an admin kit) | Build inside it. Reuse its components, design tokens, fonts, icons, spacing and routing. The editor must look like a page of that app, not a product glued in. Add no second CSS framework. |
| Has no UI, or asks for a standalone tool | A small server that reads and writes the files, and one page. Pick a calm admin look: neutral surfaces, one accent colour, a system or Inter-like font, 14px base, 8px spacing grid, light and dark themes. |

**Validate on the server** with `ScriptedYaml` from `scripted-yaml` (it reads the disk, so `$dsl`,
`$extends` and `$import` paths resolve): `validateText(text, { file })` returns
`Problem { file, line, column, key, message, severity }`. In a browser, `scripted-yaml/core` finds
the DSL file only if you pass it the files: `new ScriptedYaml({ files: new MemoryFiles(...) })`.
Pass `markers: ['sh', …]` for the markers the files use.

**Keep the file as the owner wrote it.** Parse with the `yaml` package's `parseDocument` and never
rebuild the file from JSON. `doc.toString()` rewrites more than the edit (it wraps long lines,
drops column alignment, adds spaces inside `[ ]`), so:

- a changed **value**: replace only the text between the node's `range[0]` and `range[1]` in the
  original text (quote it with the `yaml` package if it needs quotes);
- a changed **list or map** (add, remove, reorder): replace only that collection's range with the
  collection re-serialised, `toString({ lineWidth: 0 })`, indented to where it starts.

Every other line of the file stays byte for byte.

## Guardrails: the editor writes source files

Saving changes files on disk, in the working tree of the project. That is the point in development
and a hazard anywhere else: a deployed server's files are overwritten by the next deploy, differ
between instances, and would let anyone with access change business rules unreviewed.

- **Embedded: edit only in local or dev mode.** Gate it on the app's own flag (`import.meta.env.DEV`,
  `NODE_ENV !== 'production'`, `Rails.env.development?`, `settings.DEBUG`), **on the server**:
  outside dev, the save and create routes are not registered at all (a request gets 404), not just
  hidden in the page. The page itself is then left out, or shown read-only with the form disabled and
  a note: "Read-only. Edit these files in a local checkout." Never decide it from the request.
- **Local only.** The write routes refuse requests not from the loopback address; a standalone
  server listens on `127.0.0.1` unless told otherwise.
- **Inside the folder only.** Resolve each path and refuse it unless it is under the configured
  rules folder and ends in `.yml`, `.yaml` or `.md`.
- **Never overwrite a newer file.** Load with the file's hash or mtime; if the file changed on disk
  since (an editor, `git pull`), refuse to save and offer to reload it.

**Tell the user that the UI edits local files.** Never let a save be a surprise:

- A permanent strip at the top of the library and the sidebar: "Local editing · saves write to
  `<folder>` on disk", with the real folder path. In read-only mode it says so instead.
- The button says **Save to file**, with the file path beside it or in its tooltip.
- The first save of a session confirms once: "This writes `rules/shop.yml` in your working tree.
  Review it with `git diff` and commit to keep it." with "Don't ask again this session".
- After saving: "Saved to `rules/shop.yml`", naming the file, not just "Saved".

## 1. The library: every file is a card

```
┌ Rules ─────────────────────────── [search…] [+ New] ┐
│ ╔═ pipeline.dsl.yml · 4 files ═╗  ┌ shop.yml ──────┐ │
│ ║ web-testing          ● ok    ║  │ Shop rules  ⚠1 │ │
│ ║ $vars:                       ║  │ $vars:         │ │
│ ║   BRANCH: …   (dimmed)       ║  │   cart: {}     │ │
│ ╚══════════════════════════════╝╗ │ is_vip!: count…│ │
│  ╚═════════════════════════════╝ └────────────────┘ │
└─────────────────────────────────────────────────────┘
```

- **One card per file.** Title: the file's `name` or `title` key, else the file name. Under it: the
  file name, the DSL, counts that matter (stages, variables, tests) and a status dot from
  `validateText` (ok, warnings, errors).
- **A dimmed preview of the YAML** fills the card body: the first 8–12 lines, monospace, 11–12px,
  highlighted but at 45–60% opacity, fading out at the bottom. It tells the reader what kind of
  file it is before opening it. Not selectable, not editable.
- **Files with the same `$dsl` form a stack**: one card with two or three offset edges behind it
  and a count. Clicking the stack opens it in place (cards fan out in a row, or the group expands
  under a header) and a second click on the header folds it back. Files with an inline `$schema`
  or none stand alone. A file that `$extends` another shows a small "patch of web-testing" label.
- Cards are buttons: the whole card is clickable, has a focus ring, opens with Enter. Hover lifts
  it slightly. The selected card keeps a visible accent border.
- Search filters by name, key and text. Sort by name or by last changed. Empty state says where
  the files are expected and how to add one.

## 2. The editor: a sidebar for the selected card

Selecting a card opens a right sidebar (a drawer over the grid on narrow screens), 480–720px,
resizable, closable with Esc. The grid stays visible so the next file is one click away.

Sidebar, top to bottom:

1. **Header**: title, file path, status, a `Form | YAML` segmented switch, Save and Discard.
   Save is disabled while nothing changed. Unsaved changes show a dot on the card and on Save.
2. **Problems bar**: one row per problem from `validateText`, rerun on each change (debounced
   ~300ms). Clicking a row scrolls to the field and focuses it; the field shows the same message
   under itself in the error colour. A file with errors can still be saved only after a confirm.
3. **The form**: the file decomposed into blocks (next section). Sections for the top-level
   keys, collapsible, with `$vars` first and `$tests` last.

**YAML mode** is the whole file in a code editor (CodeMirror 6 with the YAML language), with the
same problems shown as gutter marks. Switching keeps the text: form → YAML shows the current
text; YAML → form parses it and, if it does not parse, stays in YAML mode and says why.

## 3. Decompose the file into blocks

Walk the `parseDocument` tree. Each node becomes one block; each block edits its own node in the
document, so a change to one field touches only that field's lines.

| YAML | Block |
|---|---|
| text | text input; a textarea when it has a newline or is over ~80 characters |
| text with `{{ }}` | textarea that highlights each `{{ formula }}` as a FEEL chip |
| number, boolean | number input; a switch |
| one of a set (`Role: [reviewer, tester]` in the schema) | select, or segmented buttons for 2–4 words |
| `key!:` formula | one-line code input with FEEL highlighting and an `ƒ` badge; grows to multi-line |
| `key!sh:` (any marker) | code editor in the marker's language (`sh` → shell), badge with the marker name |
| map | a titled group of its fields, collapsible |
| map with `$value` | the `$value` formula as the group's headline, its other fields below |
| list | draggable blocks (next section) |
| list of words (`tools: [git, gh]`) | tag input: type and Enter adds, × removes, drag reorders |
| `$vars` | a table: name, required / optional / default, `about`, `secret` as an icon toggle |
| `$functions` | rows of signature `name(a, b)` and formula |
| `$tests` | a table: about, vars, expect; *(later)* a Run button that calls `test` and marks each row pass or fail |
| `$import`, `$dsl`, `$extends` | read-only chips with the path, link to the other file's card |
| anything not recognised | a small YAML editor for that node only. Never drop a key. |

Every block shows its key as a label in plain words (`free_shipping_from` → "Free shipping from"),
the real key in monospace beside it, and `about:` from the schema or `$vars` as help text.
A formula and a plain value of the same key are different things: a "make it a formula" action on
a plain field adds the `!`, and the opposite removes it, after a confirm if the value is not
plain data.

## 4. Lists are draggable blocks

```
⋮⋮ ▸ plan      Plan for {{ vars.BRANCH }}     if prerequisites.staging   [–]
⋮⋮ ▾ explore   Browser testing                                           [–]
     title  [Browser testing          ]
     when ƒ [stages.plan.when and prerequisites.browser]
     run sh [npx explorbot test plan.md]
                         [+ Add stage]
```

- Each item is a card with a drag handle, a one-line summary when collapsed (its `id` or `key`
  field, its `title` or `name`, its `$if!` / `$unless!` / `$each!` as small condition chips), and
  `–` to remove it (undoable, or with a confirm).
- `+` under the list adds an item; `+` between two items (shown on hover) adds one there. A new
  item gets the required fields of its schema shape, empty, and is opened for editing.
- Drag to reorder with a visible drop line; Alt+↑ / Alt+↓ move the focused item for keyboards.
  Use the project's drag library, else `@dnd-kit` (React), `SortableJS` or native drag and drop.
- An item with `$each!` shows "repeats for each `city` in `vars.cities`" in its summary.
- `$when` is a list of cases: each case a block with its `$if!` as the header, `$else` last.

## 5. Let the schema or DSL drive the controls

Read the `$schema` of the file, or of the file its `$dsl` names (parse that file too):

- `required` fields are always shown, marked, and cannot be removed; `optional` fields not in the
  file are offered in an "Add field" menu of the block, not shown empty.
- `field:Type` with a shape → nested block of that shape; with a list of words → select.
- `field*` → a list of blocks; `key:` names the field used as the item's title.
- `rules` (`valid!` + `message`) are checked by `validateText`; show the message on the item.
- A DSL's `$vars` (e.g. `/[A-Z][A-Z0-9_]*/`) give the suggestions in the variable picker.

Without a schema, infer from the data: the type of each value, and for a list the union of the
fields its items have. Never invent fields the file and the schema do not have.

## 6. Formulas: highlight and help

Use CodeMirror 6 for every code input (small single-line instances in the form, one full one in
YAML mode). FEEL has no ready grammar: write a small `StreamLanguage` (keywords `if then else for
in return some every satisfies and or not between instance of`, strings in `"`, numbers, `null`
`true` `false`, names, `[` `]` filters), or start from the Ruby legacy mode, which colours FEEL
closely enough. Shell markers use the shell mode, YAML mode the YAML language.

- *(later)* Autocomplete names a formula can read: `vars.*` from `$vars`, sibling and top-level keys, list
  items by `id`, `$functions`, imported names, and built-ins.
- Show the problem from `validateText` under the input ("unknown name "prise"; did you mean
  "price"?").
- *(later)* A "preview" that computes the file with sample variables (`load` then `resolve`) and
  shows each formula's value beside it. Mark null results: they usually mean a mistake.

## 7. UX rules

- **Edit in place, save explicitly.** No autosave of rule files: they change behaviour. Save
  writes only the changed lines (§0). *(later)* Show a diff of the YAML text before saving.
- *(later)* **Undo / redo** (Ctrl+Z / Ctrl+Shift+Z) over form and YAML edits alike.
- **Warn before leaving** a file with unsaved changes (closing the sidebar, picking another card).
- **Hierarchy**: labels 12–13px muted, values 14px; one accent colour for actions and selection;
  red only for errors, amber for warnings. Formulas and markers look like code; data does not.
- **Density**: an admin UI is read often. Collapsed list items, 32–36px controls, no giant cards.
- **Accessibility**: every control has a label; focus is visible; drag has a keyboard path; status
  is never colour alone (icon + text); contrast at least 4.5:1, including the dimmed preview text
  against its card when hovered.
- **Copy**: buttons say what they do (`Add stage`, not `Add`); use the schema's names for things.

## 8. Check it before you hand it over

1. Open each card in the project; every key of each file appears in the form, none is lost.
2. Edit one field, save, and `git diff`: only that line changed, comments and alignment kept.
3. Reorder, add and remove list items; only that list's lines change, block style, one key per line.
4. Break a formula: the problem shows under the field and in the problems bar, Save asks.
4a. Guardrails: the "Local editing" strip shows the folder; in a production build or mode the
   save route answers 404 to `curl`; a request from another host is refused; a path outside the
   folder is refused; a file changed on disk after loading is not overwritten.
5. Switch Form ↔ YAML with unsaved changes both ways; nothing lost.
6. Run `scripted-yaml validate` on the saved files: `ok`.
7. Take a screenshot of the library and of the open sidebar, light and dark, and look at them.
