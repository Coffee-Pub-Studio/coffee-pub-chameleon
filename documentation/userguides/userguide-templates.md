# Templates

**Audience:** the host admin making environments, a server operator starting a single environment, and an owner whose environment uses a template or could.

A **template** is a lens over an environment. It changes what a space is, how it behaves and what it is called, so a space feels like a trip, a project, a course or a mentoring relationship. It sets the words people may rename (a space and a member), which modules a space has and what they are called, how those modules work, the phases, what the Workspace opens with, how the call starts, extra reactions and icons, and, if it has them, starter spaces and starter content.

There are three levels. The **environment** is the catalog: the modules installed, the built-in reactions and icons, its default theme and its default template. A **template** is a lens over that catalog. A **space** reads a template (its own, or the environment's) and holds its own dates and data. Every environment has a template: one that was never given another uses **Default**, which has the usual words and every module.

## The shipped templates

| Template | A space is a | Its planner (shown as) | Also on | Phases (measured by) |
|---|---|---|---|---|
| **Default** | space | all three planners | every module there is | none |
| **Travel** | trip | the day-by-day Planner (**Itinerary**) | Maps, Research, Vault, AI Assistant, Calendar, Budget, Polls, To-do, Documents, Whiteboard | Planning, Booking, Buffer, Pre-trip, Trip, Post-trip (dates) |
| **Games** | campaign (a member is a player) | Planner - Projects (**Campaign**: sessions, scenes, story threads) | Maps, Research (**Lore**), Documents, Budget (**Costs**), To-do (**Quests**), Calendar (**Sessions**), Polls, Vault, AI Assistant | none |
| **Project** | project | Planner - Projects (**Project plan**) | To-do, Calendar (meetings), Budget (**Effort**), Documents, Maps, Research, Polls, Whiteboard, Vault | Start, Build, Wrap up (dates) |
| **Learning** | course (a member is a learner) | Planner - Goals (**Learning plan**) | To-do (**Exercises**), Documents, Research (**Reading**), Calendar (**Sessions**), Budget (**Time**), Maps (visits), Vault | Explore, Practice, Review (goals) |
| **Mentoring** | mentorship | Planner - Goals (**Development plan**; the owner of a goal reads as a mentee) | To-do (**Next steps**), Calendar (**Check-ins**), Documents, Research, Budget (**Time**), Vault | Getting started, Growing, Review (goals) |

Every template has the chat and the call. The Lobby keeps only the chat, the call and the modules made for it. The Vault is called **Vault** in every template, never "Files". The Lobby's name differs: Travel's is **Home base** ("Everyone on every trip."), Games', Learning's and Mentoring's **Common room**, Project's **Front desk**. Travel, Project, Learning and Mentoring start a new space with the **Participants** picture profile. Each says what the Workspace opens with and which workspaces (Calendar, Map, Documents) a new space shows. When an environment is made from Travel or Games it turns the top bar's Calendar and Map on; Project, Learning and Mentoring turn the Calendar on.

**Starter content** is made once, when a space is made, never again on a change of template or a restore: Project gives a **Project brief**, Games a new campaign's session notes and a handout, Learning a learning journal and Mentoring a meeting log. Project also makes a **starter space**, "Your first project", when an environment is made from it.

Some settings these templates are meant to set are not built yet: Budget's unit (money, hours or effort) and its split, To-do's owners, Documents' default editor, and Maps' real and picture map switches. So Project's **Effort**, Learning's and Mentoring's **Time** and Games' maps are names and categories only. Planner - Projects has no phase bands on its Timeline. See [Known issues](../known-issues.md).

## Choose a template

**On a server with environments,** the host admin picks it on the host console:

1. In the console's **Environments** section, click **New environment**.
2. Fill in the address, the name and the first owner as usual.
3. Under **Template**, choose one (**Default** is the plain one).
4. Under **Plan**, choose the plan, or leave "No caps, every module".
5. Click **Create**.

When the host has templates, the server's sign-up route accepts the same choice, but the start page has no sign-up form now.

**On a single server,** set `TEMPLATE` in the compose file (for example `TEMPLATE: "travel"`) before the first start, on a fresh data folder. It is used only when the environment is made: on a data folder that already has an environment, or on a server with environments, it is ignored and the log says so. A `TEMPLATE` naming a template the server doesn't have stops the start, and the log lists the ones it has. With none, the environment uses **Default**.

## What a template does, and what stays yours

Some of it is applied once, when the environment is made: its settings (language, clock, the Calendar and Map in the top bar and the rest), its modules (turned on), the Lobby's name and description, how new spaces start, and its home and module icons (added to the icon list). After that they are the owner's. A template can also make **starter spaces** once, when the environment is made.

The rest follows the template live, in every space that reads it: its words, the home page's word, its phases and how they are measured, the modules a space has and their names and icons, the words and settings the modules let a template set, what the Workspace opens with, how the call starts, and the reactions and icons it adds. Anything an owner changes wins where it is the owner's to change, and **Reset** goes back to the template's, not the default. Manage shows which is which:

- **Words**: a word the template set is marked "From the template", and a word the owner changed shows "The template's: <word>" beside it.
- **Home icon**: the template's is marked "Template's own".
- **Shown as**, on a module's row: "From the template"; **Reset** reads "Back to the template's name and icon".
- A module's setting is **driven** (the template sets it; shown read-only with "Set by the <template> template."), **seeded** (the template starts it; "From the template", with **Reset**) or the module's **own** (a template never touches it). An owner's own value for a seeded setting, set for the whole environment, wins in every space.

A template never changes who may enter a space, guests or links, a module's permissions, uploads or access, or a key or file a module keeps.

## The template pages

Manage's **Template** tab is a short page and one page for each part, with buttons across the top to move between them (see [Manage](userguide-environment-settings.md), "Template"). Each part shows the template you pick at the top of its page.

- **Template**: which template the environment uses, with **Switch**; **Let a space use its own template**.
- **Environment Basics**: **Template Name**, **Template Description**, **Home Icon**, **Default Profile Image**.
- **Experience Labels**: the words you can change (a space, a member, the home page; the Lobby's name and description), and the words that never change, listed.
- **Default Workspace**: what a new space's Workspace opens with, which Fixed Workspaces it shows (shown for everyone: nobody can hide one), and which opens first.
- **Phases**: the phases and **Measured by** (**Dates**, **Goals** or **Progress**).
- **Additional Reactions and Icons**: what the template adds after the core set. Yours, for every template, are on the **Environment** tab, under **Reactions and Icons**.
- **Modules**: one row for each module: offered or not, **Shown as**, the words it lets a template rename, its settings, its starter content. The three planners sit together under **Plans**.
- **Templates**: the list.

## Switch a template

An owner can switch the environment to another template on Manage's **Template** tab:

1. Under **Default template**, choose one. Its description shows below.
2. Click **Switch**, and confirm. Words, names, phases, the modules a space has and how they work change at once in every space that reads the environment's template; anything you set yourself still wins. Nothing is deleted.
3. The tab then shows **What the <name> template can add**:
   - **Turn on**: the template's modules that aren't on yet, ticked. One your plan doesn't include is shown unticked, with why.
   - **Also**, unticked: the template's name and description for the Lobby, and the picture profile new spaces start with.
4. Untick anything you don't want, then click **Apply** (**Done** when there is nothing to add). Only what is ticked is applied, and the offer closes even with nothing ticked.

**Not now** puts the offer away; a line saying "The <name> template can turn on more." and a **Review** button bring it back, and the tab keeps a badge until you apply it. A template's settings (language, clock, currency and the rest) are not offered: they are yours by now. There is no "no template": **Default** is the plain one.

**The host admin** can do the same from the host console: open the environment from the **Environments** list, choose its **Template** tab, pick a template and click **Switch template**, then the same offer.

## Let a space use its own template

An environment has one template, and its spaces read it. An owner can let a space read another: a trip in the Travel template and a campaign in another, in one environment. Turn it on in Manage, **Template** tab, **Let a space use its own template** (on by default; it saves as you switch it). Then an owner or the admin picks a template for a space in the space's Set up, or when adding the space (see "A space's own template" in [Spaces](userguide-spaces.md)).

A space's template changes that space's words (a space and a member), its phases and their measure, the modules it has and what they are called, their words and settings, what its Workspace opens with, how its call starts, and the reactions and icons it adds. The environment's own words, Home and every list across spaces stay as the environment's template sets them.

**When a space changes template** its modules follow the new template at once. A module the new template leaves out is turned off in that space and keeps its data; it comes back as it was if a template brings it back. A planner is a module like the rest: the old planner turns off there and keeps its plan, and the new one starts with its own (empty at first); nothing is copied, converted or deleted, and changing back shows the old plan as it was. A link to something in a module that is off reads as any link to an object whose module is off. Driven settings follow at once; a seeded setting someone changed is kept; phase dates are kept; a call setting someone stored is kept. Starter content is never made again. The confirm before a change does not yet name the modules that turn off and on (it says "Its words, phases and <module> names change now. Nothing is removed."), so read the new template's **Modules** page first.

Turning the switch off makes every space read the environment's template at once. Nothing is lost: what each space chose is kept and comes back when the switch is turned on. The host admin can't delete a host template that a space uses; hide it instead. The console's list of templates shows **Used by**, with the environments that use a template and a count such as "3 spaces" for the spaces that chose it themselves. A count of the spaces a module's driven setting reaches ("driven in N spaces") is not built yet.

## Make your own template (owner)

You can't edit a shipped template or **Default**; copy one and edit the copy. Only the host edits a shipped template.

**Copy one:**

1. On Manage > **Template**, open the **Templates** page. Each row has **Open** (or **Edit** for your own), **Copy** and **Export**.
2. Choose **Copy** on the template to start from. Give the copy a **Template Name** and an **Id** (lowercase letters, digits and dashes; it follows the name until you type over it, and it can't be changed later), then **Make the copy**. Copying **Default** lists the modules enabled now.
3. The copy opens on its **Environment Basics** page. Change what you need on each page and **Save** on that page. Each save is a new version, and every space that reads the template follows on its next read. You can have up to 20.

Manage has no page for a template's call settings or starter spaces: a copy keeps those of the template it was copied from, and the host console edits them.

**Delete one:** choose **Delete** on the row. It asks first, naming the spaces that will read the environment's template afterwards, and says if the environment itself will read **Default**. A template of your own can be deleted while a space uses it; nothing is lost, the spaces fall back.

**Import a file:** choose **Import a file** and pick a `.template.json` file; it becomes one of your own. If its id is taken, the server says so and you give it another. **Export** on any row saves the template as a file.

**Use one:** choose it under **Default template** on the **Template** page, or give it to one space in the space's Set up.

## Make your own templates (host)

On a server with environments, the host admin makes templates in the host console's **Templates** section. It lists every template with where it comes from (**Bundled** or **Own**), its version, **Used by** (the environments that use it, by name, each a link to that environment's page; past four it reads "and N more"), and whether it is **Hidden**. A **More** menu on each row has **Edit**, **Export**, **Duplicate**, **Reset to shipped** (a bundled template you edited) and **Delete** (an Own template nothing uses). A bundled template can be edited (see "Edit a bundled template"), but never deleted; **Default** can be duplicated but not edited, hidden or deleted. **Import file** and **New template** are above the list. The editor opens as a page of its own with a list of its parts beside it (a strip on a phone) and one **Save**: **Environment Basics**, **Experience Labels**, **Modules**, **Default Workspace**, **Call**, **Phases**, **Reactions**, **Icons** and **Starter spaces**.

**Make one:**

1. Click **New template**.
2. Give it an **Id**, a **Name** and a **Description**.
3. Fill in what it should set: the words (blank keeps the default; give the singular and the plural), the **Home Icon**, the Lobby's name and description, what **Default Profile Image** new spaces use, the **Modules** (tick them and order them with the arrows; the chat is always there), what the Workspace opens with and shows (**Default Workspace**), **Call** (join on entering, where the call sits, its layout), and under **Phases**, **Add phase** for each one up to 12: an id and a label, **Main** on at most one, and **A phase is done by** (dates, goals or progress).
4. Add the **Reactions** and **Icons** it adds (up to 40 reactions and 60 icons, solid icons only; a repeat of the built-in set is refused), and **Starter spaces** (up to 5, each a name of at most 40 characters and a description).
5. Click **Save**. It is version 1, and offered on the create form straight away. A problem, such as a phase id listed twice, shows beside the part it is about, and nothing is saved.

The console's editor does not edit a module's settings, renamed words or starter content: it keeps what the template has, so **Duplicate** a shipped template to carry them. (Its starter space name box takes more characters than the server does; the server refuses a name over 40.) The theme is not part of a template any more: the environment sets one and each person may pick their own (see [Creating themes](userguide-themes.md)).

**Edit one:** open the row's **More** menu, choose **Edit**, change what you need, and click **Save**. Each save is a new version. Every environment using it gets the live parts at once, and is offered the rest (see "When a template is updated").

**Duplicate one:** open a row's **More** menu and choose **Duplicate**. Give the new template an id, then a name. It is a template of your own at version 1, with everything the one you duplicated has now, and opens in the editor.

**Hide one:** switch **Hidden** on in its row. It is no longer offered for new environments, on sign-up or for a switch; the environments using it keep it. Untick it to offer it again.

**Delete one:** click **Delete** and confirm. A template an environment or a space uses can't be deleted ("... use this template: <names>. Hide it instead."): hide it, or switch those to another first.

**Import a file:** click **Import…** and choose a `.template.json` file. If a template already has its id, you are asked for another. It keeps the file's version.

**Export one:** click **Export** on any row, a bundled one included. An edited bundled template exports as you have it, marked as edited.

## When a template is updated

The host admin can edit a template, and a new release can bring a new version of a bundled one. What the template gives live (its words, phases, module set, names, words and settings, Workspace, call, reactions and icons) changes at once in every space that reads it. The part applied once is offered, never forced:

1. Manage's **Template** tab reads "Version <N>, updated: review what's new", with a badge on the tab.
2. Click **Review**. The offer lists only what the template changed since you last applied or passed over it: a new module, a new Lobby, or a new profile for new spaces.
3. Tick what you want and click **Apply**. Nothing is turned off or removed, and a part you turned down is not offered again until the template changes it.

## Edit a bundled template

The host admin can change a bundled template, such as Travel, in place. The id stays, so every environment made from it gets the change.

1. In the **Templates** section, open the bundled template's **More** menu and choose **Edit**. The editor says "Your edits are kept over the shipped template."
2. Change what you need and click **Save**. The first save is the shipped version plus one, and each later save adds one.
3. The row now shows **Edited**.

**Reset to shipped**, on an edited row, removes your edits after you confirm. The shipped template is back, and the version still goes up by one.

**When a new release changes a template you edited,** your edits are kept, and a notice above the list reads "<name> was updated in this image: review". Click **Review** to see each part that differs, then **Keep mine**, **Take the new version** (you confirm first) or **Close**. If you never edited it, a new release's template simply replaces it, with no notice.

## Template files

A template can travel as a file, `<name>.template.json`, of at most 128 KB. Chameleon refuses a file it can't read ("That isn't a Coffee Pub Chameleon template file."), one from a newer version ("This template was made by a newer version of Coffee Pub Chameleon.") and one exported before 2026-09-30 ("That template file is in an older format. Export the template again and import the new file."). Where the server has been given another product name, the sentences use it. A file with a key that is not part of a template, or a template that tries to change a word that never changes, is refused whole, not trimmed, and the sentence says which key.

**An owner** has **Export** and **Import a file** on the **Templates** page, on a single server and on one with environments alike: an import is one of your own templates.

## Modules a template couldn't turn on

A template may list a module the environment can't have yet. It leaves it off and says why:

- **Not in the plan**: the environment's plan doesn't include it. The host can change the plan.
- **Needs** another module that was left off: turn that one on first.

The environment's **Template** tab on the host console and Manage's **Template** tab list each one with how to fix it. Turning it on later, once that is fixed, is the same as turning on any module.

## Backups

A backup carries the record of the template the environment uses and the owner's own templates, and a restore brings them back. The host console reads the template from the environment itself.
