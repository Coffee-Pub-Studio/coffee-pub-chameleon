# Planner - Goals

**Audience:** a member planning what to learn or where to grow with the Planner - Goals module on a Coffee Pub Chameleon server, and an owner setting it up.

Planner - Goals (module id `goals`; the Goal outline) keeps a plan of **goals**, the **steps** under each and how far along each is, with dates optional. It is one of three planners; the others are the day-by-day [Planner - Itinerary](userguide-planner.md) and [Planner - Projects](userguide-planner-projects.md). A space has the planner its template lists: the Education template lists this one and shows it as **Learning plan**, and the Mentoring template shows it as **Development plan**, with the goal's owner read as **mentee**. Under the Default template it is there too, with every other module. The words below are the defaults; a template may rename a goal, a step, a note and an owner.

Who can: anyone who may **See the goals** (members, guests and moderators by default) sees them; **Add and change goals** (members and moderators by default) adds and changes; **Clear all goals** (moderators by default) clears them. Owners always may. An owner changes who on the Roles tab, under **Module: Planner - Goals**.

## Set it up (owner)

1. On the Modules tab, choose **Install** beside **Planner - Goals**, then **Approve and enable**. A space has it only if its template offers it (see [Modules](userguide-modules.md), "Which modules a space has"); to give a space a different planner, choose another template for it.
2. Its settings are in the module's section on the space's **Set up**, **Settings** tab. Two are set by the template and show "Set by the <template> template.", read-only; to change one, copy the template and edit your copy (see [Templates](userguide-templates.md)).

| Setting | What it does | Set by the template |
|---|---|---|
| **Dates** | **Optional** (a goal and a step may have a date, shown in the Calendar) or **Off** (no dates at all; a date a goal had is kept and comes back if dates do) | Driven |
| **A goal's progress** | **Its steps** (the share of its steps that are done) or **Done or not** | Driven |
| **Open on** | The view you open first, **Goals** or **List**. Each person's own choice wins | The template's start |

## Add a goal

1. Open **Planner - Goals** on the canvas or on its own page. Choose the **+** in its title bar, then **Add a goal** or **Add a note**.
2. For a goal give a **Title**, **Why** (optional), its **Owners** (people of the space), **Date** (optional, while dates are on), **Phase** (one of the template's phases) and **Link something**. Choose **Save**.
3. Add a step under a goal from the goal's card or its menu. A step has a **Title** and an optional **Date**; tick it **Done** when it is. A goal's progress follows its steps, or its own tick under **Done or not**.

A goal with steps is done when its steps are. Each goal, step and note is an object like any other: link a To-do task, a document, a research note or a Calendar session to one, and see the dated ones in the Calendar. It does not take a drop of an object from another module the way the Itinerary does; use **Link something** in the goal's form. A note has no done, so it is never counted.

## Add from Chat, or from a file

**From Chat.** The kinds of a plan, **goal**, **step** and **note**, are objects like any other, so an AI answer or a pasted file can hold them and Chat can send them here. **Keep** on one of these objects in an AI answer offers **Planner - Goals** (with the template's words), and a message's **⋮** menu > **Send to...** lists it as "<module> as a goal", "as a step" or "as a note". A goal carries its title, **why** (from the object's words, cut at 2000 characters), a day (1900 to 2200) and a **phase** (the phase's name or id, matched to the template's phases ignoring case; one that matches none is left out). A step carries its title, a day and **done**, and goes under a goal:

- **under**, the title of its goal, is matched to a goal already in the plan (or kept earlier from the same answer), ignoring case and spaces; if two goals have that title the most recently made one is used.
- A step needs a goal. With no goal in the plan with that title, the step is refused ("Add a goal first: no goal here is named \"<title>\".") and nothing is made; keep the goal first, then its steps. The action **Add a step to the goal** that other modules may ask for names the goal by a pointer, which is optional now; a step sent whole names its goal by **under**, and a pointer given wins over it.
- A note may sit under a goal or at the top.

**From a file.** The menu at the right of the title bar, **Export and import** (the button with two arrows), has:

- **Export as JSON** saves the whole plan as a file named for the day. It is dimmed ("Nothing yet") with an empty plan.
- **Check file** reads a file the way Import does and writes nothing. It says "This file is good: it would add N entries" with what they are (for example "2 goals, 5 steps and 1 note"), or "This file has a problem" (or "N problems") and lists them, the first and up to five more, one for each entry.
- **Import JSON: add to the plan** asks "Add <what> to the plan?" and adds the file's entries after what is there; the plan as it is stays, and every entry gets a new id.
- **Import JSON: replace the plan** (in red) asks "Replace the plan?" and takes everything out first. Choose **Replace the plan** to go on.

Check file and the two imports need the right to **Add and change goals**; replacing also needs **Clear all goals**. A file is read whole and checked before anything is written: if anything is wrong, nothing is imported and the first problem is said in one sentence. A file is at most 1 MB and 500 entries, and a plan holds at most 1000. After an import the page shows what was done with an **Undo** for 30 seconds. A step in the file needs a `parent`, the `id` of a goal in the same file. The file's fields, the rules and a complete example are in `FORMAT.md` in the module's source (`modules/goals/src/`); `goal-plan.schema.json` beside it is a JSON Schema (draft 2020-12) to check a file against before you bring it in.

## The two views

- **Goals.** One card per goal, with its progress bar ("2 of 4") and its steps. Anything under no goal is listed under **Not under a goal**.
- **List.** The outline: goals, with their steps and notes under them, two levels. Move one by dragging its handle, or from the handle's menu (**Move up**, **Move down**, **Indent**, **Outdent**), or with the keyboard on the focused handle: **Alt** with the up and down arrows to move, **Alt+Right** to indent and **Alt+Left** to outdent. Left and right fold and unfold. On a phone there is no dragging: the handle shows as **...** and opens the menu.

The title bar's count reads, for example, "1 of 3 goals done".

## Phases

Under the Education and Mentoring templates the phases are measured by goals: a phase is done when every goal that names it is done, and the status strip says how far ("Practice · 2 of 4"). A phase no goal names has a **Done** switch in Set up instead (see [Spaces](userguide-spaces.md), "Phases"). A goal names a phase in its **Phase** field.

## Who sees what

A guest can see the goals when **See the goals** allows it (it does by default) and cannot change them. A space whose template leaves the module out has no goals there, and what was written is kept: if the space changes template and back, it is as it was. Changing to a template with another planner starts that planner empty; nothing is copied or deleted.
