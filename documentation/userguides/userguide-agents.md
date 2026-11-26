# Agents

**Audience:** an owner or the admin who wants to let Claude, or another assistant, work in some of the environment's spaces. Nobody else sees any of this: members and moderators have no Manage page.

An **agent** is an account for an assistant, not a person. It can't sign in, has no password and never appears in the call. It works through a **token**, a long secret you make for it and give to the assistant once. With the token the assistant can read what a member can read in the spaces you add it to, and ask the modules there to make a change, for example to add a milestone to the project plan or tick one off. Everything it does is marked as the agent's and kept in a log you can read.

## What an agent can and can't do

It can:

- Read the objects of the spaces it is a member of (the plan, the to-dos, the notes) as a member does.
- Read the public messages in the Chat of those spaces, always. It never sees a private message.
- Post a plain-text message in Chat, only while you have turned on **Post in Chat** for it (see below).
- Ask a module to add or change something, when the module offers that as a change it can make: for example add a milestone or tick one off in Planner - Projects, add a stop or change a flight's gate in the Itinerary, add or change an event in the Calendar, or end a poll. The change is made at once and the agent is told how it went.
- Ask a person to delete one object, only while you have turned on **Ask to delete** for it (see below).
- Read the weather on the days of a module that has days, such as the Itinerary, or at the space's own place, when weather is set up (the Weather module is on, a service is chosen and the administrator has accepted its terms).

It can't:

- Sign in, join the call, or use any page.
- Delete anything by itself, clear a module, restore a copy, upload a file, or change a setting, a role or a member. It can only ask a person to delete one object, and nothing goes until a person approves that ask.
- See any space it hasn't been added to, the Lobby, or anyone's private data.
- Delete or change a message in Chat, send a private message, use a command or ask the AI. It can only read the public messages and, if you allow it, post.
- Make another token.

An agent has a member's rights and no more. If you take a permission from members on the Roles tab, the agent loses it too. It also needs **Send chat messages** on the member role to ask for a change, as any member does.

A change an agent asks for is made at once, under the module's own rules and the agent's rights, with no page open. If a rule refuses it, the agent is told in one sentence and nothing changes; a change that is half done is put back. The agent's edits are not approved one by one, but you can see and undo them (see "What it changed" below). A module you uploaded yourself is the exception: the server carries out its requests only after the admin has approved it to run on the server, and only on a server set up for it ([Modules](userguide-modules.md), "Let an uploaded module act for agents"). Until then the agent is told so at once and nothing is made.

## Turn agents on

Two things have to be on, and only one is yours.

1. **The server.** The person who runs the server sets `AGENT_TOKENS` to `true` and recreates the container (see the [Settings reference](userguide-settings-reference.md), "Agents"). Until then **Manage**, **Users**, **Agents** says "Agents are off on this server. The person who runs the server sets AGENT_TOKENS=true and restarts it." and offers nothing.
2. **Your environment.** Open **Manage**, then **Users**. In the **Agents** section, switch on **Let this environment have agents** (the words follow your template). It saves as you switch it.

Turning the switch off again makes every agent's token stop working at once. The agents and their log stay, and you can switch it on again.

## Add an agent

1. Open **Manage**, then **Users**, and choose **Add an agent**. (The button shows only while the switch above is on.)
2. Type a name, or keep **Claude**, and choose **Add**. The name can't end in "(agent)" or have "carried out by" in it.
3. The agent's page opens. Its row in the list reads "Claude (agent)", with "no sign-in" in place of a login.

An agent shows a default bot image where a person would show initials, unless you set an image for it. Everywhere a name shows, the agent's has "(agent)" after it, so it can't be taken for a person, even if you name it after one.

## Add it to a space

An agent works only in the spaces it is a member of, and it is a member of none until you add it.

1. Enter the space and open its **Set up**, then **Members**.
2. Switch on "Claude (agent)", as for any member. It has no moderator tick.
3. Save.

To take it out of a space, switch it off the same way.

## Make a token

1. On the agent's page, under **Token**, choose **Make token**.
2. A window shows the token once, with **Copy**. It reads "This is shown once. If you lose it, make a new one; the old one then stops working." and the day it works until.
3. Choose **Copy**, put the token where the assistant keeps its secrets, and choose **Done**.

