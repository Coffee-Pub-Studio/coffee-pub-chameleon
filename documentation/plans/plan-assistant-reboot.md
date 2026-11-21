# Assistant Reboot Plan

**Audience:** Thomas decides how a pasted booking becomes part of a trip (the open questions at the end). server-development
builds the extraction route, the format fields, the checks and the agent tool; experience-design builds the Itinerary's
paste sheet, its preview and the Assistant view's paste; quality-assurance reviews the route as an AI and privacy change;
content-manager documents.

**Status:** draft for Thomas, 2026-11-21, by product-planner. Nothing decided yet. From Thomas, 2026-11-21: "the other
route we need to work on is our internal assistant. It needs a reboot. We need to be able to say: here is the text from
my flight confirmation email, please pull this into the trip. Or here are my hotel details, add it to the trip. We have a
barely higher success rate using our prompt in ChatGPT and having it build the import object than our own tool."

Related: [plan-ai-integration](plan-ai-integration.md) (the prompt layer, decisions 1 to 23),
[plan-object-handoff](plan-object-handoff.md) (the objects format and `acceptSuggestion`),
[plan-research-import](plan-research-import.md) (the paste import and its preview),
[plan-agent-access](plan-agent-access.md) (agents and `ask_for_change`), [plan-flight-lookup](plan-flight-lookup.md)
(the airport list), [plan-ai-assistant](plan-ai-assistant.md) (the AI Assistant module).

## What it is today

There are two ways a booking email reaches the trip, and one way for an agent.

**The paste flow (what Thomas does in ChatGPT).** The prompt is `paste@1` (`server/prompts/paste.js`, built from
`fencedRule` in `server/prompts/object-rule.js`; golden copies in `tools/golden/prompts/paste@1/`). A person copies it
from Chat or the Assistant view (**Copy instructions for another AI**, `GET /api/objects/format`), pastes it and the
email into ChatGPT, then pastes ChatGPT's fenced `objects` block back. `POST /api/spaces/:id/objects/check` reads it
(`readObjects` and `cleanObject` in `server/object-format.js`), the preview lists each object with a tick and says what
could not be read ("2 could not be read: 1 had no title"), and **Keep ticked** hands each one to the Itinerary's
`acceptSuggestion` with `object` (`fromObject`, `objectFields` in `modules/travel/src/travel-lib-object.js`). I found no
other ChatGPT prompt: I searched `documentation/`, `modules/travel/`, `server/prompts/`, `tools/golden/` and the whole
repository for "chatgpt" and "prompt". If Thomas uses a prompt of his own and not the copied instructions, this
diagnosis should be checked against it.

