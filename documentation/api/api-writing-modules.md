# Writing a module

**Audience:** someone outside this repository who wants to write a module for a Chameleon server and have an admin install it. For a module that ships with Chameleon, the source folders under `modules/` are the examples.

This page is the short path: what to put in a folder, how to build and check it, and what the admin will be asked. It points to [Module SDK](api-module-sdk.md) for every call a page can make and to [Modules API](api-modules.md) for every field and route. **Chameleon promises no stability yet.** The manifest, the SDK and the checks can change without notice until a first release says otherwise, so build against a copy of this repository and re-check your module when you update it.

## What you need

- A clone of this repository, with `npm install` run in it, and Node 22. The build tool and the checker load the server's own code from the repository's `server/` folder and the packages it uses; there is nothing to download or publish. If you do not have them, you cannot build or check a module with these tools.
- A server to try it on. Anyone who owns an environment can upload a zip on **Manage**, then **Modules**.

## The folder

A module is a folder with a `module.json` and a `src/` folder:

```
hello/
  module.json
  src/
    hello.html      the page
    hello.css       its styles (optional)
    hello.js        its script (optional)
```

The build inlines the stylesheet and script into the page, so the page loads nothing else. A module's page is plain HTML, CSS and JavaScript, with no build step of your own. Code that more than one page of the module shares can live in `src/<id>-lib.js`; the build puts it where your script has `/*__LIB__*/`.

## The smallest module.json

This is a module that shows a page on a space's canvas and nothing more:

```json
{
  "id": "hello",
  "name": "Hello",
  "version": "0.1.0",
  "scope": ["space"],
  "surfaces": { "canvas": { "entry": "hello.html" } }
}
```

`id` is 2 to 32 lowercase letters, digits or dashes, starting with a letter. A `space` module needs a `canvas` surface. Everything else is optional: a description, an icon, permissions (shown on the Roles tab), the data guards, hooks, settings and the rest, all described in [Modules API](api-modules.md), "Module manifest". A manifest that uses one of the old names for the levels or roles is refused, with a sentence naming the new word.

## Build it

```
node tools/build-module.mjs path/to/hello
```

This writes `path/to/dist/hello-0.1.0.zip`. It first applies the layout rules, so a module that draws a bar of its own or restyles a shared class stops here with the reason. Upload the zip on **Manage**, then **Modules**. A newer version replaces the running one; the version must be higher than every one already installed.

## Check it before you upload

```
node tools/validate-module.mjs path/to/hello          (a folder, built as above)
node tools/validate-module.mjs path/to/hello-0.1.0.zip
node tools/validate-module.mjs path/to/hello --json
```

The validator is the server's own install check, run on your machine with no server, no data folder and no settings. What it says is what an upload would be told. It needs the repository's `server/` folder and `npm install`, as above. It prints the module's id and version, `pass` or `fail` for each check with each finding under it as `<file>:<line> <text>`, and then one verdict.

| Exit | Meaning |
|---|---|
| 0 | The upload would be accepted. The admin may still see advice. |
| 1 | The upload would be refused. |
| 2 | The folder or zip could not be read. |

A `fail` line is not always a refusal. A check that only advises prints `fail` and the module is still accepted, with the same lines shown to the admin on its card. Only a `refuse` finding turns the verdict into "Upload would be refused".

| Check | What it looks at | Can refuse? |
|---|---|---|
| `manifest` | `module.json` against the manifest rules, the old names, and declarations only a module that ships with the server may make (below). | Yes |
| `permissions` | What an owner and the admin will be asked to approve, listed in words, with advice when a default lets guests change the module's data. | Only as the manifest does |
| `colours` | A fixed colour in a stylesheet, page or script instead of a theme token. Pure black or white as a shadow or scrim is allowed. | No |
| `words` | A changeable word (`space`, `home`, `member`) typed into what a person reads, and the old names. | No |
| `host reuse` | The layout rules: your module draws no bar of its own and restyles none of the shared classes. | No |
| `action library` | Only with `actions.server`: every library file is in the zip and parses, and none names what the runner does not give. | Yes |

