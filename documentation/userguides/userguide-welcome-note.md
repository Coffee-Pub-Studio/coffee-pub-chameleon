# The welcome note

**Audience:** an owner or the admin who wants to greet people when they first sign in, and a member or guest who sees the note and wants it again.

The welcome note is a short text an owner writes once for the environment. Each person sees it the first time they sign in, in a small window with one button, and can read it again from the account menu. Use it for house rules, where to start, or who to write to.

## Write the note (owner or admin)

1. Open **Manage**, then **Environment**, then **Welcome note**. (The address `/admin#welcome` opens it too.)
2. Type the note in the box. The line under it counts the characters, for example "120 of 4000 characters". A note can be at most 4000 characters; past that the count turns red and **Save** is off.
3. Choose **Save**. The status says "saved", and the box shows what was kept (see "What a note may hold" below).
4. To take the note away, choose **Remove**. The status says "removed". **Remove** shows only while there is a note.

Members and moderators have no Manage page, so they can't write or change the note.

## What a note may hold

A note is plain text with a few marks:

| You write | It shows as |
|---|---|
| A blank line between blocks | Paragraphs |
| `**words**` | **Bold** |
| `*words*` | *Italic* |
| Lines that start with `- ` | A bulleted list |
| `[the rules](https://example.com/rules)` | A link that opens in a new tab |
| `[write to us](mailto:someone@example.com)` | A link that starts an email |

Everything else is turned into plain text when you save, so the box shows you what people will read:

- Links go only to an `http`, `https` or `mailto` address. A link to anything else keeps its words and loses the link. An address with a space or a bracket in it is not a link, nor is one over 500 characters, and a `mailto` link can't carry a subject or other extras. A user name and password inside a web address are taken out.
- Headings (`#`) and quotes (`>`) lose their mark, and a numbered list (`1.`) becomes `1:`. Backticks and code blocks are taken out.
- HTML tags and hidden characters are taken out. A `<` that opens no tag, as in "a < b", stays.

## Who sees it, and when

- **People with an account** see the note once, when the app opens after they sign in. The window is titled **Welcome**. Choose **Got it**, or close the window any way you like, and it is marked as read for that person; it doesn't come back at the next sign-in.
- **Guests** see it once for each browser session (a guest from the guest door, or one who came by a guest link). A guest isn't remembered between sessions, so a new session shows it again.
- If you change the note later, people who have already read it are not shown it again by themselves. They can open it from the account menu.
- Nobody sees a window when there is no note.

## Read it again

1. Open the menu under your picture (on a phone, the menu at the top of the page).
2. Choose **Welcome**.

**Welcome** is in the menu only while the environment has a note, and not for guests. Press **Escape** or **Got it** to close it.

## Good to know

- An owner's copy of the environment (see [Your environment](userguide-environments.md), "A copy, and leaving") carries the note but not who has read it, so after a restore from it everyone sees the note once more.
- The note is for greeting people. It is the same text for everyone and isn't a place for secrets.
- The routes behind it are in [The welcome note API](../api/api-welcome-note.md).
