# Connecting Claude

**Audience:** an owner or the admin who has made an agent and a token and wants Claude to use them. You don't need to be a developer, but you will type a few lines in a terminal.

A token on its own does nothing. Claude has to be told where the server is and given the token. Chameleon has an address for this, `/mcp`, that Claude Code, the Claude apps (and other tools that speak MCP) can connect to. Once connected, Claude gets a short list of tools: look at the spaces, read a module's objects, read Chat, ask a module for a change and, if you allow it, post in Chat. It can do nothing an agent can't do; see [Agents](userguide-agents.md), "What an agent can and can't do".

## What you need first

All of this is in [Agents](userguide-agents.md). Check each one before you connect, because a missing one only shows up as "token not valid".

1. The person who runs the server has set `AGENT_TOKENS` to `true` and recreated the container.
2. **Agents** is switched on for your environment (**Manage**, **Users**).
3. You have added an agent, and added it to the spaces it should work in (the space's **Set up**, then **Members**).
4. You have made a token on the agent's page. It is shown once. Keep it where you can paste it.

Claude must also be able to reach the server's address. For Claude Code on your own computer, any address your computer can open will do. The Claude apps need a server that is public on port 443.

## The Connect Claude panel

You don't have to build the command yourself. Chameleon draws a **Connect Claude** panel in two places: in the window that shows the token once, and on the agent's page. It has the server's own address in it. In the token window it also has the token; on the agent's page afterwards it shows a placeholder where the token goes, because the token is never shown again.

The panel walks you through it:

- A line saying what it is for, and **You need Claude Code**.
- Five numbered steps: add the agent to a space, copy the command, open a terminal, type `claude`, and ask the first question.
- **What to say first**, with a **Copy** button. It holds: "Use the chameleon tools. Which spaces can you see, and what is in the to-do list?"
- **What to try next**, a few more things to ask.
- A live status that reads "Not connected yet" and then "Claude connected, <time ago>" once Claude has used the token.
- A space line that reads "Not in any space yet..." until you add the agent to a space, then "In 1 space: <name>".
- **Use a project file instead**, which shows the `.mcp.json` form (below).

The panel is the easy way to use Claude Code. The numbered steps below do the same by hand.

## Connect Claude Code

Claude Code worked against a real server, proven by Thomas on 2026-11-20: after the command below, `claude mcp list` showed `chameleon` as Connected.

Put the token in an environment variable, so it isn't typed into the command or saved in a file you might share. Name it `CHAMELEON_TOKEN`. Don't use a name Claude Code treats as its own credential, such as `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`.

1. In your terminal, set the variable to the token. For example: `export CHAMELEON_TOKEN=agt_...`
2. Add the server. Replace `YOUR-SERVER` with your server's address:

   `claude mcp add --transport http chameleon https://YOUR-SERVER/mcp --header "Authorization: Bearer $CHAMELEON_TOKEN"`

3. Check it: `claude mcp list` should show `chameleon` as Connected.
4. Start Claude Code in the usual way, with `claude`.

The command stores the header with the token's value in Claude Code's own settings on your computer. If you would rather keep the token out of that file, add the server to a `.mcp.json` file in your project instead, which reads the variable each time:

```json
{
  "mcpServers": {
    "chameleon": {
      "type": "http",
      "url": "https://YOUR-SERVER/mcp",
      "headers": { "Authorization": "Bearer ${CHAMELEON_TOKEN}" }
    }
  }
}
```

The variable must be set in the terminal where you start Claude Code. Don't commit a token into `.mcp.json`; the `${CHAMELEON_TOKEN}` form keeps it out.

## Check that it worked

The panel's live status turns to "Claude connected" once Claude has used the token. You can also ask Claude: "Run the `me` tool." It should answer with the agent's name and the spaces it is a member of. If it names the spaces you added it to, you are connected.

If it names no spaces, the agent hasn't been added to any. Add it (see above) and ask again.

## What to ask Claude to do

Say what you want in plain words and name the space. Claude finds the space and module ids itself with `me`. For example:

- "What is on the plan in the Moving house space?"
- "Read the Chat in Moving house and tell me what people still need to decide."
- "Add a milestone called Book the van to the plan in Moving house, for the 14th."
- "Tick off the milestone Pack the kitchen."
- "What changes can you ask for in Moving house?"

## What it can't do

The same as any agent: it can't delete anything, change settings, roles or members, join a call, use a private message, or see a space it isn't in. It has a member's rights and no more. The full list is in [Agents](userguide-agents.md).

## Reading and writing

Reading is at once: Claude reads what a member of those spaces can read.

A change is not. When Claude asks for one, the request waits until a person who may change that module has it open in that space. Their page then carries it out under the module's own rules. So Claude can say "I asked" before anything has changed. Open the module to let it through. Claude can ask how a request went with the `request_status` tool.

**Post in Chat** is off until you turn it on, on the agent's page. Until then Claude can read Chat but a post is refused with "This agent can't post in Chat."

## Limits

The agent may make 60 reads and 20 changes a minute, and 3,000 reads and 300 changes a day. A change is asking a module for something or posting in Chat. Every tool call counts as one read or one change. Opening a connection also costs about 4 reads before Claude uses any tool. When a limit is reached, Claude is told to try again in some seconds. The count starts again at midnight (UTC). Everything Claude does is in **What it did** on the agent's page.

## When the token ends

A token works for 30 days. After that Claude is refused until you make a new one: on the agent's page, under **Token**, choose **Make a new token**, copy it, and set `CHAMELEON_TOKEN` to it. Then start Claude Code again. The new token ends the old one.

## Stop it

To stop Claude at once, on the agent's page choose **Revoke** under **Token**. You can also **Turn off** the agent. See [Agents](userguide-agents.md), "Revoke a token" and "Turn an agent off".

## The Claude apps (web, desktop, phone)

The Claude apps work. Thomas proved it in a Claude app on 2026-11-20 against his own server: Claude used the Chameleon tools to read to-dos and add a calendar event. The steps below are the ones he used.

The apps connect from Anthropic's cloud, not from your computer. So your server must be reachable from the internet on port 443 (HTTPS). A server that is only on your own network can't be reached this way.

The apps have no sign-in with Chameleon (OAuth sign-in is not built). They use the token as a header instead.

1. Make a token for the agent and add the agent to a space (see [Agents](userguide-agents.md)). Copy the token.
2. In the Claude app, open **Customize**, then **Connectors**, and choose **Add custom connector**.
3. For the address, enter `https://YOUR-SERVER/mcp`.
4. For **Authentication**, choose **No sign-in**. Don't choose **Sign in now**. The form may mark **Sign in now** as "Detected", because the server's refusal says it wants a Bearer token. Chameleon has no sign-in page, so that choice can't work.
5. Open **Request headers** and choose **Add header**. For the name, type `Authorization`. For the value, type the word `Bearer`, a space, and then the token, for example `Bearer agt_...`.
6. Save the connector.
7. Start a new chat and turn the connector on for it. Then ask, for example: "Use the chameleon tools. Which spaces can you see, and what is in the to-do list?"

The value must start with `Bearer` and a space. With the token alone, the app shows "Connection issue: Couldn't connect to the server."

A connector is read when a chat starts, so turn it on in a new chat, not one that was already open.

### Claude in the cloud

A Claude Code session that runs in the cloud does not see a `claude mcp add` you made on your own computer. Connectors are read when a session starts. To use Chameleon from a cloud session, add it as a connector in your Claude account as above, then start a new session.

## Other ways in

These are pointers only. They have not been tried against Chameleon.

- **The Claude API.** Its `mcp_servers` parameter takes the server's `url` and an `authorization_token`.
- **The Agent SDK.** An MCP server of `type: "http"` takes a `url` and `headers`, the same header as above.

For the exact fields, follow Anthropic's documentation. The messages the server speaks are in [Agents API](../api/api-agents.md), Part 4.

## If it doesn't work

- **"401" or "That agent token is not valid."** One of these: `AGENT_TOKENS` is off on the server; **Agents** is off for your environment; the token has ended or been revoked; the agent is turned off or deleted; or the token was copied wrongly. Check each in [Agents](userguide-agents.md) and make a new token if unsure.
- **401 although the token is right.** Something between Claude and the server may be dropping the `Authorization` header: some hosts and proxies do. Ask whoever runs the server to check that the header reaches it.
- **`me` names no spaces.** The agent isn't a member of any. Add it.
- **"This request came from another site, so it was refused."** The request carried an `Origin` for a different site. Claude Code doesn't send one; a browser page does.
- **A change was asked for and nothing happened.** It is waiting for someone to open the module; see "Reading and writing".
- **The Claude app says "Connection issue: Couldn't connect to the server."** The header value most likely lacks the word `Bearer` and a space before the token. Edit the header so it reads `Bearer agt_...`. Also check that the server is public on port 443.
- **The form marks "Sign in now" as "Detected".** That is expected: the server's refusal names Bearer. Choose **No sign-in** and add the header instead; see "The Claude apps".
- **A cloud Claude Code session can't see Chameleon.** A `claude mcp add` on your computer isn't seen by a cloud session. Add a connector in your account and start a new session.
