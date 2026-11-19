# Template Tab List Plan

**Audience:** Thomas decides. server-development builds the template key and the seed; experience-design builds the list in the two template editors. A core change (`server/`, the stored template format), so it gets an independent read.

**Status:** Short note for Thomas, 2026-11-19, by product-planner. Nothing is built. Thomas, looking at the template editor's Default Workspace part, in his words: "would it not be easier to have a list stacked from 1st to last like we have in other places with a "show" check? that would let them set the enabled and order the tabs appear. The first position being the default one?" He asked for a short note and a quick build, then feedback.

## What exists today

- **A space already has an owner's order.** The space record holds `tabs: { order, hide }` (`cleanTabs()`, `server/layouts.js`). `systemLayoutsFor()` (`server/index.js`) answers the Fixed Workspaces in that order, and `layoutTabs()` (`public/primary-nav.js`) draws them in the order it is given, the Workspace too. Read as code. So plan-workspaces decision 13 is built, not only planned.
- **Set up already has the list.** Set up > Settings > Layouts has one row per layout with Show in the bar, Move up, Move down, a live region ("Calendar moved to position 2.") and a separate Opens first radio, which can also name a shared layout (`layoutRows()`, `withLayoutMoved()`, `movedWords()` in `public/space-setup.js`). Owners, the admin and moderators may change it. Read as code.
- **A template cannot set an order.** It has `workspace.show` (checkboxes) and `workspace.opensFirst` (a dropdown) (`WORKSPACE_KEYS`, `server/templates.js`). `workspaceSeed()` (`server/store.js`) turns them into `tabs.hide` and `defaultLayout` once, when a space is made, always in the default order. With no `show`, every Fixed Workspace shows. Read as code.
- **What opens on entering.** A person's last layout wins, then their own arrangement, then the space's `defaultLayout` (`firstVisitLayout()`, `public/opens-with.js`). So "opens first" only reaches someone with no remembered choice. Guests get no Fixed Workspaces and open the Workspace. Read as code.

## The proposal

1. In both template editors (the host console's, `public/host-templates.js`, and Manage's, `public/template-pages.js`), one ordered list replaces the "workspaces a new space shows" checkboxes and the Opens first dropdown.
2. One row for the Workspace and one for each Fixed Workspace (Calendar, Map, Conference, Whiteboards, Documents). Each row has a Show check, Move up and Move down. The Workspace's Show check is always on and can't be changed.
3. The first shown row opens first. The Workspace can move like any other row, as it can in Set up today.
4. The new template key is `workspace.tabs`: the shown ids in order, for example `["conference", "workspace", "calendar"]`. It must contain `workspace`. `show` and `opensFirst` are removed with no alias.
5. A new space is seeded from it: `tabs.order` is the list followed by the rest, `tabs.hide` is the rest, and `defaultLayout` is the first id unless that is `workspace`. After that the space keeps its own order, and Set up changes it as it does today.
6. The rows reuse Set up's Layouts rows (the same markup and helpers, moved to one shared file), not `public/list-rows.js`. That file edits labels, icons and colours with Remove and Add, so it doesn't fit.
7. Test data: the shipped Gaming, Education, Mentoring and Projects files are rewritten, and any owner's own template stored with `show` or `opensFirst` is reset. Spaces keep their stored `tabs`.

## What changes in code

`server/templates.js` (the key and its check), `server/store.js` (`workspaceSeed()`), `server/index.js` (`lookView()`'s guest rule), `templates/*.json`, `public/template-pages.js`, `public/host-templates.js`, `public/host.html`, `public/space-setup.js` (the rows moved to a shared file), and the checks that name `show` or `opensFirst`: `check-templates`, `check-pinned-workspaces`, `check-pinned-pages`, `check-template-lens`, `check-template-pages-b`, `check-admin-load`.

## Questions that block a first build

1. **Does Set up follow the same rule?** Today Set up has a separate Opens first radio, and it can name a shared layout. Lean: build the template list first and leave Set up as it is. Change Set up only if the feedback asks for it. This blocks only whether step 2 touches Set up.
2. **A template with no list (Default, Travel, an owner's template saved without one).** Lean: as today, the Workspace first, then every Fixed Workspace in the default order. Write the list out in all six shipped files so each one says what it opens.
