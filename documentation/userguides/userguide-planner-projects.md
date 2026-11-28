# Planner - Projects

**Audience:** a member planning a project with the Planner - Projects module on a Coffee Pub Chameleon server, and an owner setting it up.

Planner - Projects (module id `schedule`; the Schedule outline) plans one project for a space: **milestones**, the **work** that gets there with who does it and when, **notes**, and what **waits on** what. It is one of three planners; the others are the day-by-day [Planner - Itinerary](userguide-planner.md) and [Planner - Goals](userguide-planner-goals.md). A space has the planner its template lists: the Projects template lists this one and shows it as **Project plan**, and the Gaming template shows it as **Campaign**, with its milestones read as sessions, its work as scenes and its tags as story threads. Under the Default template it is there too, with every other module. Which words you see below are the template's; the defaults are written here.

Who can: anyone who may **See the plan** (members, guests and moderators by default) sees it; **Add and change the plan** (members and moderators by default) adds and changes; **Clear the whole plan** (moderators by default) clears it. Owners always may. An owner changes who on the Roles tab, under **Module: Planner - Projects**.

## Set it up (owner)

1. On the Modules tab, choose **Install** beside **Planner - Projects**, then **Approve and enable**. It asks to link to other modules' objects. A space has it only if its template offers it (see [Modules](userguide-modules.md), "Which modules a space has"); to give a space a different planner, choose another template for it.
2. Its settings are the template's. Under the Projects template the two switches below are set by the template and show "Set by the Projects template.", read-only; the others are yours to change in the module's section on the space's **Set up**, **Settings** tab. To change a driven one, copy the template and edit your copy (see [Templates](userguide-templates.md)).

| Setting | What it does | Set by the template |
|---|---|---|
| **Dates are needed** | A milestone and a piece of work need dates. Off, dates are optional and the Timeline shows only the dated entries | Driven (Projects: on; Gaming: off) |
| **Waits on** | Lets an entry say which others it waits on, and draws the lines between them | Driven (Projects: on; Gaming: off) |
| **Progress counts** | What the plan's count says: **Milestones done** (the default) or **Work done** | Driven |
| **Opens on** | The view a space opens on, **Timeline**, **List** or **Board** | The template's start; you may change it |
| **Board columns** | The columns the board starts with: **To do, Doing, Done** or **Inbox, Now, Next, Later, Done**. They stay until someone edits the columns; after that the board keeps its own | The template's start (Gaming: Inbox, Now, Next, Later, Done) |
| **Sizing** | **Off**, **Points** (1, 2, 3, 5, 8, 13) or **T-shirt sizes** (XS to XL). When on, each piece of work has a **Size** choice in its form. To use your own sizes, someone allowed to change the board's columns and fields opens **Edit fields** on the Board, ticks **Size** beside one field (a plan has one: "A plan has one size field.") and types what each choice is worth, a whole number from 0 to 999. A size is kept in the plan and is never sent to GitHub. The burndown that counts sizes is not built yet | Not set by a template |
| **Tags** | The tags an entry may carry (the Gaming template seeds story threads) | The template's start; you may change it |
| **Follows GitHub** | A GitHub repository whose issues this plan shows as work, connected through the server's GitHub app (or, for a public one, followed read only). It is a control, not a typed value. See "Follow a GitHub repository" | Not set by a template |

## Add to the plan

