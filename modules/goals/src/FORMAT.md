# Planner - Goals: the plan file (JSON)

Export writes this file; Import reads it. A person or an AI can write one by hand. The file is read whole and checked before
anything is written; if a problem is found, Import says the first one in one sentence and writes nothing.

## The file

```
{ "format": "goal-plan", "version": 1, "exportedAt": "<time>", "module": "goals", "entries": [ <entry>, ... ] }
```

- `format` must be `"goal-plan"`. `version` must be `1`. `entries` is a list of 1 to 500 entries.
- `exportedAt` and `module` are written by Export and are not needed when you write a file.
- A file is at most 1 MB. A plan holds at most 1000 entries, so Add refuses a file that would go past that.
- Fields that are not listed here are ignored.

## An entry

| Field | Needed | Value |
| --- | --- | --- |
| `kind` | yes | `"goal"`, `"step"` or `"note"` |
| `title` | yes | text, up to 200 characters |
| `id` | no | 1 to 64 letters, digits, `-` or `_`; each one used once. Give one on a goal when steps or notes name it as their `parent`. |
| `parent` | steps | the `id` of a goal in the file. A step needs one; a note may have one or sit at the top; a goal has none. |
| `why` | goal | text, up to 2000 characters: why the goal matters |
| `text` | note | text, up to 8000 characters |
| `date` | no | a day written `YYYY-MM-DD`, from 1900 to 2200 (goal and step). Never needed. |
| `done` | no | `true` or `false` (goal and step). A goal with steps is done when all its steps are. |
| `phase` | no | goal: a phase id of the template, lower case letters, digits and `-` |
| `owners` | no | goal: a list (up to 50) of people's keys. Leave it out unless the file was exported from this environment. |
| `links`, `order`, `by`, `createdAt`, `progress`, `shownDate` | no | what Export writes so a file can be put back as it was. Leave them out when you write a file. |

A note has no `done` and no date. Steps and notes keep the order the file lists them in, under their goal.

## Add and Replace

- **Add to the plan** gives every entry a new id and puts the goals after what is there. `parent` follows.
- **Replace the plan** (needs the right to clear the plan) takes everything out and puts the file's entries in, keeping their
  ids and order. Undo is offered for 30 seconds, as it is for Clear.
- A `parent` may come before or after its children in the list.

## A complete example

```json
{
  "format": "goal-plan",
  "version": 1,
  "entries": [
    { "id": "g1", "kind": "goal", "title": "Hold a basic conversation in Spanish", "why": "To talk with my host family this summer.", "date": "2026-06-30" },
    { "kind": "step", "title": "Learn the 500 most common words", "parent": "g1", "date": "2026-03-31", "done": true },
    { "kind": "step", "title": "Practise with a tutor every week", "parent": "g1", "date": "2026-05-31" },
    { "kind": "step", "title": "Order a meal without English", "parent": "g1" },
    { "id": "g2", "kind": "goal", "title": "Run a 10 km race", "date": "2026-09-20" },
    { "kind": "step", "title": "Run 5 km without stopping", "parent": "g2", "date": "2026-04-30" },
    { "kind": "step", "title": "Pick a race and sign up", "parent": "g2" },
    { "kind": "note", "title": "Rest days matter", "text": "Take one rest day a week. Ask the coach about shoes.", "parent": "g2" }
  ]
}
```
