# Manage

**Audience:** an owner or the admin running a Coffee Pub Chameleon environment, working through the Manage page.

Manage has five parts under **Environment** (**General**, **Localization**, **Reactions and Icons**, **Welcome note** and **Stream**). Open the Manage page with the gear button in the top bar, beside **Set up** (owners and the admin; in the narrow layout it is in the menu under your picture). It has seven tabs, in this order: **Environment**,
**Template**, **Theme**, **Spaces**, **Roles**, **Users** and **Modules**, plus **About**. In the narrow layout the row of tabs scrolls sideways within itself, and the row of parts under **Environment**, under **Template** and on a module's page wraps onto as many lines as it needs on a phone (640 pixels or less), so every part shows. (Old addresses still work: `/admin#server` and `#settings` open Environment, `#rooms` opens Spaces, and `#words` and `#home-icon` open the Template tab at that section.) Manage's tabs are in the bar under the top bar. The pages reached from here (a person's profile, a module's configuration, the AI configuration) have **Manage** at the start of that bar, to come back. Only owners and the admin (on a hosted server, the host admin) see it; anyone else asking for it is told "Owners only."

## Environment

- **Environment** (a hosted server only). The plan's name, each cap with what is used, the overdue banner when a payment has lapsed, **Download a copy** and **Ask for deletion**. See [Your environment](userguide-environments.md).
- **Name and icon.** The **Name** shows in the top bar and the browser tab. The icon is any image;
  it is used in the top bar's logo box (in place of the home icon), as the favicon, and on the sign-in page. Click it to change it, or paste a
  picture (see "Set a picture" in [Participant and Character Images](userguide-images.md)), and the
  small **x** over its corner to clear it.
- **Welcome note.** A short text people see once at their first sign-in. See [The welcome note](userguide-welcome-note.md).
- The home icon, the words and the module names belong to a template, and are on the **Template** tab's pages (below). Your own reactions and icons are on this tab's **Reactions and Icons** part (below).
- **Call features** (on the Conference module's tab, under **Modules**). Turns screen sharing, asides, private conversations and reactions on or off for
  everyone, and sets the highest video quality anyone can pick.
- **Calendar sharing.** One line, "Calendar sharing is set in Calendar's configuration.", links to the Calendar's configuration page, where the calendar switches are now (see "Calendar sharing (owner)" in [Calendar](userguide-calendar.md)). The **Top bar** and **Calendar apps** sections that used to be here are gone; their switches moved to the Calendar's and Maps' configuration pages (see "Top bar" below). The line shows only while a module that takes part in calendar sharing is installed.
- **Sign-in page.** A background picture behind the sign-in box, the text under the password field, and **Require two-step sign-in for everyone**: off (the default: anyone may set up an authenticator app on their profile) or on (everyone must, from their next sign-in; a session already open keeps working); see "Two-step sign-in" in [Accounts, roles and permissions](userguide-accounts.md). The switch is not shown when the server does not offer two-step sign-in (`ENABLE_MFA` in the compose file). The Users tab marks accounts that have set it up. Click the picture to upload your own, paste one, or choose **Choose from the library** for one of the pre-made backgrounds that ship with Chameleon (filter by theme and style, pick one, **Use this background**). New pre-made images are added by putting files in `public/assets/images/backgrounds/`; see the README there for the format and file names.
- **Sign-up.** Self-service `/register` on or off, and invite links into specific spaces. See
  [Accounts, roles and permissions](userguide-accounts.md).
- **Guests.** On the **Users** tab, a section of its own (not part of Sign-up): whether guests can come in from the sign-in page here (the host's choice, shown as one plain line when it is off), the next step for you (set a space's **Who can enter** to **Anyone, including guests**), and **End all guest sessions now**. See "Guests without a link" in [Accounts, roles and permissions](userguide-accounts.md).
- **Access key.** The key that a keyed page's link carries in place of a sign-in (the Stream module's
  OBS views, `?s=...`). Show, copy or regenerate it; regenerating stops every existing link working.
  How the OBS boxes look (borders, the name plate, dimming) is the Stream module's own settings now; see
  [Chameleon in OBS](userguide-obs.md).

## Top bar