1. Open **Planner - Projects** on the canvas, or on its own page. Choose the **+** in its title bar, then **Add a milestone**, **Add work** or **Add a note** (with the template's words), or use the same choices on an empty plan. A milestone's menu also has **Add work under it**.
2. Fill in the form, in this order: **Title** and **Notes**, **Done**, **Tags**, **Phase** and the plan's fields; then **Owners** (people of the space), **Part of** (what it sits under), **Starts** (and **Ends**, for work) and **Waits on**. **Waits on** lists only what the entry already waits on; type in **Search to add** to find another piece of work (the first 8 matches are listed, and a longer list asks you to type more), tick it to add it, and untick one in the list to take it off. Choose **Add**.
3. To change one, open it from its row or bar; **Save** keeps it, **Delete** removes it.

A milestone is done when everything under it is done, or when you tick it. Work is done when you tick it. A note has no done. Each is an object like any other, so you can link a To-do task to one (it shows under the entry it links to), and see the dated ones in the Calendar. It does not take a drop of an object from another module the way the Itinerary does; link from the entry's form.

## Add from Chat, or from a file

**From Chat.** The kinds of a plan, **milestone**, **piece of work** and **note**, are objects like any other, so an AI answer or a pasted file can hold them and Chat can send them here. In an AI answer, **Keep** on one of these objects offers **Planner - Projects** (with the template's words, for example "Campaign"), and a message's **⋮** menu > **Send to...** lists it as "<module> as a milestone", "as a piece of work" or "as a note". The AI writes them when this planner is on in the space; each carries its own title, its words (kept as the entry's notes, cut at 2000 characters), and, if it has them:

- its days: a milestone's day, a piece of work's first and last day (days from 1900 to 2200; a time after a day is dropped). With **Dates are needed** on, a milestone without a day or work without a start and end is refused with a sentence.
- **under**, the title of the milestone it sits under: it is matched to a milestone already in the plan (or kept earlier from the same answer), ignoring case and spaces; if two have that title the later one is used, and a title that matches nothing, or its own, puts the entry at the top of the plan. Only a milestone holds entries: a title that names work or a note puts the entry at the top.
- **phase**, the phase's name (or its id), matched to the template's phases ignoring case; one that matches none is left out.
- **done**: a milestone becomes ticked, a piece of work becomes done.

**From a file.** The menu at the right of the title bar, **Export and import** (the button with two arrows), has:

- **Export as JSON** saves the whole plan as a file named for the day. It is dimmed ("Nothing yet") with an empty plan.
- **Check file** reads a file the way Import does and writes nothing. It says "This file is good: it would add N entries" with what they are (for example "2 milestones, 5 pieces of work and 1 note"), or "This file has a problem" (or "N problems") and lists them, the first and up to five more, one for each entry, so a file can be fixed in one round.
- **Import JSON: add to the plan** asks "Add <what> to the plan?" and adds the file's entries after what is there; the plan as it is stays, and every entry gets a new id.
- **Import JSON: replace the plan** (in red) asks "Replace the plan?", says how many entries come off and what goes in, and takes everything out first. Choose **Replace the plan** to go on.

Check file and the two imports need the right to **Add and change the plan**; replacing also needs **Clear the whole plan**. A file is read whole and checked before anything is written: if anything is wrong, nothing is imported and the first problem is said in one sentence. A file is at most 1 MB and 500 entries, and a plan holds at most 1000 (Add refuses a file that would go past that). After an import the page shows what was done with an **Undo** for 30 seconds, which takes away what the import added and brings back what it replaced; if someone else changed the plan meanwhile, nothing is imported and it says to try again. The file's fields, the rules and a complete example are in `FORMAT.md` in the module's source (`modules/schedule/src/`); `project-plan.schema.json` beside it is a JSON Schema (draft 2020-12) that any validator can check a file against before you bring it in, and a person or an AI can write a file by hand to it.

## The three views

- **Timeline.** Weeks across, work as bars, milestones as marks, and a line from an entry to what it waits on while **Waits on** is on. Entries with no day are listed under it in **Not scheduled** (an entry outside the weeks drawn, which run for at most two years, is listed under **Not on the Timeline**). The plan fills its window, and the Timeline is one scrolling area of its own: it scrolls sideways and down inside the window, so its scrollbar is always in reach, and the week header stays at the top and the names at the left as you scroll. **Not scheduled** stays under it.
- **List.** The outline: entries in order, with a fold button where one has others under it. Move an entry by dragging its handle, or from the handle's menu (**Move up**, **Move down**, **Indent**, **Outdent**), or with the keyboard on the focused handle: **Alt** with the up and down arrows to move, **Alt+Right** to indent and **Alt+Left** to outdent. Up and down walk the handles; left and right fold and unfold. On a phone there is no dragging: the handle shows as **...** and opens the menu. On a phone the List is the first view, unless you have chosen one yourself.

- **Board.** The work as cards in columns. See "The Board" below.

Under a template that measures its phases by goals, a phase is done when every entry that names it is done (see [Spaces](userguide-spaces.md), "Phases"). The title bar's count reads, for example, "2 of 4 milestones done".

## The Board

The Board is the third view, beside **Timeline** and **List**. Choose **Board** in the view switch, or set **Opens on** to **Board** in the module's settings (see "Set it up"). It shows work only: a milestone is done when its work is, and a note has no done.

Each column is a stage of the work. A space starts with **To do**, **Doing** and **Done**, or, under the Gaming template, **Inbox**, **Now**, **Next**, **Later** and **Done**. The count of cards sits beside each column's name. Inside a column, cards run in the order people have put them in (see "Order inside a column"); work nobody has placed yet comes after that, by its end day (the ones with no day last), then in the order of the List.

**The card** says the work's title, its end day or "No date" (with **Late** when it is past), who is doing it, up to two tags and "and N more", the milestone it is under, and "Waits on" the first thing it waits on while that is not done.

**Move a card** (needs **Add and change the plan**):

1. Drag it to another column; or
2. choose the **...** on the card, then **Move to** and the column; or
3. with the card focused, press **Alt+Left** or **Alt+Right** to move it one column. It lands at the end of that column.

**Enter** on a focused card opens it to edit; the **...** menu also has **Edit** and **Delete**. Up and Down walk the cards in a column, Left and Right go to the next column. A screen reader hears, for example, "Moved "Write the brief" to Now." Someone without the right to change the plan sees the board and has no moves.

### Order inside a column

The order of cards in a column is kept, so the top of **Now** can be the next thing to do. It is the plan's own: it is shared by everyone and never sent to GitHub. It needs **Add and change the plan**.

1. Drag a card up or down inside its column. A line shows where it will land: before or after the card you are over.
2. Or, with the card focused, press **Alt+Up** or **Alt+Down** to move it one place.
3. Or choose the **...** on the card, then **Move up**, **Move down**, **Move to top** or **Move to bottom**.

A screen reader hears, for example, "Moved to position 2 of 5 in Now.", or "Already at the top." when there is nowhere to go. Dropping a card on another column puts it where the line shows, in that column. Work with no place yet sits below the work that has one. On a phone there is no dragging: use the card's **...** menu. An [agent](userguide-agents.md) moving a piece of work to a column may also name the work to put it in front of.

**Add work to a column.** The **+** in a column's heading opens the form for new work in that column.

**The List's tick.** A column can count as done. Ticking work in the List (or the **Done** box in its form) moves its card to the first column that counts as done, and unticking moves it to the first column that does not. Moving a card into a column that counts as done marks the work done, and out of it marks it not done. The List and the Timeline name the column under work's title when it is not the board's first column, so the views agree.

**On a phone** the columns are sections one under another, with the done columns folded, and there is no dragging: use the card's **...** menu.

### Change the columns

Each column's **...** menu has **Fold** or **Unfold**, which anyone may use (a folded column is a narrow strip, and your choice is kept in your browser). For someone allowed to change the columns it also has:

- **Rename**, which asks for the new name (at most 40 characters, not empty). The work stays in the column.
- **Move left** and **Move right**.
- **Counts as done**, on or off. The work in the column is marked done or not done to match, and so are the milestones above it. The board must keep at least one column that counts as done and at least one that does not: "Keep at least one column that counts as done." or "Keep at least one column that does not count as done."
- **Colour**, which opens the colour picker (without an opacity slider). The column's heading gets a dot and a light wash in that colour, for everyone, and the name is always shown. **No colour** appears once a column has one and takes it off. It is one change, with **Undo**, and it is carried by Export and Import. On a plan that follows GitHub the columns come from GitHub and cannot be changed, but **Colour** and **No colour** are still offered to someone allowed to change the columns: a colour is kept in the plan and never sent to GitHub. Pull the plan once first; before that there is no board to colour ("The board has not come from GitHub yet. Pull now first.").
- **Delete**, which asks which of the other columns takes its work; the work moves there and takes that column's done state. It is refused for the last column and, with the same two sentences, for the last column that counts as done or the last that does not.

The **Add a column** button above the columns asks for a name and adds the column at the end. A board has at most 12 columns: "A board has at most 12 columns."

Who may: **Change the board's columns** is its own permission on the Roles tab, under **Module: Planner - Projects**. Moderators have it by default; members and guests do not; owners always may. Moving a card needs only **Add and change the plan**. A person without it sees the **Fold** choice only, no **Add a column** button, and a change forced through is refused with "Your role can't do that in this module."

Each change to the columns shows an **Undo** for 30 seconds, which puts back the columns and any work that changed with them. A space still on its template's columns keeps them as they are until someone first changes them; that change makes the space's own board. If someone else changed the columns at the same moment, it says so and asks you to try again. **Export as JSON** carries the board, and **Import** brings it in (**Replace** always; **Add** only while the plan has no board of its own). A template author can rename the seven default column words (Inbox, Now, Next, Later, To do, Doing, Done) in the template's words for this module (see [Templates](userguide-templates.md)); a column someone has renamed keeps its own name.

### Rows and filters

**Rows.** Above the columns, **Rows** has three choices: **None**, **Milestone** and **Person** (the template's word for a milestone). With **Milestone** the board is drawn in rows, one for each milestone that has work shown, with the work that is under no milestone in a last row, "No milestone". With **Person** each row is one person, by the first person on the work, and the last row is "No one". Each row has a heading with a fold button, and the columns' headings stay at the top while the rows scroll. A card stays in its row: dropping it on another row moves nothing and says "Change the milestone in Edit." or "Change who is doing it in Edit."; to change the row, open the work and change it there. Moving a card to another column in its row works as before. The **Rows** choice is part of the board, so everyone sees it; it needs the same permission as changing the columns (**Change the board's columns**), and **Undo** puts the old choice back.

**Filters.** The toolbar's **Filters** button has **Who**, the tags (the template's word), **Phase** and the milestone. Each choice shows how many pieces of work it has. Choices in one group add up (any person chosen), and the groups combine, so work must match every group. **Clear filters** puts them all back. The status line says, for example, "Showing 4 of 12" and the template's word for work while a filter is on, and an empty result says "Nothing matches." The filter is yours: it is kept in your browser for this space, and nobody else sees it. A new piece of work added with **+** while a filter is on starts with what the filter chose (its milestone, phase, tags and, when one person is chosen, that person); if the filter would then hide it, the bar says "Added. The filter hides it."

## Follow a GitHub repository

A space's plan can show a GitHub repository's issues as work, so the plan matches what is on GitHub. It goes one way, from GitHub to the space, until an owner also turns on writing (see "Turn on writing to GitHub" below); until then nothing here changes GitHub.

**Who:** the environment's owner connects, follows and stops. Before that the server's administrator does two things once: accepts GitHub's terms, and registers Chameleon as an app on GitHub ([Settings reference](userguide-settings-reference.md), "Register the GitHub app"). The owner of the repository, or an administrator of its organization, installs that app on the repository.

1. The administrator opens **Manage**, then **Modules**, finds **Service terms**, reads GitHub's terms, ticks the box and chooses **Accept** (see [Modules](userguide-modules.md), "The terms"). The same section shows whether the GitHub app works.
2. The owner opens the space's **Set up**, then the **Modules** tab, and finds **Follows GitHub** in Planner - Projects' section. It says "Follow a GitHub repository: its issues become this plan." Choose **Connect to GitHub**.
3. GitHub opens in the same tab. The first time, it asks you to authorize the app; later it sends you straight back. You paste nothing.
4. Back in **Set up**, a list shows the repositories the app is installed on that you can reach on GitHub, newest first. A private one is marked **Private**. One you can read but not change says "You can read this repository but not change it." Choose **Follow** beside the one you want. That is the whole step: it does not wait for **Save**. The box then shows "Following owner/name, last pulled" with the time.
5. The space must have an empty plan, or one that holds only this repository's own pulled work. Otherwise it says "Clear the plan first (in Planner - Projects, Export and import, then Clear), or use a new space." Do that, or make a new space, and choose **Follow** again.
6. Following makes the board exactly **Inbox**, **Now**, **Next**, **Later** and **Done**, and pulls at once.
7. To stop, choose **Stop following** and confirm. The work stays in the plan as your own and can be changed again.

**The list lasts 15 minutes.** If you wait longer, or reload and come back late, it says "This link has run out. Go back and press Connect to GitHub again." Only the person who pressed **Connect to GitHub**, in that space, sees the list, and Chameleon keeps nothing of your GitHub sign-in: it reads your repositories once, then lets the sign-in go.

**A repository that is not in the list.** Under the list, **Is your repository not here?** opens a short help. Choose **Install on GitHub** (a new tab), install the app on the repository, then choose **Connect to GitHub** again. If the repository belongs to someone else, only they, or an administrator of their organization, can install the app on it. Choose **Copy** beside the address shown, send it to them, and press **Connect to GitHub** again once it is installed. You must also be able to see the repository on GitHub, or it never appears for you.

**A private repository.** The app can read one. The list says: "A private repository's issue titles and labels will be seen by everyone who can see this plan." Only the titles and labels are pulled, but they are then visible to anyone who sees the plan, so follow a private repository only when that is acceptable. It is your choice.

**A public repository, read only, with no app.** Under the list, and on its own when you have not connected, a folded **Follow a public repository (read only)** takes `owner/name` or a pasted address (such as `https://github.com/Coffee-Pub-Studio/coffee-pub-chameleon`, or the address of one of its issues). Choose **Follow read only**. It needs no app and no install, and nothing here can ever change GitHub. GitHub allows 60 such requests an hour for the whole server, which is enough for about ten spaces. A repository followed through the app has 5,000 an hour. A space that follows read only shows **Connect to GitHub** beside **Stop following**: use it to link the same repository through the app, so you can turn on writing.

**On a server with no GitHub app.** An owner there sees no **Connect to GitHub**. The line says "This server has no GitHub app." and the folded public box is open, so a public repository can still be followed read only. The administrator can fix this under "Register the GitHub app" in the Settings reference. If the app is set up but not working, the line says "The GitHub app on this server is not working. The administrator checks its settings."

**What you see.** The status bar starts with "From GitHub, pulled 3 minutes ago, 12 open of 40" (or, after a failure, the reason and "Trying again at 14:20."), and **Pull now** for anyone who may change the plan; it waits a minute between pulls. The server also pulls by itself about every 10 minutes. Each issue is a piece of work with its number ("#157") and a link, and its menu has **Open on GitHub** (a new tab). A closed issue is in **Done**; an open one is in **Now**, **Next** or **Later** when it has the label `priority: now`, `priority: next` or `priority: later`, and otherwise in **Inbox**. A GitHub milestone is a milestone, and its other labels are tags (when there is room, 20) or are named in the work's notes. Its days are the day the issue was made and the day it closed.

**Older closed issues.** A followed plan keeps the issues closed in the last 30 days (a number an owner sets in the follow control, never shorter than the current phase). The status bar says which day that is: "Issues closed before 29 October are on GitHub." The **Done** column's **...** menu has **Closed issues on GitHub**, a link (it opens in a new tab) to GitHub's own list of them. Neither shows while the plan is not following a repository, or when the server has no address for the list. The sentence is not itself a link, because a status bar item cannot hold one; the link is in the menu.

**An issue opens as "Issue #157"**, not as a form: an **Open on GitHub** link, then the **Title**, the **Description**, the **Comments**, **Done**, **Tags**, the plan's own fields, **Owners**, the **Milestone** and a **Target date**. The kind, **Starts** and **Ends**, **Waits on** and **Phase** are not shown, because a GitHub issue has none of them. The **Description** shows what the plan holds, then the whole text as GitHub has it. Someone allowed to change GitHub edits it in a box and chooses **Save description**; the main **Save** saves it too. If GitHub changed the text meanwhile, nothing is sent: the box shows GitHub's version and your own text stays in a box below it, "Your text, kept here", to copy from. The **Comments** run oldest first (the newest 100, with "N older comments are on GitHub." for the rest), each with who wrote it and when, as plain text. Someone allowed to change GitHub can **Add a comment**, and can **Edit** or **Delete** one made here (Delete asks first); a comment written on GitHub changes only there. **Owners** is the people picker, with "Also assigned on GitHub: octocat." for anyone assigned there whom no member has linked, read only. An Owner you choose is kept in the plan. The **Milestone** lists the plan's milestones that come from GitHub and "No milestone"; choosing another changes it on GitHub. The **Target date** is the one day an issue has here: leave it empty for none, or pick a day on or after the day the issue was opened ("The target date is before the day it was opened (Jan 4)." otherwise). It is kept in the plan, never sent to GitHub, and a target in the past marks the work **Late** until it is done. Someone allowed to change GitHub sets the title, **Done**, tags, description, comments and milestone there; anyone who may edit the plan sets the fields, the Target date and the Owners, which stay in the plan. If GitHub changed the title, **Done** or tags since you opened the window, the window shows GitHub's version and says what you typed.

**It is read-only** until writing is turned on. While following, nobody can add to, change, move or delete the plan or its board, or clear it: the page shows the work with no edit controls, and it says "This comes from GitHub. Change it there." The same sentence answers an agent that tries. To move work between columns, change its `priority:` label on GitHub, or ask an owner to turn on writing, below.

**Failures** show in the line and the status bar: "GitHub's terms are not accepted on this server. The administrator accepts them in Manage, Modules, Service terms.", "No such repository, or it is private." (a public read-only follow of a repository GitHub does not show), "GitHub refused this server's access.", "GitHub asked to wait." (it tries again after the time GitHub names), "GitHub did not answer." and "This plan holds at most 1000 entries; the rest are not pulled." When the app was taken off the repository: "The GitHub app is no longer installed on owner/name. Install it again and press Connect to GitHub, or stop following." When GitHub, or its owner, paused it: "The GitHub app is paused for owner/name on GitHub." A public repository still reads without the app meanwhile; a private one does not. After a reinstall, press **Connect to GitHub** again: Chameleon does not link a reinstalled app by itself.

## Turn on writing to GitHub

Following is one way until an owner turns on writing. With it on, some changes made in Planner - Projects are made on GitHub too. It is off to start. It needs the repository to be followed through **Connect to GitHub**, and it needs you to have the right to change that repository's issues on GitHub.

**Who:** the environment's owner turns it on. The administrator registers the app once for the server ([Settings reference](userguide-settings-reference.md), "Register the GitHub app"); there is no token to make and nothing to set per repository.

1. **Follow the repository through the app** (see "Follow a GitHub repository"). A repository followed read only cannot be written.
2. Open the space's **Set up**, then the **Modules** tab, and find **Follows GitHub**. Under the repository's name, turn on **Changes here go to GitHub**. The line under it reads "Moves, closes, titles and tags made here change the issues on GitHub. GitHub shows them as <app name>, <app-slug>[bot]."

The switch is dimmed when you could not change the repository on GitHub when you connected it (you had read access only, or a role that cannot change issues). The line then says "You can read this repository on GitHub but not change it, so changes stay read only here." Someone who can change it on GitHub connects it again. This is checked once, when the repository is linked; if your access on GitHub changes later, it holds until the space is linked again. A refusal otherwise reads "Connect this repository through the GitHub app to change it from here." (the space follows read only) or "The GitHub app may not change this repository."

**Who may change GitHub from here.** The permission **Change it on GitHub** (on the Roles tab, under **Module: Planner - Projects**): moderators have it by default, members and guests do not, and owners always may. Someone with **Add and change the plan** but not this sees pulled work read-only, as before. An [agent](userguide-agents.md) can change GitHub only when an owner ticks that row in the Agent column; it is off to start. Only the owner can link the repository or turn the switch on; a moderator, member, guest or agent cannot.

**What goes to GitHub.**

| In Planner - Projects | On GitHub |
|---|---|
| Moving work to **Now**, **Next** or **Later** | the label `priority: now`, `priority: next` or `priority: later` is put on, and the other priority label comes off |
| Moving work to **Inbox** | the priority label comes off |
| Moving work to **Done**, or its **Close** | the issue is closed as completed |
| Moving work out of **Done**, or its **Reopen** | the issue is opened again, and the column's label put on |
| A new title | the issue's title |
| Adding or removing a tag | that label (it must already exist on GitHub, else "GitHub has no label called ...") |
| **+** in a column | a new issue with that title and the column's label, and an empty description |

Never sent: the description, comments, who it is assigned to, and a delete (GitHub cannot delete from here; the menu says **Close** in place of **Delete**). Neither your name nor the space's or environment's name is written into GitHub. A title longer than the plan holds (120 characters) is not written back: "This title is longer than the plan holds. Change it on GitHub." The days, who is doing it and the order inside a column stay in the plan and are not sent.

**The change shows on GitHub as the app**, `<app-slug>[bot]`, with the app's own picture, not as the person who made it. Chameleon keeps who did it in its own record (an issue made here records the person, and an agent's changes are listed under **What it changed**).

**What you see.**

- The status bar gains "Changes go to GitHub" beside the "From GitHub" line.
- A card moved, ticked, renamed or tagged is drawn at once, but the plan keeps the change only when GitHub accepts it. If GitHub refuses, the card goes back where it was, a short message gives the reason, and the status bar shows "Not changed on GitHub" for a few seconds with the sentence when you hover it.
- A piece of work's menu says **Close** (or **Reopen** once it is done), and the **+** in a column asks "Add an issue to GitHub" for a title (hint "Area: what is wrong") and makes the issue.
- In the work's form, the title, the tags and **Done** can be changed; the rest is read-only with the line "The title, tags and Done change on GitHub. The rest comes from there."

**When GitHub and the plan disagree.** If the same field was changed on GitHub since the plan last pulled it (a close, a new title, other labels), GitHub wins: nothing is sent, the card shows GitHub's version, and it says "This changed on GitHub a moment ago. It now shows GitHub's version." A change to a different field goes ahead. The other sentences:

- "GitHub did not answer. Nothing was changed; try again."
- "GitHub asked to wait. Try again in 3 minutes." (the plan, and the pull, rest until then)
- "The GitHub app on this server is not working. The administrator checks its settings." (the app's key or secret was refused)
- "GitHub refused the change: <its reason>."
- "Only someone allowed to change GitHub can change this."
- "That issue is not on GitHub any more."

Changes are sent one at a time, about a second apart, so a long drag of many cards is a little slow. A refused change leaves the plan as it was.

**To turn it off,** switch **Changes here go to GitHub** off, or choose **Stop following**. Pulled work is read-only again, or yours again after **Stop following**. Uninstalling the app on GitHub stops every write at once; only the repository's owner can do that, and Chameleon never does.

## Where else it shows

It has no widget on Home. A dated entry shows in the Calendar. A milestone or a piece of work that names a phase counts toward that phase when the template measures phases by goals. A person adding through Chat's `/ai`, or another module's **Add to** menu, adds a milestone, work or a note, by the action chosen (see "Add from Chat, or from a file"); the AI Assistant can do the same. An [agent](userguide-agents.md) added to the space can also add entries, tick a milestone or work done, change an entry's title, days or notes, and move a piece of work to a column of the board (in front of another piece of work if it says which). What an agent does is done at once, with no one needing to open the plan, and it is listed under **What it changed** with **Undo**; an entry it adds records the agent, not a person, as who added it.

## Who sees what

A guest can see the plan when the **See the plan** permission allows it (it does by default) and cannot change it. A space whose template leaves the module out has no plan there, and the plan's data is kept: if the space changes template and back, it is as it was. Changing to a template with another planner starts that planner empty; nothing is copied or deleted.
