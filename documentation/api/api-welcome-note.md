# Welcome note API

**Audience:** a developer changing the welcome note (`server/welcome-note.js`, `public/welcome-note.js`, the routes in `server/index.js`) or reading it from another page. For how an owner writes it and who sees it, see [The welcome note](../userguides/userguide-welcome-note.md).

One note for each environment: a short text an owner writes, shown to a person at their first sign-in and again on request. It is stored in the environment's settings as `settings.welcomeNote`, `{ text, updatedAt, by }`, or `null`. Whether a person has read it is `welcomeSeen` on their account, an ISO time, left off until they have. The routes are per environment, so on a server with several environments each answers for the environment its address names.

## Routes

### `GET /api/environment/welcome`

Who may read: anyone signed in, and a guest (a guest from the door or by a guest link, as every route that lets a guest in decides it). Anyone else: 401 `{ "error": "sign in first" }`. The answer is never cached (`Cache-Control: no-store`).

```json
{ "note": { "text": "Welcome to the **campaign**.", "updatedAt": "2026-11-16T10:00:00.000Z" }, "seen": false, "guest": false, "maxLength": 4000 }
```

- `note`: `{ text, updatedAt }`, or `null` when there is none. `by` (who saved it) is stored and never sent.
- `seen`: whether this person has marked the note read. Always `false` for a guest, who has no account to keep it on; the page keeps a guest's mark for the browser session (`sessionStorage`, key `welcome-seen`).
- `guest`: `true` when the caller has no account.
- `maxLength`: 4000, the most characters a note may have.

### `PUT /api/environment/welcome`

Who may write: an owner, and the admin (the host admin's stand-in is an owner here). A member or moderator: 403 `{ "error": "<Owners> only" }`, in the environment's word for owners. Not signed in: 401.

Body `{ "text": "<string>" }`. The text is cleaned (below) and stored; an empty string, or text that is empty once cleaned, removes the note. The answer is the same as `GET`'s, with the new note.

| Status | Error | When |
|---|---|---|
| 400 | `The welcome note is sent as { text }.` | The body is not an object with a `text` key. |
| 400 | `The welcome note is text.` | `text` is neither a string nor `null`. |
| 400 | `The welcome note is at most 4000 characters.` | The text, as sent, is over 4000 characters. It is refused, never cut. |

Saving does not mark anyone as having read or not read the note. The server logs `[welcome] <key> saved the welcome note` or `removed`.

### `POST /api/environment/welcome/seen`

Marks the note read for the person who calls it (`welcomeSeen`, set once and kept). No body. A guest has nothing stored, so for a guest it only answers. Answers as `GET` does, with `seen: true`. Anyone who is neither signed in nor a guest: 401.

## The cleaner

`clean(text)` in `server/welcome-note.js` is the only way text reaches storage. What is stored is what the one Markdown reader on the pages (`hostText.markdown`, `public/sdk/host.js`) draws, cut down to the subset the note allows:

- Paragraphs, `**bold**`, `*italic*`, `- ` bullet lines and links written as words in square brackets followed by an address in round brackets.
- Hidden characters and HTML tags are removed first, by the same function that cleans objects (`plain` in `server/object-format.js`). A `<` that cannot open a tag (not followed by a letter, `/`, `!` or `?`) is kept as text. The result has no `<` before a letter, `/`, `!` or `?`, so cleaning it again changes nothing.
- A link is kept only when its address is `http:`, `https:` or `mailto:address`, has no space, `(` or `)`, is at most 500 characters, has no user name or password (a `mailto` address has no `?`), and its words are at most 200 characters. Otherwise the link is dropped and its words stay. A bare address in the text loses a user name and password, and one over 500 characters becomes "(address too long)".
- A line loses a code fence, backticks, leading `#` and `>` marks; a numbered list's `1.` or `1)` becomes `1:`; a bullet with nothing after it is dropped. Three or more line breaks become two, and the text is trimmed.

`cleanStored(raw)` reads a stored note back: it cleans the text again, and drops the note when it is not text, is empty or is over the length. It runs when the store loads (`Store`, `data.settings.welcomeNote`) and on a restore of an owner's copy (`restoreEntries` in `server/environment-export.js`), so a hand-made file can't plant markup.

## The pages

- Manage > Environment > Welcome note (`#welcome`, `public/admin.js`): the box, the count, **Save** and **Remove**; the box shows the cleaned text the server sent back.
- `welcomeOnArrival()` in `public/welcome-note.js`, called by `public/space.js` once, after the join or Set up the page started has settled: loads the note and shows it in the SDK's one dialog (`confirmDialog` in `public/confirm.js`) when there is one this person has not read. A guest by link sends `?guest=<token>&pass=<pass>` so the server knows who is asking. **Got it**, **Escape**, the close button and the backdrop all mark it read.
- The account menu's **Welcome** entry (`public/brand.js`, `account-welcome`): shown while a note exists and for a signed-in person only.
- `confirmDialog` gained two options for the pages' own use, never a module's: `html` (markup already made safe, `hostText.markdown`'s output, set into one `div`) and `single` (only the action button, no Cancel). `hostText.markdown` now links `mailto:` addresses as well as `http` and `https`, in every place it is used.

## An owner's copy

The note is in an owner's copy of the environment (`settings.welcomeNote`) and `welcomeSeen` is left out of each person, so a restore shows the note to everyone once more.

## Checked

Two checks cover it: `tools/check-welcome-note.mjs` (the routes on throwaway servers: who may save and read, the cleaner with hostile text and a long run of `[`, the seen mark per person across a restart, two environments keeping their own note, a single install) and `tools/check-welcome-note-page.mjs` (live in headless Chromium: the Manage part, the dialog, the Welcome entry, a phone width, a door guest, a guest by link, a join that fails). This documentation pass ran the first (16 passed). The second did not run to the end in the cloud container used (its page never drew), so what is said of the pages is read from the code and from what the check says it drives.