Owners and the admin can add two pages of their own for the whole environment: **Global Calendar**, the Calendar and the To-do together, and **Global Map**, the map and Places together. They are separate from the **Calendar** and **Map** tabs inside a single space. Both are off unless you turn them on; an environment made from the Travel template starts with both on. Where they show: in the profile menu under each person's picture (wider than the narrow layout), or in the top bar's menu after the spaces (in the narrow layout), under their module's name and icon after the word Global. The setting is still called **Show in the top bar**.

1. Open Manage on the **Modules** tab.
2. Choose **Module Configuration** on the Calendar's card (for Global Calendar) or on Maps' card (for Global Map).
3. Under **Top bar**, switch on **Show in the top bar**. Its line reads "Adds Calendar to the top bar: events and tasks from every space in one place." on the Calendar's page and "Adds Maps to the top bar: places from every space on one map." on Maps' page, with the names your environment gives those modules. The switch saves as you flip it.

These switches used to be in a **Top bar** section on the Environment tab; they are the same settings, so what you had chosen there still holds.

A switch that can't work yet is shown off and greyed, and its line says why instead: "Turn on Calendar on the Modules tab first.", "Turn on Maps on the Modules tab first.", or, for Map without a map file or a picture map, "Choose a file for "Map files" in Maps' settings first." (on a hosted server, "Ask the host's admin for a file for Maps."). The names are the ones your environment gives those modules. Each page shows only to people who may see its module for the whole environment, never to guests. How they work: [Calendar](userguide-calendar.md), "Global Calendar", and [Maps](userguide-maps.md), "Map in a space and Global Map".

## Language, time and money