**The in-app flow.** A person pastes the email into the Assistant view (or Chat's `/ai`) and asks. That is
`POST /api/spaces/:id/ai` with the `ask@3` template (`server/prompts/ask.js`): a general question-and-answer prompt
whose objects are a side output, with the read tools (`search_objects`, `read_object`, a forced `answer`) offered in a
loop of up to 4 rounds (`server/ai-tools.js`). Structured output uses `answerSchema` (`object-rule.js`): `{ answer,
objects, used }`, every property required, an unknown value written as null. Objects that come back are drawn with
**Keep**, which calls the same `acceptSuggestion`.

**The agent flow.** An agent over MCP (`server/mcp.js`) calls `list_actions`, then `ask_for_change` with
`travel:acceptSuggestion`. The action's `object` input is typed only as `object?`; no MCP tool returns the objects
format's schema or instructions, so an agent writes the object from the action's hints alone. An agent's change goes
through without a yes (plan-agent-access).

**What the objects format can hold** (`DETAILS` in `server/object-format.js`): a flight's airline, number, from and to
(code and name), departs and arrives (local wall-clock time, no zone), minutes, terminal, gate, seat, class and
reference; a stay's address, check-in, check-out, room type, guests and reference; a meal's or visit's start, end, party
size, booking name, tickets and reference. It has **no cost, no currency and no passengers**. The Itinerary's flat
`acceptSuggestion` input takes `cost` and `reference` (`withDetails` in `travel-lib-plan.js`), but the `object` path
(`fromObject`) never reads a cost. The airport list (`server/airports.json`) holds each airport's time zone.

**There is no update.** The Itinerary offers `addStop`, `addToDay`, `acceptSuggestion` and `addFromText`; nothing
changes a booking already on the trip from new text.

## Why the in-app tool does worse

Compared step by step, from the code. "Evidence" means read in the code; "guess" means it would need a real model run to
show.

| Step | Paste flow (ChatGPT) | In-app flow (`ask@3`) |
|---|---|---|
| How much of the email gets in | All of it | At most 1,000 characters: Chat's input has `maxlength="1000"` (`public/space.html`, `#chat-input`), so the browser cuts a longer paste without a word, and the server refuses a question over `MAX_QUESTION` = 1,000 (`server/prompts/inputs.js`). A confirmation email is usually several thousand. **Evidence.** |
| What the model is asked to do | Pull every booking into objects; that is the whole prompt | Answer a question, "short and plain", and add objects "only when it contains something worth keeping". **Evidence**; that it lowers extraction is a **guess**. |
| Room to answer | ChatGPT's own, large | 1,500 tokens for the answer and every object (`budget.answer`). **Evidence.** |
| The shape it writes | Only the fields it knows, nothing else | One `details` object holding every field of every listed kind, each one required and written as null (`detailsSchema`): about 40 nulls per object, so a few objects fill the 1,500 tokens and the rest are cut. **Evidence** for the shape; the exact count per object is a **guess**. |
| Tools | None | Look-up tools it may spend rounds on before it answers. **Evidence** that they are offered; that they cost accuracy is a **guess**. |
| What it knows of the trip | Nothing but the email | The space's name, today and its phases; not the Itinerary's dates, time zone or currency (`server/ai-context.js`). **Evidence.** |
| Checking and repair | The person reads ChatGPT's answer and asks it to fix it; the preview says what was dropped | An object that fails `cleanObject` is dropped without a count (`readAnswer` in `server/prompts/parse.js`); no retry. **Evidence.** |
| Cost and passengers | Lost on Keep (no field) | Lost the same way. **Evidence**: both flows miss them, which is part of why neither does well. |

In short: the in-app flow sees a cut-off email, is asked a different question, and has too little room to write the
answer in too heavy a shape. The paste flow wins only because ChatGPT gets the whole email and a person repairs the
answer by hand. No real model has been scored on either (`architecture-ai`, "Not yet tried against a real service"), so
"barely higher" is Thomas's observation, not a measured rate.

## User stories

1. **A flight.** I paste my airline's confirmation email into the Itinerary and press **Read it**. I see one row per
   flight (the return is its own row): airline and number, from and to, departs and arrives in local time, seat, class,
   the confirmation number, the cost, who flies. I press **Add**, and they are on the trip on their days.
2. **A hotel.** I paste the booking: one stay row with the address, check-in and check-out days and times, room, guests,
   confirmation number and cost.
3. **A train, a restaurant, a ticket.** The same, each as its own kind (train; restaurant with party size and the name
   it is under; a show or attraction with the number of tickets).
4. **An attachment or a forwarded email.** I paste the text of a PDF ticket or a forwarded email with its headers and
   quoted replies; the headers, the footer and the advertising are ignored.
5. **Many in one paste.** A travel agent's whole itinerary: every flight, stay and booking as its own row, in the order
   they happen.
6. **Update the trip.** My flight was moved. I paste the change email; the preview shows the flight it matches on the
   trip, with what changes ("Departs 14:05, was 12:40"), and **Update** changes only those fields. Nothing is removed.
7. **Before anything is written,** I always see the preview: **Add** (or **Update**) for all, **Edit** on a row (the
   Itinerary's own form, filled in), **Cancel**. A row says plainly what could not be read, and a blank field stays blank.
8. **Where I do it:** in the Itinerary (a **Paste a booking** entry in its add menu), in the Assistant view (pasting long
   text offers **Read it as bookings**), and an agent like Claude or Codex can do the same over MCP.

## Options

### 1. Who does the extraction

- **A. Agents only.** Publish the schema and instructions over MCP, and drop the in-app model call for bookings. Costs
  little to build. Rules out every person without an agent, and the managed AI offer the host already sells; and an
  agent's write needs no yes, so the preview story fails for it unless that is changed.
- **B. In-app only, rebuilt.** A dedicated extraction call with its own template. Fixes what Thomas measures, for
  everyone with AI on. Agents keep guessing the object's shape.
- **C. Both, on one contract.** One extraction template and one schema; the in-app route uses it, and an MCP tool hands
  the same schema and instructions to an agent, which extracts itself and calls `acceptSuggestion` as today. Costs B plus
  one small read tool.

Lean (a suggestion): **C, in that order.** B is what fixes the success rate; the agent tool is cheap once the schema
exists, and it stops agents writing objects from hints.

### 2. The object's shape for the model

- **A. One merged `details`** (today). Simple; heavy and wrong-kind fields invite noise.
- **B. One schema per kind,** joined with `anyOf` on `kind`. Each object carries only its own fields. OpenAI's strict mode
  and Anthropic's tool input both take `anyOf`; a compatible service may not, and falls back to text as today
  (decision 13 of plan-ai-integration).

Lean: **B.**

### 3. Cost and passengers in the format

- **A. Add to `details`:** `cost` (a number), `currency` (a three-letter code) and `travellers` (names) on journeys,
  stays, meals and visits. The Itinerary takes the cost as its Estimated when the currency is the trip's, else as a notes
  line ("Cost: 412.80 EUR"); travellers become the object's people when a name matches a member exactly, else a notes line.
- **B. Leave them out;** they stay in the notes as the model writes them.

Lean: **A.** A booking's price is what Budget needs, and the Itinerary already has the fields.

### 4. Agents and the preview

Plan-agent-access decided that an agent's changes go through without a yes. The brief here says "never silent writes".

- **A. Keep the agent decision:** the person's own pastes always preview; an agent's `acceptSuggestion` lands as it does
  now, labelled and logged.
- **B. An agent's import waits as a preview** in the Itinerary for a person to Add or Cancel.

Lean: **A**, because it is already decided and logged; B would reopen plan-agent-access. Open question 1.

## How extraction works (the proposal)

- **One call, no tools, no history, no answer prose.** A new template `extract@1` in `server/prompts/`, task `extract`,
  structured output against `{ objects: [...], unread: [sentences] }` with the per-kind schema. Prompt-then-parse for a
  service with no structured output, as today.
- **What the model is given,** as data, never as instructions: the pasted text (up to 30,000 characters, the label
  "pasted text"); the trip's name, first and last day, time zone and currency, passed by the Itinerary; today in the
  asker's time zone. Not the members' names unless What AI may see allows them (decision 8).
- **What it is told:** one object per booking, a return its own object; copy dates, times, numbers and names exactly as
  written; times in the local time where they happen, as printed; a field not in the text is left out, never guessed; a
  year not written is left out. Four short examples, from anonymised real emails (one flight with a return, a hotel, a
  train, a restaurant), with every value realistic but fake.
- **Checked on the server,** after `cleanObject`:
  - every reference, flight or train number and time must appear in the pasted text (spaces and case ignored); one that
    does not is dropped and said ("The confirmation number was not in the text, so it is left blank");
  - a date with no year written is given the year that puts it inside the trip, or the next one after today; when that is
    not clear it is left blank and said;
  - a flight's arrival is checked against its departure using both airports' time zones from `server/airports.json`; an
    impossible flight time (negative, or over 20 hours) leaves the arrival blank and says so. Zones are never asked of
    the model;
  - a check-out before its check-in, or a day far outside the trip (more than 60 days), is said on the row.
- **One repair.** When the answer does not read, or an object fails the shape, the server asks once more with the
  problems listed. After that it shows what is valid and says what is not.
- **Plain refusals:** "There is no booking in this text." "That text is longer than 30,000 characters; paste one email at
  a time." "AI is not on in this space." Failures appear on the preview, never as an empty answer.
- **Update.** The route answers, beside each object, the object on the trip it matches: same kind and reference, else same kind,
  number and day. The Itinerary shows that row as **Update** with the changed fields. A new Itinerary action changes only
  the fields the object gives.

## Privacy

- The pasted text goes only to the environment's AI service (the owner's provider setting, or the host's managed offer),
  only when the person presses **Read it**. It needs **Use AI** and the space's AI switch (decision 1); a guest can't.
- The text is **not kept**: not in Chat's history (unlike an `ask`, whose question is stored as a private message), not
  in the call record (records hold no content, decision 15). Only the objects the person adds are kept, in the Itinerary.
- `AI_LOG_PROMPTS` would print the text to the server's log; it is off by default and refused on a hosted install, and
  the user guide says so.
- Secrets in the text are redacted as today (`aiPolicy.redact`). Names, addresses and confirmation numbers are not: they
  are the point.

## Cost and limits

- One call: roughly 1,500 tokens of instructions and examples, 1,000 to 8,000 for the email, about 150 for each object
  written. A repair is a second call. Counted as one turn and one call against the monthly cap; every token counts against
  the allowance (as decision 20).
- At most 30,000 characters in and 20 objects out per paste.
- The model is whichever the owner chose; the evaluation below shows whether a smaller model is good enough (open
  question 3).

## Evaluation

- **A golden set** in `tools/golden/extract/`: 24 anonymised confirmation texts, each with its expected objects. At
  least: 6 flights (one-way, return, a connection, a red-eye across midnight, a schedule change, two passengers), 4
  hotels (one a rental), 3 trains, 3 restaurants, 3 tickets (show, museum, tour), 2 car hires, 2 forwarded emails with
  headers and quoted replies, and 1 travel agent's full itinerary. Real emails, with names, numbers and addresses
  replaced by fake ones of the same shape.
- **A check with a stand-in model,** `tools/check-ai-extract.mjs`: the rendered prompt against golden files, the schema,
  each server check above (the not-in-the-text rule, the year, the airport zones), the repair path (the stand-in answers
  badly once), the refusals, that nothing is stored, and the Itinerary's mapping of cost and travellers. Runs with
  `npm run check`.
- **A real-model run Thomas starts,** `tools/eval-extract.mjs` (not part of `npm run check`): each sample through the
  configured service, scored per field. A right value scores 1, a blank where one was expected 0, an invented value
  minus 1. It prints a list by kind and field, the total, the tokens used, and optionally the same samples through
  `paste@1` for a fair comparison.

## Left to build, in order

Steps 1 to 4 are the smallest reboot that should fix the success rate; 5 to 7 follow.

1. **The format fields and the per-kind schema** (core, server-development). `cost`, `currency`, `travellers` in
   `DETAILS`; `objectSchema` per kind; `paste@2` with the same fields, so the copied prompt gains them too.
2. **The extraction route** (core, server-development). `extract@1`, `POST /api/spaces/:id/ai/extract` with `{ text,
   trip, tz }`, answering `{ objects, matches, unread, cut, tokens }`; the server checks, the repair, the refusals, no
   storage; `host.ai.extract({ text, trip })` in the SDK.
3. **The golden set and its check** (core, server-development, with Thomas supplying real emails to anonymise).
4. **The Itinerary's paste sheet** (module lane, experience-design, Itinerary patch bump). **Paste a booking**, a text
   box, **Read it**, the preview with **Add**, **Edit** and **Cancel**; cost and travellers mapped.
5. **The Assistant view** (core, experience-design, `public/chat-input.js`). Pasting text longer than a question offers
   **Read it as bookings**, which uses the same route and the existing import preview; and a paste over 1,000 characters
   is never cut without a word.
6. **The agent tool** (core, server-development). An MCP tool `object_format` that answers the schema and the extraction
   instructions, and `acceptSuggestion`'s description pointing at it.
7. **Update** (module lane plus step 2's matches, experience-design). An Itinerary action that changes a matched object's
   given fields, and **Update** rows in the preview.

## Verify

- Steps 1 to 3: checked by a tool with the stand-in model (`check-ai-extract`, `check-object-format`, `check-prompts`).
- Step 4 and 7: `npm run check:module -- travel`, and the sheet walked in a browser against the stand-in.
- Step 5: walked in a browser; `check-ai-page` for the paste.
- Step 6: new cases in `tools/check-mcp.mjs` for the new tool.
- **Not checkable here:** whether a real model extracts well. That is `tools/eval-extract.mjs`, run by Thomas with a
  provider key and a spending limit (about US$5 for 24 samples twice). Nothing here needs a LiveKit call.

## Open questions

1. **Agents and the preview.** Should an agent's import wait as a preview for a person, or land as plan-agent-access
   decided? Lean: land as decided; the preview is for a person's own pastes. Does not block steps 1 to 5.
2. **Cost, currency and travellers in the format** (option 3). Lean: add them. Blocks step 1.
3. **Which model.** Should extraction use the owner's chosen model, or may the owner pick a separate one for it? Lean: the
   same model for now; decide after the first real-model run. Does not block.
4. **The golden emails.** Will Thomas supply 20 to 30 real confirmation emails to anonymise, or should they be written
   from scratch? Lean: real ones, anonymised; written ones miss the noise that breaks extraction. Blocks step 3's quality
   run, not its structure check.
5. **Update in the first reboot or after.** Lean: after steps 1 to 4 show the success rate is fixed. Does not block.
6. **The Assistant view's general `ask`.** Keep it as it is beside the new route? Lean: yes; it answers questions, and
   extraction is a different job.
