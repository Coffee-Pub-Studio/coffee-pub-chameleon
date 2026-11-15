# Planner - Projects: the plan file (JSON)

Export writes this file; Import reads it. A person or an AI can write one by hand. The file is read whole and checked before
anything is written; if the first problem is found, Import says it in one sentence and writes nothing.

## The file

```
{ "format": "project-plan", "version": 1, "exportedAt": "<time>", "module": "schedule", "entries": [ <entry>, ... ] }
```

- `format` must be `"project-plan"`. `version` must be `1`. `entries` is a list of 1 to 500 entries.
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
| `notes` | no | text, up to 2000 characters |
| `phase` | no | a phase id of the template: lower case letters, digits and `-` |
| `tags` | no | a list (up to 50) of tag ids from the plan's Tags setting |
| `owners` | no | a list (up to 50) of people's keys. Leave it out unless the file was exported from this environment. |
| `order`, `by`, `ref`, `progress` | no | what Export writes so a file can be put back as it was. Leave them out when you write a file. |

A note has no dates, no `waitsOn` and no `done`. A milestone has no `end`. When the plan's setting "Dates are needed" is on,
every milestone needs `start` and all work needs `start` and `end`.

## Add and Replace

- **Add to the plan** gives every entry a new id and puts the entries after what is there. `parent` and `waitsOn` follow.
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