Treat it like a password. Never paste it in a chat, a commit or an issue. It works for 30 days. After that, or when you want to replace it, choose **Make a new token** (the button's name once there is one): the new one ends the old. Under **Token** you see when it works until and "Last used <time> from <address>", or "Not used yet."

If you lose a token you can't see it again; make a new one.

## Let it post in Chat

An agent can always read the public messages in the Chat of its spaces. It can write there only when you allow it, and it is off for a new agent.

1. Open **Manage**, then **Users**, and open the agent's page.
2. Under **Chat**, switch on **Post in Chat**. It saves as you switch it.
3. To stop it, switch it off. That stops posting only: it can still read Chat and ask modules for changes.

You can turn it on only while agents are on for the server and for your environment; if they are not, the page shows the server's sentence and the switch goes back.

Its messages show the agent's name and a small **agent** mark, so nobody takes them for a person's. A message is plain text, up to 1000 characters; a longer one is refused, not cut. It needs **Send chat messages** on the member role, and the same limit on messages a minute that a person has. The AI Assistant also reads an agent's message as "<name> (agent)".

Anything people write in Chat, guests included, can reach the assistant that reads it. Someone could write words meant to steer it. Nothing on the server stops that. What stops the harm is that it can only write through a module's own rules, or in a labelled message, within its limits, and everything it does is in its log. Add an agent only to spaces whose Chat you are happy for it to read.

## Connect Claude

A token does nothing until the assistant has it. [Connecting Claude](userguide-connecting-claude.md) says how to give it to Claude Code or a Claude app, how to check it works and what to ask. The agent's page and the window that shows the token once both carry a **Connect Claude** panel with the command filled in, five steps, a first thing to say and a live status ("Not connected yet", then "Claude connected").

## Revoke a token

On the agent's page, under **Token**, choose **Revoke** and confirm **Revoke**. The token stops working at once. The agent stays, and you can make a new token.

## Turn an agent off

Under **Turn off or delete**, choose **Turn off**. The agent shows **Off** and its token does nothing until you choose **Turn on**. You can't make a token for an agent that is off. Use it when you want to stop it for a while without revoking the token.

The quickest stops, smallest first: **Revoke** the token, **Turn off** the agent, switch **Agents** off for the environment, and, for the person running the server, set `AGENT_TOKENS` back to `false`.

## Delete an agent

Under **Turn off or delete**, choose **Delete** and type the agent's name to confirm. Its token stops working. What it added to a plan or list stays, and keeps its name.

## Let it ask to delete

An agent never deletes by itself. To let it ask:

1. Open **Manage**, then the **Roles** tab.
2. In the **Agents** group, tick **Ask to delete** (it names your environment's word for objects) in the **Agent** column. It is off to begin with.

With it on, the agent can ask a person to delete one object, for example one poll or one task, and give a short reason. Nothing is deleted until an owner, the admin or that space's moderator approves that one ask. The agent can have 10 asks waiting and make 30 a day; after you decline an ask it can't ask about that object for 7 days. An ask not answered in 7 days ends.

### Answer an ask

You are told in three places: the bell shows "N asks from agents wait for you" (and one line for each ask), a space shows an **Agents** entry beside **Set up** with a badge, and the agent's page shows **Waiting for you**. The **Agents** entry is shown only to that space's owners, the admin and its moderators, and only while something waits or changed in the last 7 days.

1. Open the bell line, or choose **Agents** in the space.
2. Under **Waiting for you**, choose **Approve** or **Decline** on an ask.
3. **Approve** opens "Delete the <kind> "<title>"?": what it is, where it is, who asked, what goes with it, how many objects link to it and the agent's reason. Choose **Delete** to delete it, or **Decline**. Close or Escape answers nothing.

If you can't approve it (the module's own rules don't let you delete that object), the reason shows greyed where **Approve** would be, and you can still **Decline**. If the object changed after the agent asked, the ask ends with "That changed since <agent> asked. Nothing was deleted." Each ask is answered once.

### What it changed

Under **What it changed** (on the space's **Agents** view and on the agent's page) is everything an agent added, edited or deleted in the last 7 days, newest first, each with **Undo**. Undo puts the earlier value back, or the deleted object back with what went with it, and works only if nobody changed it since; if it can't, the reason shows in grey ("That has been changed since, so undo would lose that change."). A change can be undone by someone who could have made it themselves.

## What it did

At the bottom of the agent's page, **What it did** lists what the agent has done, newest first, in plain words, each with the time and the address it came from:

- "Ask for add milestone in <space>": it asked a module for a change.
- "Connected through MCP (4 messages)": Claude opened a connection; its opening messages are folded into this one line.
- "Read <module name> data in <space>" (the module as your environment names it), "Searched objects", "Listed what it can ask for", "Checked on a request": it read.
- "Read Chat in <space>": it read the Chat. "Posted in Chat in <space>": it wrote a message. "Refused post in <space>": it tried to post and the server said no (for example **Post in Chat** is off). The log never shows what was written or read.
- "Over its limit": it did more than it may in a minute or a day.
- "Token refused": it called with a token that no longer works (revoked, ended, or the agent is off).
- "Refused: GET /api/users/:x" and the like: a call to something an agent may not use, or with a method that route does not allow, with the status the server gave. The address is shown as a shape, never as the path the agent asked for.
- A line that says "didn't work" with a number is a call the server refused.

The list shows 100 lines; choose **Show older** for more. Lines are kept for 30 days. The log never holds what the assistant read or wrote, only what it did and where.

In Manage's module activity list, a change an agent asked for reads, for example, "Claude (agent), carried out by Mia's page", naming the agent and the person whose page made the change.

## Limits

An agent may make 60 reads and 20 changes a minute, and 3,000 reads and 300 changes a day. A Chat post counts as a change, even when it is refused; reading a page of Chat counts as one read. Past that, the server answers "The agent has done as much as it may for now." and the log says "Over its limit". The day's count starts again at midnight (UTC).

## Rename

On the agent's page, change the name and choose **Save name**.

## Good to know

- A member can't see agents' tokens or logs, and an agent's token can't reach Manage.
- A change an agent asks for is made when it asks, not when someone opens the module (an uploaded module the admin has not approved is refused, not made later). If a plan looks unchanged, check **What it did** and **What it changed**.
- What the assistant does with what it reads is up to it. Anything people write in a space can end up in front of it, so make an agent a member only of spaces whose content you are happy for it to read.
- Next, [Connecting Claude](userguide-connecting-claude.md).
- The routes are in the [Agents API](../api/api-agents.md); how it is built is in [Agent access architecture](../architecture/architecture-agent-access.md).