A word that is plain English, such as a hotel's "double room", can be flagged by `words`. That costs nothing: it is advice.

## Colours, words and the drawn pieces

- **Colours come from the theme.** Use `var(--...)` tokens, never a fixed colour, so the module follows the theme the admin chose, light or dark. The tokens are in [Theme and Design Tokens](../designsystem/design-theme.md) and `/sdk/host.css`; [Module SDK](api-module-sdk.md), "Theme", says how they reach a sandboxed frame.
- **Words come from the SDK.** An owner can rename the levels and roles, and a template can rename more. Never type "space", "member" or the like into text people read: use `host.util.word`, `host.locale().words` or a `{space}` placeholder in the manifest's texts. The module's own renameable words are its `labels`.
- **Draw with the shared pieces.** A module draws no title bar, toolbar or menu of its own. Use `host.toolbar.set` and `host.ui.viewSwitch` for the bar, `host.menu.show` for a menu, `host.ui.editor` for an add or change form, the date picker, the people picker, the outline and the rest listed under "Shared tools" in [Module SDK](api-module-sdk.md). The checks above hold you to this.

## An actions library, and what the server gives it

A module can offer actions that an agent such as Claude asks for. If it declares `actions.server`, naming one library file, the server carries the request out by itself, with no page open. The library defines one handler for each action:

```js
const ACTION_HANDLERS = {
  addNote: (input, ctx) => ({ writes: [{ key: `note:${ctx.util.id()}`, value: { text: input.text } }] }),
};
```

The same library runs on your page through `host.actions.fromLibrary`, so a person's request and an agent's give the same result. The full contract is [Modules API](api-modules.md), "Actions the server carries".

The server gives a handler plain data only: who asked, the time, the space and its people, the pointers in the input resolved as the agent, the module's own settings and a copy of its own data in that space as the agent may read it (`ctx.read`, `ctx.list`), and a set of pure helpers (`ctx.util`). A handler answers with up to 10 `writes`, and optionally a pointer to what it made (`ref`), a little `data`, `links`, `schedules` and a `notify`. It gets:

- no network, no files, no environment variables and no child process;
- no `require`, `import`, `process`, `eval`, `Function`, `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator`, `Worker`, `WebAssembly`, `globalThis` and no `.constructor`, which the `action library` check refuses;
- 1 second of handler time, 64 MB of memory, 64 KB of input and 1 MB of answer;
- for an uploaded module, no place search (`lookups`, `skipLookupWhen`), no `phaseEnd` and no writes of `scope: "environment"`. Declaring the first two or `phaseEnd` is refused at upload.

The zip must carry the library under `src/` (`src/<id>-lib-actions.js` and any `src/<id>-lib-*.js`). The build tool does this for you when the manifest declares `actions.server`. A file that needs the browser goes in `actions.pageOnly`: the page loads it and the server leaves it out.

## What the admin approves

Installing and turning on a module asks the admin or an owner to approve what it asks for: its permissions, its hooks, the kinds of other modules' objects it may link to, the events it listens for and the actions it asks other modules for. The validator's `permissions` listing is that list in words. An update that asks for more waits until an owner approves it, and the old version keeps running.

Running your actions library on the server is a separate approval, and only the admin can give it (on a server with several environments, the host's administrator). It is of one version and one exact library: the admin sees the version and the first 12 characters of the library's SHA-256, which the validator also prints. A new version, a rollback, turning the module off and uninstalling each take the approval away, and the admin approves the new version again. The server also has to be set up for it, with a kernel network wall; without that, an agent's request to your module is refused with a sentence saying so, whatever the admin approved. Until then your module still works for people.

So an agent can never be made to wait for a page: a request your module cannot carry out on the server is refused at once with the reason. Plan for that when you write the library, and check it with the validator before you ask an admin to approve it.

## Where to read next

- [Module SDK](api-module-sdk.md): every call a page can make, the sandbox and the theme.
- [Modules API](api-modules.md): the manifest field by field, the routes, the actions contract and the approval routes.
- [Modules](../userguides/userguide-modules.md): what an admin sees when they install and approve a module.
