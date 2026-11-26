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
| **Tags** | The tags an entry may carry (the Gaming template seeds story threads) | The template's start; you may change it |
| **Follows GitHub** | A public GitHub repository, as `owner/name`, whose issues this plan shows as work. See "Follow a GitHub repository" | Not set by a template |

## Add to the plan

1. Open **Planner - Projects** on the canvas, or on its own page. Choose the **+** in its title bar, then **Add a milestone**, **Add work** or **Add a note** (with the template's words), or use the same choices on an empty plan. A milestone's menu also has **Add work under it**.
2. Fill in the form: **Title**; for a milestone **Starts** (its day); for work **Starts** and **Ends**, **Owners** (people of the space) and **Waits on**; **Phase** (one of the template's phases), **Tags**, **Part of** (what it sits under) and **Notes**. Choose **Add**.
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

Each column is a stage of the work. A space starts with **To do**, **Doing** and **Done**, or, under the Gaming template, **Inbox**, **Now**, **Next**, **Later** and **Done**. The count of cards sits beside each column's name. Inside a column, cards run by their end day (the ones with no day last), then in the order of the List.

**The card** says the work's title, its end day or "No date" (with **Late** when it is past), who is doing it, up to two tags and "and N more", the milestone it is under, and "Waits on" the first thing it waits on while that is not done.

**Move a card** (needs **Add and change the plan**):

1. Drag it to another column; or
2. choose the **...** on the card, then **Move to** and the column; or
3. with the card focused, press **Alt+Left** or **Alt+Right** to move it one column.

**Enter** on a focused card opens it to edit; the **...** menu also has **Edit** and **Delete**. Up and Down walk the cards in a column, Left and Right go to the next column. A screen reader hears, for example, "Moved "Write the brief" to Now." Someone without the right to change the plan sees the board and has no moves.

**Add work to a column.** The **+** in a column's heading opens the form for new work in that column.

**The List's tick.** A column can count as done. Ticking work in the List (or the **Done** box in its form) moves its card to the first column that counts as done, and unticking moves it to the first column that does not. Moving a card into a column that counts as done marks the work done, and out of it marks it not done. The List and the Timeline name the column under work's title when it is not the board's first column, so the views agree.

**On a phone** the columns are sections one under another, with the done columns folded, and there is no dragging: use the card's **...** menu.

### Change the columns

Each column's **...** menu has **Fold** or **Unfold**, which anyone may use (a folded column is a narrow strip, and your choice is kept in your browser). For someone allowed to change the columns it also has:

- **Rename**, which asks for the new name (at most 40 characters, not empty). The work stays in the column.
- **Move left** and **Move right**.
- **Counts as done**, on or off. The work in the column is marked done or not done to match, and so are the milestones above it. The board must keep at least one column that counts as done and at least one that does not: "Keep at least one column that counts as done." or "Keep at least one column that does not count as done."
- **Delete**, which asks which of the other columns takes its work; the work moves there and takes that column's done state. It is refused for the last column and, with the same two sentences, for the last column that counts as done or the last that does not.

The **Add a column** button above the columns asks for a name and adds the column at the end. A board has at most 12 columns: "A board has at most 12 columns."

Who may: **Change the board's columns** is its own permission on the Roles tab, under **Module: Planner - Projects**. Moderators have it by default; members and guests do not; owners always may. Moving a card needs only **Add and change the plan**. A person without it sees the **Fold** choice only, no **Add a column** button, and a change forced through is refused with "Your role can't do that in this module."

Each change to the columns shows an **Undo** for 30 seconds, which puts back the columns and any work that changed with them. A space still on its template's columns keeps them as they are until someone first changes them; that change makes the space's own board. If someone else changed the columns at the same moment, it says so and asks you to try again. **Export as JSON** carries the board, and **Import** brings it in (**Replace** always; **Add** only while the plan has no board of its own). A template author can rename the seven default column words (Inbox, Now, Next, Later, To do, Doing, Done) in the template's words for this module (see [Templates](userguide-templates.md)); a column someone has renamed keeps its own name.

### Rows and filters

**Rows.** Above the columns, **Rows** has three choices: **None**, **Milestone** and **Person** (the template's word for a milestone). With **Milestone** the board is drawn in rows, one for each milestone that has work shown, with the work that is under no milestone in a last row, "No milestone". With **Person** each row is one person, by the first person on the work, and the last row is "No one". Each row has a heading with a fold button, and the columns' headings stay at the top while the rows scroll. A card stays in its row: dropping it on another row moves nothing and says "Change the milestone in Edit." or "Change who is doing it in Edit."; to change the row, open the work and change it there. Moving a card to another column in its row works as before. The **Rows** choice is part of the board, so everyone sees it; it needs the same permission as changing the columns (**Change the board's columns**), and **Undo** puts the old choice back.

**Filters.** The toolbar's **Filters** button has **Who**, the tags (the template's word), **Phase** and the milestone. Each choice shows how many pieces of work it has. Choices in one group add up (any person chosen), and the groups combine, so work must match every group. **Clear filters** puts them all back. The status line says, for example, "Showing 4 of 12" and the template's word for work while a filter is on, and an empty result says "Nothing matches." The filter is yours: it is kept in your browser for this space, and nobody else sees it. A new piece of work added with **+** while a filter is on starts with what the filter chose (its milestone, phase, tags and, when one person is chosen, that person); if the filter would then hide it, the bar says "Added. The filter hides it."

## Follow a GitHub repository

A space's plan can show a public GitHub repository's issues as work, so the plan matches what is on GitHub. It goes one way, from GitHub to the space: nothing here changes GitHub.

**Who:** the environment's owner turns it on or off. The server's administrator accepts GitHub's terms once, first (see [Modules](userguide-modules.md), "The terms").

1. The administrator opens **Manage**, then **Modules**, finds **Service terms**, reads GitHub's terms and chooses **Accept**.
2. The owner opens the space's **Set up**, then the **Settings** tab, and finds **Follows GitHub** in Planner - Projects' section.
3. Enter the repository as `owner/name` (such as `Drowbe/coffee-pub-chameleon`, not a web address) and choose **Turn on**. The space must have an empty plan, or one that holds only this repository's own pulled work: otherwise it says "Clear the plan first, or use a new space." (use **Clear** on the module's menu, or make a new space).
4. Turning it on makes the board exactly **Inbox**, **Now**, **Next**, **Later** and **Done**, and pulls at once.
5. To stop, choose **Turn off** and confirm. The work stays in the plan as your own and can be changed again.

**What you see.** The status bar starts with "From GitHub, pulled 3 minutes ago, 12 open of 40" (or, after a failure, the reason and "Trying again at 14:20."), and **Pull now** for anyone who may change the plan; it waits a minute between pulls. The server also pulls by itself about every 10 minutes. Each issue is a piece of work with its number ("#157") and a link, and its menu has **Open on GitHub** (a new tab). A closed issue is in **Done**; an open one is in **Now**, **Next** or **Later** when it has the label `priority: now`, `priority: next` or `priority: later`, and otherwise in **Inbox**. A GitHub milestone is a milestone, and its other labels are tags (when there is room, 20) or are named in the work's notes. Its days are the day the issue was made and the day it closed.

**It is read-only.** While it is on, nobody can add to, change, move or delete the plan or its board, or clear it: the page shows the work with no edit controls, and it says "This comes from GitHub. Change it there." The same sentence answers an agent that tries. To move work between columns, change its `priority:` label on GitHub (the repository can run a workflow that keeps the labels in step with a project board; that is the repository's setting, not Chameleon's).

**Failures** show in the status bar: "GitHub's terms are not accepted on this server. The administrator accepts them in Manage, Modules, Service terms.", "No such repository, or it is private.", "GitHub refused the token set on this server.", "GitHub asked to wait." (it tries again after the time GitHub names), "GitHub did not answer." and "This plan holds at most 1000 entries; the rest are not pulled." The server's administrator can raise GitHub's limit with a token ([Settings reference](userguide-settings-reference.md), "Following a GitHub repository"). Only public repositories can be followed; nothing about you or the space goes to GitHub.

## Where else it shows

It has no widget on Home. A dated entry shows in the Calendar. A milestone or a piece of work that names a phase counts toward that phase when the template measures phases by goals. A person adding through Chat's `/ai`, or another module's **Add to** menu, adds a milestone, work or a note, by the action chosen (see "Add from Chat, or from a file"); the AI Assistant can do the same. An [agent](userguide-agents.md) added to the space can also add entries, tick a milestone or work done, change an entry's title, days or notes, and move a piece of work to a column of the board. What an agent does is done at once, with no one needing to open the plan, and it is listed under **What it changed** with **Undo**; an entry it adds records the agent, not a person, as who added it.

## Who sees what

A guest can see the plan when the **See the plan** permission allows it (it does by default) and cannot change it. A space whose template leaves the module out has no plan there, and the plan's data is kept: if the space changes template and back, it is as it was. Changing to a template with another planner starts that planner empty; nothing is copied or deleted.
