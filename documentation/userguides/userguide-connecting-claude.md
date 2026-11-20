# Connecting Claude

**Audience:** an owner or the admin who has made an agent and a token and wants Claude to use them. You don't need to be a developer, but you will type a few lines in a terminal.

A token on its own does nothing. Claude has to be told where the server is and given the token. Chameleon has an address for this, `/mcp`, that Claude Code (and other tools that speak MCP) can connect to. Once connected, Claude gets a short list of tools: look at the spaces, read a module's objects, read Chat, ask a module for a change and, if you allow it, post in Chat. It can do nothing an agent can't do; see [Agents](userguide-agents.md), "What an agent can and can't do".

## What you need first

All of this is in [Agents](userguide-agents.md). Check each one before you connect, because a missing one only shows up as "token not valid".

1. The person who runs the server has set `AGENT_TOKENS` to `true` and recreated the container.
2. **Agents** is switched on for your environment (**Manage**, **Users**).
3. You have added an agent, and added it to the spaces it should work in (the space's **Set up**, then **Members**).
4. You have made a token on the agent's page. It is shown once. Keep it where you can paste it.

Claude must also be able to reach the server's address over the internet or your network. For Claude Code on your own computer, any address your computer can open will do.

## Connect Claude Code

Put the token in an environment variable, so it isn't typed into the command or saved in a file you might share. Name it `CHAMELEON_TOKEN`. Don't use a name Claude Code treats as its own credential, such as `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`.

1. In your terminal, set the variable to the token. For example: `export CHAMELEON_TOKEN=agt_...`
2. Add the server. Replace `YOUR-SERVER` with your server's address:

   `claude mcp add --transport http chameleon https://YOUR-SERVER/mcp --header "Authorization: Bearer $CHAMELEON_TOKEN"`

3. Start Claude Code in the usual way.

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

Ask Claude: "Run the `me` tool." It should answer with the agent's name and the spaces it is a member of. If it names the spaces you added it to, you are connected.

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

Not yet tested. What is known comes from Anthropic's documentation, read on 2026-11-20, and has not been tried on a real connection:

- The apps' custom connectors connect from Anthropic's cloud, not from your computer. So your server must be reachable from the internet on port 443 (HTTPS). A server that is only on your own network can't be reached that way.
- Anthropic's help article says connectors can use a static token. It is not confirmed that the connector form accepts a custom `Authorization: Bearer` header, which is how Chameleon wants the token.
- If the form doesn't accept one, the apps would need OAuth sign-in. Chameleon does not have that yet.

So don't count on the apps working. Use Claude Code until this is tried.

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
- **The Claude apps can't connect.** See the section above: the server must be public, and the apps may not be able to send this token at all.
