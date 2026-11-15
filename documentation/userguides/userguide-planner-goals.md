# Planner - Goals

**Audience:** a member planning what to learn or where to grow with the Planner - Goals module on a Coffee Pub Chameleon server, and an owner setting it up.

Planner - Goals (module id `goals`; the Goal outline) keeps a plan of **goals**, the **steps** under each and how far along each is, with dates optional. It is one of three planners; the others are the day-by-day [Planner](userguide-planner.md) and [Planner - Projects](userguide-planner-projects.md). A space has the planner its template lists: the Learning template lists this one and shows it as **Learning plan**, and the Mentoring template shows it as **Development plan**, with the goal's owner read as **mentee**. Under the Default template it is there too, with every other module. The words below are the defaults; a template may rename a goal, a step, a note and an owner.

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

## The two views

- **Goals.** One card per goal, with its progress bar ("2 of 4") and its steps. Anything under no goal is listed under **Not under a goal**.
- **List.** The outline: goals, with their steps and notes under them, two levels. Move one by dragging its handle, or from the handle's menu (**Move up**, **Move down**, **Indent**, **Outdent**), or with the keyboard on the focused handle: **Alt** with the up and down arrows to move, **Alt+Right** to indent and **Alt+Left** to outdent. Left and right fold and unfold. On a phone there is no dragging: the handle shows as **...** and opens the menu.

The title bar's count reads, for example, "1 of 3 goals done".

## Phases

Under the Learning and Mentoring templates the phases are measured by goals: a phase is done when every goal that names it is done, and the status strip says how far ("Practice · 2 of 4"). A phase no goal names has a **Done** switch in Set up instead (see [Spaces](userguide-spaces.md), "Phases"). A goal names a phase in its **Phase** field.

## Who sees what

A guest can see the goals when **See the goals** allows it (it does by default) and cannot change them. A space whose template leaves the module out has no goals there, and what was written is kept: if the space changes template and back, it is as it was. Changing to a template with another planner starts that planner empty; nothing is copied or deleted.
