# Planner - Projects

**Audience:** a member planning a project with the Planner - Projects module on a Coffee Pub Chameleon server, and an owner setting it up.

Planner - Projects (module id `schedule`; the Schedule outline) plans one project for a space: **milestones**, the **work** that gets there with who does it and when, **notes**, and what **waits on** what. It is one of three planners; the others are the day-by-day [Planner](userguide-planner.md) and [Planner - Goals](userguide-planner-goals.md). A space has the planner its template lists: the Project template lists this one and shows it as **Project plan**, and the Games template shows it as **Campaign**, with its milestones read as sessions, its work as scenes and its tags as story threads. Under the Default template it is there too, with every other module. Which words you see below are the template's; the defaults are written here.

Who can: anyone who may **See the plan** (members, guests and moderators by default) sees it; **Add and change the plan** (members and moderators by default) adds and changes; **Clear the whole plan** (moderators by default) clears it. Owners always may. An owner changes who on the Roles tab, under **Module: Planner - Projects**.

## Set it up (owner)

1. On the Modules tab, choose **Install** beside **Planner - Projects**, then **Approve and enable**. It asks to link to other modules' objects. A space has it only if its template offers it (see [Modules](userguide-modules.md), "Which modules a space has"); to give a space a different planner, choose another template for it.
2. Its settings are the template's. Under the Project template the two switches below are set by the template and show "Set by the Project template.", read-only; the others are yours to change in the module's section on the space's **Set up**, **Settings** tab. To change a driven one, copy the template and edit your copy (see [Templates](userguide-templates.md)).

| Setting | What it does | Set by the template |
|---|---|---|
| **Dates are needed** | A milestone and a piece of work need dates. Off, dates are optional and the Timeline shows only the dated entries | Driven (Project: on; Games: off) |
| **Waits on** | Lets an entry say which others it waits on, and draws the lines between them | Driven (Project: on; Games: off) |
| **Progress counts** | What the plan's count says: **Milestones done** (the default) or **Work done** | Driven |
| **Opens on** | The view a space opens on, **Timeline** or **List** | The template's start; you may change it |
| **Tags** | The tags an entry may carry (the Games template seeds story threads) | The template's start; you may change it |

## Add to the plan

1. Open **Planner - Projects** on the canvas, or on its own page. Choose the **+** in its title bar, then **Add a milestone**, **Add work** or **Add a note** (with the template's words), or use the same choices on an empty plan. A milestone's menu also has **Add work under it**.
2. Fill in the form: **Title**; for a milestone **Starts** (its day); for work **Starts** and **Ends**, **Owners** (people of the space) and **Waits on**; **Phase** (one of the template's phases), **Tags**, **Part of** (what it sits under) and **Notes**. Choose **Add**.
3. To change one, open it from its row or bar; **Save** keeps it, **Delete** removes it.

A milestone is done when everything under it is done, or when you tick it. Work is done when you tick it. A note has no done. Each is an object like any other, so you can link a To-do task to one (it shows under the entry it links to), and see the dated ones in the Calendar. It does not take a drop of an object from another module the way the Itinerary does; link from the entry's form.

## The two views

- **Timeline.** Weeks across, work as bars, milestones as marks, and a line from an entry to what it waits on while **Waits on** is on. Entries with no day are listed under it in **Not scheduled** (an entry outside the weeks drawn, which run for at most two years, is listed under **Not on the Timeline**). It scrolls sideways inside its own frame.
- **List.** The outline: entries in order, with a fold button where one has others under it. Move an entry by dragging its handle, or from the handle's menu (**Move up**, **Move down**, **Indent**, **Outdent**), or with the keyboard on the focused handle: **Alt** with the up and down arrows to move, **Alt+Right** to indent and **Alt+Left** to outdent. Up and down walk the handles; left and right fold and unfold. On a phone there is no dragging: the handle shows as **...** and opens the menu. On a phone the List is the first view, unless you have chosen one yourself.

Under a template that measures its phases by goals, a phase is done when every entry that names it is done (see [Spaces](userguide-spaces.md), "Phases"). The title bar's count reads, for example, "2 of 4 milestones done".

## Where else it shows

It has no widget on Home. A dated entry shows in the Calendar. A milestone or a piece of work that names a phase counts toward that phase when the template measures phases by goals. A person adding through Chat's `/ai`, or another module's **Add to** menu, adds a milestone, work or a note, by the action chosen; the AI Assistant can do the same.

## Who sees what

A guest can see the plan when the **See the plan** permission allows it (it does by default) and cannot change it. A space whose template leaves the module out has no plan there, and the plan's data is kept: if the space changes template and back, it is as it was. Changing to a template with another planner starts that planner empty; nothing is copied or deleted.
