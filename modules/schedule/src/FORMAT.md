# Planner - Projects: the plan file (JSON)

Export writes this file; Import reads it. A person or an AI can write one by hand. The file is read whole and checked before
anything is written; if the first problem is found, Import says it in one sentence and writes nothing.

## The file

```
{ "format": "project-plan", "version": 1, "exportedAt": "<time>", "module": "schedule", "entries": [ <entry>, ... ] }
```

- `format` must be `"project-plan"`. `version` must be `1`. `entries` is a list of 1 to 500 entries.
- `boards` is an optional list of at most 1 board (see "The board" below).
- `fields` is an optional list of at most 8 fields, each with up to 30 choices (see "The fields" below).
- `exportedAt` and `module` are written by Export and are not needed when you write a file.
- A file is at most 1 MB. A plan holds at most 1000 entries, so Add refuses a file that would go past that.
- Fields that are not listed here are ignored.

## An entry

| Field | Needed | Value |
| --- | --- | --- |
| `kind` | yes | `"milestone"`, `"work"` or `"note"` |
| `title` | yes | text, up to 120 characters |
| `id` | no | 1 to 64 letters, digits, `-` or `_`; each one used once. Give one only when another entry names this one. |
| `start` | milestone and work | a day written `YYYY-MM-DD`, from 1900 to 2200. A milestone's day; work's first day. |
| `end` | work | a day, not before `start`. Work with only one of the two takes it for both. |
| `parent` | no | the `id` of a milestone in the file this entry sits under |
| `waitsOn` | no | a list (up to 50) of `id`s of milestones or work in the file that this one waits on; no loops |
| `done` | no | `true` or `false` (milestone and work). A milestone is done when every entry under it is. |
| `ticked` | no | `true`: a milestone ticked done by hand |
| `column` | work | the id of the work's column on the board: lower case letters, digits and `-`. Notes and milestones have none. Work with no column, or one the board does not have, sits in the first done column if it is `done`, else in the first column that does not count as done. |
| `notes` | no | text, up to 2000 characters |
| `phase` | no | a phase id of the template: lower case letters, digits and `-` |
| `tags` | no | a list (up to 50) of tag ids from the plan's Tags setting |
| `owners` | no | a list (up to 50) of people's keys. Leave it out unless the file was exported from this environment. |
| `fields` | work | the work's choice in each field, written `{ "area": "core", "phase": "first" }`: the field's id, then the id of one of its choices. The field must be in the plan or in the file's `fields`. An empty text means no choice. Notes and milestones have none. |
| `doneOn` | work | the day the work became done, `YYYY-MM-DD`, as Export writes it. Kept only while the work is done; the burndown's Done line counts from it. Leave it out when you write a file. |
| `order`, `rank`, `by`, `ref`, `source`, `progress` | no | what Export writes so a file can be put back as it was. Leave them out when you write a file. |

A note has no dates, no `waitsOn` and no `done`. A milestone has no `end`. When the plan's setting "Dates are needed" is on,
every milestone needs `start` and all work needs `start` and `end`.

## The board

```
"boards": [ { "id": "main", "name": "Board", "field": "column", "columns": [ { "id": "todo", "label": "To do" }, { "id": "done", "label": "Done", "done": true } ] } ]
```

- `id` and each column's `id`: lower case letters, digits and `-`, starting with a letter, up to 41 characters; each used once. `field` is `"column"`.
- 2 to 12 columns, each with a `label` of up to 40 characters. `done: true` marks a column whose work counts as done. At least one column
  counts as done and at least one does not.
- `rowsBy` is `"milestone"`, `"owners"`, `"field:"` and a field's id (a row for each choice of that field), or left out.
- Work with a `column` the board has takes that column's `done`. A file with no `boards` leaves the plan's board as it is.

## The fields

```
"fields": [ { "id": "phase", "label": "Phase", "options": [ { "id": "first", "label": "First" }, { "id": "second", "label": "Second" } ] } ]
```