On the Environment tab. **Language** is the interface language (English, until translations arrive). **Clock** is how every time is shown, across the environment and every module: 12-hour (10:30 PM, the default) or 24-hour (22:30). **Currency** is the one amounts are shown in (the Planner's costs and settling up), unless a trip names its own currency in Edit trip. The list has a **Common** group first, then **All currencies**, each by its name in your language: exactly the currencies the server accepts. The server refuses any other code ("XYZ is not a currency this server knows. Choose one from the list, such as USD."). A code saved before this check keeps working and still shows in the list. A trip in the Planner picks its own currency from the same list. Showing a trip's own currency with a conversion beside it needs a source of exchange rates, which is not set up yet.

## Reactions and Icons

On the **Environment** tab, **Reactions and Icons** is yours: they are the whole lists for this environment, and every template adds on top of them. A template can add reactions and icons but never takes one of yours away. A new environment starts with the built-in set (105 reactions and 113 icons), and from then on the lists are yours to change. An environment that existed before this change was given the built-in set once, and what its owner had added before was not kept: add those again by hand.

Owners only. The part opens with **Start again from the built-in set**, which asks you to confirm and then puts both lists back to the built-in set; your changes to them are lost. Below it are the **Reactions (n)** list (open) and the **Icons (n)** list (folded). A **Save reactions** and a **Save icons** button stay on the screen at the foot of the part while you scroll.

1. Open **Manage**, then **Environment**, then **Reactions and Icons**.
2. In **Reactions (n)**, each row has the emoji, its label and three buttons: **Move earlier**, **Move later** and **Remove**. Change a row, or click **Add reaction**. The first six reactions are keys **1** to **6** in a call, so move the ones you want there to the top. Any reaction may be removed, built in or not.
3. Click **Save reactions**.
4. In **Icons (n)**, add icons you want available: paste an icon's HTML from fontawesome.com, for example `<i class="fa-solid fa-dice"></i>`, and the preview shows it. Move, change or remove rows as for reactions. Only the Free solid icons that ship with Chameleon will draw, unless you have added your own Pro package (see "Font Awesome Pro" under Theme).
5. Click **Save icons**.

Each list scrolls in its own box. An empty reactions list is allowed: the call then has no reaction button and no tray. The most a list can hold is 300 reactions and 400 icons. These icons are the choices offered for a space's launch link, the home icon and a module's icon. If you remove an icon that something is already using (the home icon, a space's link, a module, a saved layout), it keeps drawing there but is no longer offered as a choice. Reactions are switched off for everyone with **Allow reactions** under **Call features** on the Conference module's tab (**Modules**, then **Conference**), not by emptying the list.

A template can add reactions and icons of its own; they show on the template's **Additional Reactions and Icons** page and appear in the spaces that read it, after yours. One it adds that your list already has (the same reaction, or an icon with the same id) is left out, not shown twice. What a template adds is read from the template while a space reads it, and is never copied into your own list: switch to another template and its icons leave the pickers (a space or a home page that is already using one still draws it). Saving a layout, a space or the home page with the icon it already has always works; choosing a different icon needs one that is on the list. An old link to `#reactions` or `#icons` on the Manage page opens this part.

## Template

The **Template** tab holds what a template gives this environment. It is a short page and one page for each part, each at its own address (`#template/<template id>/basics` and so on), with a row of buttons across the top to move between them: **Template**, **Environment Basics**, **Experience Labels**, **Default Workspace**, **Phases**, **Additional Reactions and Icons**, **Modules** (with your environment's words) and **Templates**. How a template reads, and what is in the shipped ones, is in [Templates](userguide-templates.md); this is where to find each part.

- **Template.** The page you land on. It names the template the environment uses ("Uses the Travel template." with its version), and has **Default template**, a choice of every template you may use, with **Switch**. Every environment has one: a new one with none picked uses **Default**, which has the usual words and every module. See "Switch a template" in [Templates](userguide-templates.md). While a switch has more to offer, the tab shows a small badge and a **Review** button.
- **Let a space use its own template.** A switch under **Space templates** (with your environment's word), on by default, saved as you flip it. On, an owner or the admin can pick a template for a space (see "A space's own template" in [Spaces](userguide-spaces.md)). Off, every space reads this environment's template; what each space chose is kept and comes back when it is turned on again.
- **Environment Basics.** Of the template you pick at the top of the page: **Template Name**, **Template Description**, **Home Icon** (the icon in the top bar's logo box, beside the environment's name, when no environment icon is uploaded) and **Default Profile Image** (what a new space starts with).
- **Experience Labels.** The words people read: **Words you can change** (a space and a member; see "Words" below), the home page's name and the Lobby's name and description for the template the environment uses, then the words each module lets a template rename, one group for each module the template offers (for example **Effort** in Project's Budget; a word left blank reads the module's own), and **Words that never change**, listed so you can see them.
- **Default Workspace.** What a new space's Workspace opens with, which Fixed Workspaces a new space shows, and which opens first. A Fixed Workspace shown here is shown for everyone; nobody can hide it.
- **Phases.** The phases, in order, and **Measured by**: **Dates**, **Goals** or **Progress**.
- **Additional Reactions and Icons.** Under **This template adds**, only what this template adds; the page says "Added on top of the environment's set." Above it, the environment's own set is shown read only and folded (for example **Reactions (105)**); you change it on the Environment tab, under **Reactions and Icons**, and the page's text links there. A reaction or icon the template adds that the environment's set already has is marked "Already in the environment's set, not added again." That mark compares a new reaction by its emoji only, so a new reaction whose id would match an existing one is not marked ([known-issues](../known-issues.md)).
- **Modules** (the environment's word). One row for each module there is: whether this template offers it, **Shown as** (its name and icon), its settings the template drives or seeds (a list setting is edited as rows of a label, an icon and a colour, as on a module's own settings) and its starter content. The words a module lets a template rename are on **Experience Labels**. The three planners sit together under **Plans**. This is the template's page; **Manage > Modules** is only what is installed.
- **Templates.** Every template you may use: the Default template and the shipped ones, each with **Open**, **Copy**, and **Export**, and your own with **Edit** and **Delete**, then **Import a file**.

The Default template and a shipped template are read-only on every page, with **Copy to change it**. Copy one to make your own, then edit that. Only the host edits a shipped template. Manage has no page for a template's call settings or starter spaces; a copy keeps those of the one it was copied from, and the host console edits them.

## Words

Under **Experience Labels**, you set what people in this environment read for the words you can change: **space**, **member** and the **home page**. A travel group might call a space a "trip" and a member a "traveller". Every other word reads the same everywhere (environment, aside, canvas, module, object, owner, moderator, guest, and the host's own host and admin), and so do the words on the buttons for entering a space (**Enter**) and for the canvas layout: a template can't change them and neither can you.

1. On Manage > **Template**, open **Experience Labels** (for the template your environment uses; a shipped one is read-only, so **Copy to change it**). **Words you can change** has a row for each word, showing its default. The **Home page** row is what the list of spaces is called in the top bar; blank, it follows the space word ("Spaces", or "Trips" where a space is a trip), or the template's own word when it gives one. It is a name, so type it as it should read, capital included ("Campaigns"); it has no article field.
2. Type the new word in lower case: its **Singular** and its **Plural** (both are needed). Capitals are added where a sentence needs one.
3. Fill in **With its article** only when the usual "a" or "an" is wrong for it, such as "an hour". Leave it blank otherwise.
4. Click **Save**. Every word is saved together, and if the server refuses one, nothing is saved and the message says which word and why: it needs both its singular and its plural, it can be at most 30 characters, or it can use only letters, spaces, hyphens and apostrophes.

A blank row uses the default. A word you set yourself wins over the template's, and a template's words follow it: change the template and they change at once. **Reset** on a row puts that word back at once. Only owners (and the admin) can change the words. Under the Default template's pages, **Experience Labels** also holds the **Lobby name** and **Lobby description**.

Everything people read in this environment follows: the pages, the server's messages, the Roles grid, the texts of the built-in modules, the names new spaces get ("New trip", "Trip 3"), and the bundled modules' own words. The text a module's `module.json` carries (its description, its settings' labels and help) still uses the default words; a module's own renameable words (its labels, for example "event" read as "meeting") follow the template, on the **Modules** page.

## Theme

- **Theme.** The environment's colours, in a light and a dark version, with **Dark by default** choosing which one
  people see until they pick their own. Choose a theme, change its colours, preview, then **Apply**; **Export** and
  **Import…** share a theme as a file. See [Creating themes](userguide-themes.md).
- **Default Images.** The Participant pictures a member shows once neither they nor the space they are
  in has set one; the last fallback before the box goes transparent.
- **Guest images.** The Participant pictures every guest shows, since a guest has no account of their
  own.
- **Font Awesome Pro (optional).** If you have a Pro licence, drop your own "Web" download from your
  Font Awesome account (the folder with `css/`, `webfonts/` and `svgs/` in it, the Classic style) at
  `DATA_DIR/fontawesome-pro/` on the server and restart it. Chameleon serves and draws from it ahead of
  the bundled Free set, falling back to Free for any style or icon it does not have. Nothing about your
  licence or your package ever leaves your own server: it is never built into the shared image, never
  uploaded, and no token for it lives in this repository.

The tab has no reactions or icons of its own: yours are under **Environment**, **Reactions and Icons**.

## Spaces and Users

Both are rosters: a thumbnail, a name and a link to that one thing's own page. A space's button, **Edit** with your environment's word for space (such as **Edit trip**), enters the
space and opens its **Set up** panel; the old settings page is gone (see "Set up" in [Spaces](userguide-spaces.md)). See also
[Accounts, roles and permissions](userguide-accounts.md).

The Users tab also has the **Agents** switch and **Add an agent**, for accounts that work through a token instead of signing in; an agent's row reads "<name> (agent)" and **Open** goes to its own page. See [Agents](userguide-agents.md).

## Roles

The grid of what each role can do. See [Accounts, roles and permissions](userguide-accounts.md).

## Modules

Upload and manage add-on features: what is installed and on, and each module's own settings. See [Modules](userguide-modules.md). Which modules a space has is its template's (**Template**, **Modules**); there is no per-space switch. The **AI Assistant** has a tab of its own here, with the AI setup (see [Assistant](userguide-assistant.md)). **Module Configuration** on Maps' card also holds the **Picture map**, the upload that replaces the
world map with your own picture (see "Picture map" in [Maps](userguide-maps.md)); the largest file it takes is
`MAP_IMAGE_MAX_MB` in the compose file, 100 megabytes unless set.

## About

The version, the licence, and the credits for the open-source software Chameleon is built on. The product's name is printed once.

Under **Open-source software** the tab lists, in groups, the software and open data the product uses, each with what it is for, its version, its licence and a **Website** link. Open **Licence text** on a line to read the notice its licence asks us to show and where the full text is kept. Our own artwork, such as the background pictures, is listed too, with the plain line "Made by Coffee Pub." and no licence or link. The list loads the first time the tab opens; if it does not, a line says so and opening the tab again retries.