- A field is a short list of choices, such as Area, Release status or Phase. Work holds one choice from each field (the entry's `fields`).
  They are the plan's own: a plan that follows an issue service never sends them to it.
- `id` and each choice's `id`: lower case letters, digits and `-`, starting with a letter, up to 41 characters; each used once in its list.
  `label`: up to 40 characters. At most 8 fields and 30 choices in a field. A field's place in the list is its place in the plan.
- A size field is one whose `size` is `true`: its choices carry a `value`, a whole number from 0 to 999, and a piece of work is sized at the value
  of its choice (none counts 0). A plan has one size field; a second is refused with "A plan has one size field." A size is the plan's own and is
  never sent to an issue service. The setting **Sizing** stands for one (points 1, 2, 3, 5, 8, 13 or T-shirt sizes XS to XL worth 1, 2, 3, 5, 8) until the plan stores its own.
- A file's fields are added to the plan's by id. A field the plan already has keeps its words and gains the choices it lacks.
- Defining fields needs the right to change the board's columns and fields. A file with `fields` is refused for someone without it.

## Check a file before you import it

- **Offline, any JSON Schema validator** (draft 2020-12): check the file against `project-plan.schema.json`, beside this file. It checks the
  types, the allowed words, the lengths, the day pattern and the limits above.
- **In the page:** the Export and import menu has **Check file**. It reads a file the way Import does and writes nothing. It says
  "This file is good" with what it would add, or lists the problems (the first and up to five more, one for each entry), so a file
  can be fixed in one round.

The schema cannot say these; only Check file and Import do:
- a day is a real day (`2026-02-30` is not) from 1900 to 2200; the pattern only checks `YYYY-MM-DD`
- work's `end` is not before its `start`
- each `id` is used once; every `parent` and `waitsOn` names an `id` in the file; nothing is part of itself or waits on itself, and
  there are no loops
- a `parent` is a milestone; `waitsOn` names milestones or work, not notes
- when the plan's setting "Dates are needed" is on, a milestone has a `start` and work has a `start` and an `end`
- text lengths count after trimming spaces

## Add and Replace

- **Add to the plan** gives every entry a new id and puts the entries after what is there. `parent` and `waitsOn` follow.
- **Update by id** (see above) changes only what the file carries on the entries it names.
- **Replace the plan** (needs the right to clear the plan) takes everything out and puts the file's entries in, keeping their
  ids and order. Undo is offered for 30 seconds, as it is for Clear.
- Entries come in the order the file lists them; a `parent` may come before or after its children.

## A complete example

```json
{
  "format": "project-plan",
  "version": 1,
  "entries": [
    { "id": "m1", "kind": "milestone", "title": "Kickoff", "start": "2026-03-02", "notes": "Everyone in one call." },
    { "id": "w1", "kind": "work", "title": "Write the brief", "start": "2026-03-02", "end": "2026-03-06", "parent": "m1" },
    { "id": "w2", "kind": "work", "title": "Choose the venue", "start": "2026-03-04", "end": "2026-03-13", "parent": "m1", "done": true },
    { "id": "m2", "kind": "milestone", "title": "Design approved", "start": "2026-04-03", "waitsOn": ["m1"] },
    { "id": "w3", "kind": "work", "title": "Draw the plans", "start": "2026-03-16", "end": "2026-04-02", "parent": "m2", "waitsOn": ["w1", "w2"] },
    { "id": "m3", "kind": "milestone", "title": "Launch", "start": "2026-06-01", "waitsOn": ["m2"] },
    { "id": "w4", "kind": "work", "title": "Build it", "start": "2026-04-06", "end": "2026-05-29", "parent": "m3", "waitsOn": ["w3"] },
    { "kind": "note", "title": "Ask about the budget before the design is approved." }
  ]
}
```

## Update by id

A third way to bring a file in, beside Add and Replace. It changes entries that are already in the plan, by `id`, and sets only what the
space owns: `fields`, `start`, `end`, `owners` and `rank`. It never changes a title, a column, a note or anything a followed service owns:
a file whose entry names one of those is refused. It is for filling in fields and days in bulk, in a plan that follows GitHub or not.

```
{
  "format": "project-plan",
  "version": 1,
  "fields": [ { "id": "phase", "label": "Phase", "options": [ { "id": "first", "label": "First" } ] } ],
  "entries": [
    { "id": "gh-12", "fields": { "phase": "first" }, "start": "2026-12-01", "end": "2026-12-15" },
    { "id": "gh-15", "fields": { "phase": "first" } }
  ]
}
```

- Each entry needs an `id`, the id of an entry in the plan (a followed issue is `gh-` and its number). An id the plan does not have is skipped.
- `fields` sets those fields' choices and leaves the work's other fields as they are; an empty text clears one. `start` and `end` are days; an
  empty or missing one changes nothing. `owners` replaces who is doing it. `rank` is the order in its column.
- It needs the right to edit. Undo is offered for 30 seconds. **Check file** reads such a file too, and says how many entries it would change.
