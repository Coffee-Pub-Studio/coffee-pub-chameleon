// An agent's page, in Manage > Users (plan-agent-access.md, step 2): its name, its token (made here, shown once), Turn off and
// Delete, and What it did, the log the server keeps. The page's own markup is #agent-page in admin.html; admin.js hands it the
// agent (a row of Users) and what it needs to talk to the server and to say things.
//
// Text only, everywhere: every value from the API or the log (a name, an address, a route, an action, a message) goes in through
// textContent, never as markup (tools/check-agent-pages.mjs drives a script-looking name and address through it).
import { confirmDialog } from '/confirm.js';

const MAX_NAME = 40;
const POLL_MS = 10000; // how often the live "Claude connected" line asks while it is on screen
// The agent's name as a person reads it, with the mark that it is not a person: "(set-up agent)" for the set-up kind
// (plan-admin-agent.md, decision 2), else "(agent)".
export const agentName = (user) => `${String((user && (user.displayName || user.key)) || 'Agent')} ${user && user.kind === 'setup' ? '(set-up agent)' : '(agent)'}`;

// A time as the page shows it: "Nov 16, 3:40 PM", the year only when it is not this one.
export function whenText(iso, hour12 = true) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' };
  return d.toLocaleString([], { month: 'short', day: 'numeric', ...year, hour: 'numeric', minute: '2-digit', hour12 });
}
const dayText = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};

// How long a token works, and its end, in plain words. `expiresAt` is null for a token that never expires.
const LIFETIME_WORDS = { '30d': '30 days', '60d': '60 days', '90d': '90 days', '1y': '1 year' };
export const lifetimeText = (lifetime, expiresAt) => {
  if (lifetime === 'never' || expiresAt === null || expiresAt === undefined) return 'Never expires.';
  const day = dayText(expiresAt);
  const span = LIFETIME_WORDS[lifetime];
  return span && day ? `Works for ${span}, until ${day}.` : day ? `Works until ${day}.` : span ? `Works for ${span}.` : '';
};
// A sign-in connection (GET /api/users/:key/token's `connection`) in plain words: who it is, who allowed it, when, and where it goes back to.
export const connectionText = (c) => {
  const by = c.allowedBy && c.allowedBy.name ? c.allowedBy.name : 'someone';
  const day = dayText(c.allowedAt);
  return `Connected by sign-in: ${c.app}, allowed by ${by}${day ? ` on ${day}` : ''}. Goes back to ${c.returnsTo}.`;
};
// The warning before a connection runs out or after it has: '' when there is none.
export const connectionEndingText = (expiresAt, now = Date.now()) => {
  if (expiresAt === null || expiresAt === undefined) return '';
  const end = Date.parse(expiresAt);
  if (Number.isNaN(end)) return '';
  if (end <= now) return 'This connection has ended. Connect again from the app.';
  const days = Math.ceil((end - now) / 86400000);
  return days > 7 ? '' : `This connection ends in ${days === 1 ? '1 day' : `${days} days`}. Connect again from the app before then.`;
};
// The warning before a token runs out (7 days) and after it has: '' when there is none (no token, or one that never expires).
export const endingText = (expiresAt, now = Date.now()) => {
  if (expiresAt === null || expiresAt === undefined) return '';
  const end = Date.parse(expiresAt);
  if (Number.isNaN(end)) return '';
  if (end <= now) return 'This token has ended. Make a new token.';
  const days = Math.ceil((end - now) / 86400000);
  if (days > 7) return '';
  return `This token ends in ${days === 1 ? '1 day' : `${days} days`}. Make a new token before then, and update Claude with it.`;
};

// What each of the gate's routes reads like in the log (the route is the gate's pattern, as the server writes it). `w` is the
// page's word(): a module, an object and a space read as this environment's own words.
const READS = {
  '/api/agent/me': () => 'Looked at its own limits',
  '/api/modules/:id/context': (w) => `Read what ${w('module', { a: true })} is for`,
  '/api/modules/:id/data': (_w, name) => (name ? `Read ${name} data` : 'Read data'),
  '/api/modules/:id/data/:key': (_w, name) => (name ? `Read ${name} data` : 'Read data'),
  '/api/objects/search': (w) => `Searched ${w('object', { many: true })}`,
  '/api/objects/links': (w) => `Read what ${w('object', { a: true })} links to`,
  '/api/objects/kinds': (w) => `Read the kinds of ${w('object')}`,
  '/api/objects/resolve': (w) => `Looked up ${w('object', { many: true })}`,
  '/api/spaces/:id/members': (w) => `Read who is in ${w('space', { a: true })}`,
  '/api/spaces/:id/actions': () => 'Listed what it can ask for',
  '/api/spaces/:id/action/:requestId': () => 'Checked on a request',
  '/mcp': () => 'Connected through MCP', // initialize, tools/list, ping and a client's GET that answers 405
  // The set-up agent's (plan-admin-agent.md). Making and changing a space are worded by their `change` in logLine.
  '/api/agent/templates': () => 'Read the templates it may use',
  '/api/agent/icons': () => 'Read the icons it may use',
  '/api/agent/spaces': (w) => `Made ${w('space', { a: true })}`,
  '/api/agent/spaces/:id': (w) => `Changed ${w('space', { a: true })}`,
  '/api/agent/people': (w) => `Read the ${w('member', { many: true })} it may ask about`,
  '/api/agent/spaces/:id/asks': () => 'Asked about a person',
  '/api/agent/asks/:id': () => 'Checked on an ask',
};
// What a set-up agent's change to a space it made reads like (the log's `change`, never a name or a description).
const CHANGE_WORDS = { renamed: 'Renamed', described: 'Changed the description of', icon: 'Changed the icon of' };
// What a set-up agent's ask about a person reads like (the log's `change`, never the person's name).
const ASK_WORDS = { 'ask:add': () => 'Asked to add a person to', 'ask:remove': () => 'Asked to take a person off', 'ask:moderator': (w) => `Asked to change ${w('moderator', { a: true })} of` };
// Chat lines depend on the method (GET reads, POST posts), so they are told apart in logLine, not in READS.
const CHAT_ROUTE = '/api/spaces/:id/chat';
// The methods the gate lets through on each route; any other method on it was refused. A read route is GET (HEAD too); the
// action and objects/resolve routes are POST; Chat is GET or POST.
const ROUTE_METHODS = { '/api/objects/resolve': ['POST'], '/api/spaces/:id/action': ['POST'], [CHAT_ROUTE]: ['GET', 'POST'], '/mcp': ['GET', 'POST'], '/api/agent/spaces': ['POST'], '/api/agent/spaces/:id': ['PATCH'], '/api/agent/spaces/:id/asks': ['POST'] };
const methodFits = (route, method) => (ROUTE_METHODS[route] || ['GET', 'HEAD']).includes(String(method || '').toUpperCase());
const known = (route) => typeof route === 'string' && Object.hasOwn(READS, route);
// "addMilestone" -> "add milestone"; the module's id before the colon is left out.
const actionWords = (action) => {
  const name = String(action || '').split(':').pop();
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().trim() || 'something';
};

// A module's name for a log line: the environment's own name for it (`lookup(id)`, from the Modules list the page already
// has: its display name, else its own), and only when that is unknown the id title-cased ("my-notes" -> "My Notes"). Only a
// safe id (as the server writes it) counts; anything else is no module (''), whatever was sent.
const moduleName = (id, lookup) => {
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id)) return '';
  const named = lookup(id);
  return typeof named === 'string' && named ? named : id.split('-').filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join(' ');
};

// One log line (an entry of GET /api/users/:key/agent-log) as { text, note, detail }: what it did in plain words, whether it is
// a note (a line that counted against nothing), and the rest of it (when, address, how it went). `spaceName(id)` gives a space's name and `moduleName(id)` a module's name here ('' when unknown).
export function logLine(entry, { spaceName = () => '', moduleName: lookup = () => '', hour12 = true, word = (w) => w } = {}) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const status = Number.isInteger(e.status) ? e.status : null;
  const parts = [whenText(e.at, hour12)];
  if (e.address) parts.push(String(e.address));
  if (e.event === 'connected' || e.event === 'ended' || e.event === 'reused') {
    // A sign-in connection's start or end (plan-mcp-oauth.md): the app's name and who did it, never a token.
    const app = typeof e.app === 'string' && e.app ? e.app : 'an app';
    const by = e.by && typeof e.by === 'object' && e.by.name ? String(e.by.name) : '';
    const said = e.event === 'connected' ? `Connected by sign-in: ${app}${by ? `, allowed by ${by}` : ''}`
      : e.event === 'ended' ? `Connection ended${by ? ` by ${by}` : ''}`
        : 'Connection ended: an old key was used again';
    return { text: said, note: false, detail: parts.filter(Boolean).join(' · '), message: '' };
  }
  if (e.kind === null || e.kind === undefined) {
    // A note: the agent went over its limit, or its token was refused.
    const text = status === 429 ? 'Over its limit' : status === 401 ? 'Token refused' : 'Note';
    return { text, note: true, detail: parts.filter(Boolean).join(' · ') };
  }
  const where = e.space ? ` in ${spaceName(e.space) || `${word('space', { a: true })} that is gone`}` : '';
  let text;
  let refused = false;
  if (!methodFits(e.route, e.method)) { refused = true; text = `Refused: ${`${String(e.method || '')} ${String(e.route || '')}`.trim()}`; } // not the method the gate lets through here
  else if (e.route === CHAT_ROUTE && e.method === 'GET') text = `Read Chat${where}`;
  else if (e.route === CHAT_ROUTE && e.method === 'POST' && status === 200) text = `Posted in Chat${where}`;
  else if (e.route === CHAT_ROUTE && e.method === 'POST' && status === 403) text = `Refused post${where}`;
  else if (e.route === '/api/spaces/:id/action') text = `Ask for ${actionWords(e.action)}${where}`;
  else if (e.route === '/api/agent/spaces' && e.change === 'made' && status === 200) text = e.space ? `Made the ${word('space')} ${spaceName(e.space) || 'that is gone'}` : `Made ${word('space', { a: true })}`;
  else if (e.route === '/api/agent/spaces/:id/asks' && ASK_WORDS[e.change] && status === 202) text = `${ASK_WORDS[e.change](word)} ${e.space && spaceName(e.space) ? `the ${word('space')} ${spaceName(e.space)}` : word('space', { a: true })}`;
  else if (e.route === '/api/agent/spaces/:id' && typeof e.change === 'string' && status === 200) {
    const done = e.change.split(',').map((c) => CHANGE_WORDS[c]).filter(Boolean);
    const named = e.space && spaceName(e.space) ? `the ${word('space')} ${spaceName(e.space)}` : word('space', { a: true });
    text = done.length === 1 ? `${done[0]} ${named}` : `Changed ${named}`;
  }
  else if (known(e.route)) text = `${READS[e.route](word, moduleName(e.module, lookup))}${where}`;
  else { refused = true; text = `Refused: ${`${String(e.method || '')} ${String(e.route || '')}`.trim()}`; } // a route off the gate's list: the server writes its fixed shape
  const mcpGet405 = e.route === '/mcp' && e.method === 'GET' && status === 405; // a client's GET the endpoint answers 405: normal, not a failure
  if (status !== null && status >= 400 && !mcpGet405) parts.push(refused ? String(status) : `didn't work (${status})`);
  const detail = parts.filter(Boolean).join(' · ');
  // The server writes a read's count as a number and a post's id as a string; only the count is shown.
  let message = typeof e.message === 'string' && e.message ? e.message : '';
  if (e.route === CHAT_ROUTE && e.method === 'GET') { const n = e.message; message = Number.isInteger(n) && n >= 0 ? `${n} ${n === 1 ? 'message' : 'messages'}` : ''; }
  else if (e.route === CHAT_ROUTE && e.method === 'POST' && status === 200) message = ''; // the message id means nothing to a person
  return { text, note: false, detail, message };
}

// The log's lines as the page shows them (newest first): a run of /mcp handshake lines (initialize, tools/list, a ping, the client's
// GET) from one address, each within a minute of the one before, is one line with a count, carrying the time of the newest. Tool
// calls have their own routes and are never folded in. Only the display is grouped; the log keeps every entry.
const FOLD_MS = 60000;
// `carry` is the last run of the page before (Show older): a run that goes on over the page's edge is the same run.
export function foldLines(entries, carry = null) {
  const out = carry ? [carry] : [];
  for (const entry of entries) {
    const last = out[out.length - 1];
    const mcp = (e) => e && e.route === '/mcp' && e.kind !== null && e.kind !== undefined;
    if (last && mcp(entry) && mcp(last.last) && (last.last.address || '') === (entry.address || '') && Math.abs(Date.parse(last.last.at) - Date.parse(entry.at)) <= FOLD_MS) { last.count += 1; last.last = entry; continue; }
    out.push({ entry, last: entry, count: 1 });
  }
  return out;
}

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};

// A hint with "Roles" as a link to Manage > Roles (/admin#roles). It opens in a new tab: the guide is also in the token
// window, and leaving that page would lose the token, which is shown once.
const rolesHint = (before, after) => {
  const p = make('p', 'hint', before);
  const a = make('a', '', 'Roles');
  a.href = '/admin#roles';
  a.target = '_blank';
  a.rel = 'noopener';
  p.append(a, after);
  return p;
};

// Connect Claude Code: the command and the .mcp.json form, with this server's address (the page's own origin, right in every
// environment). `token` is the real one in the token window and a placeholder on the agent's page. Text only.
const PLACEHOLDER_TOKEN = 'agt_YOUR_TOKEN';
export const connectCommand = (origin, token) => `claude mcp add --transport http chameleon ${origin}/mcp --header "Authorization: Bearer ${token}"`;
// Another app with a form for a Streamable HTTP MCP server and a "Bearer token env var" field: the field takes the NAME of a variable
// that holds the token. The three commands set it on the person's computer; `token` is real only in the token window.
export const ENV_VAR_NAME = 'CHAMELEON_TOKEN';
export const envCommands = (token, name = ENV_VAR_NAME) => ({
  windows: `setx ${name} "${token}"`,
  macos: `echo 'export ${name}="${token}"' >> ~/.zshrc`,
  linux: `echo 'export ${name}="${token}"' >> ~/.bashrc`,
});
export const connectJson = (origin, token) => JSON.stringify({ mcpServers: { chameleon: { type: 'http', url: `${origin}/mcp`, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);

// A line of text to copy: a label, the text in a box and a Copy button of its own.
function copyBlock(label, text, copyLabel = 'Copy') {
  const wrap = make('div', 'agent-copy');
  const name = make('p', 'hint', label);
  const box = make('code', 'key agent-copy-text', text);
  box.tabIndex = 0;
  const row = make('div', 'row');
  const btn = make('button', 'btn btn-small', copyLabel);
  btn.type = 'button';
  const status = make('span', 'status');
  status.setAttribute('role', 'status');
  row.append(btn, status);
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'Copied';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(box);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      status.textContent = 'Select and copy it by hand';
    }
  });
  wrap.append(name, box, row);
  return wrap;
}

// How long ago, in plain words: "just now", "2 minutes ago", "3 hours ago", "4 days ago".
export function agoText(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  const n = (v, unit) => `${v} ${unit}${v === 1 ? '' : 's'} ago`;
  if (s < 60) return 'just now';
  if (s < 3600) return n(Math.floor(s / 60), 'minute');
  if (s < 86400) return n(Math.floor(s / 3600), 'hour');
  return n(Math.floor(s / 86400), 'day');
}
// What the live line says, from the token's last use (null when there is no token or it was never used). Says only what is known.
export const connectedText = (lastUsedAt, now = Date.now()) => {
  const ago = lastUsedAt ? agoText(lastUsedAt, now) : '';
  return ago ? `Claude connected, ${ago}` : 'Not connected yet';
};

export const FIRST_QUESTION = 'Use the chameleon tools. Which spaces can you see, and what is in the to-do list?';
export const setupFirstQuestion = (spaceWord) => `Use the chameleon tools. Which templates can you use to make ${/^[aeiou]/i.test(spaceWord) ? 'an' : 'a'} ${spaceWord}?`;
export const CLAUDE_DOCS = 'https://code.claude.com/docs';

// The guided flow: purpose, what you need, numbered steps, the first question, what to try next. `token` is the real one in the
// token window and a placeholder on the agent's page (`note` then says why). Returns { el, setUsed(lastUsedAt) } for the live line.
// Text only; the token is only ever put in as textContent.
function connectGuide({ word = (w) => w, token, note, agentLabel = 'Claude (agent)', spaceWord = 'space', spaceName = '', spaceWords = (n) => (n === 1 ? 'space' : 'spaces'), setup = false }) {
  const el = make('div', 'agent-connect');
  const live = make('p', 'agent-connected');
  live.setAttribute('role', 'status');
  live.dataset.agentConnected = '';
  const chip = make('span', 'sdk-status');
  live.append(chip);
  const setUsed = (lastUsedAt) => {
    chip.textContent = connectedText(lastUsedAt);
    chip.dataset.tone = lastUsedAt && agoText(lastUsedAt) ? 'ok' : '';
  };
  setUsed(null);
  // Where the agent is a member: only what the spaces list says.
  const where = make('p', 'agent-connected');
  where.setAttribute('role', 'status');
  where.dataset.agentSpaces = '';
  const setSpaces = (names) => {
    if (!Array.isArray(names)) { where.textContent = ''; return; } // not known yet: says nothing
    const list = names;
    if (setup) { where.textContent = !list.length ? `It has not made ${/^[aeiou]/i.test(spaceWord) ? 'an' : 'a'} ${spaceWord} yet.` : list.length === 1 ? `In 1 ${spaceWords(1)}: ${list[0]}` : `In ${list.length} ${spaceWords(list.length)}`; return; }
    where.textContent = !list.length ? `Not in any ${spaceWord} yet. Add it under ${/^[aeiou]/i.test(spaceWord) ? 'an' : 'a'} ${spaceWord}'s Set up, then Members.`
      : list.length === 1 ? `In 1 ${spaceWords(1)}: ${list[0]}` : `In ${list.length} ${spaceWords(list.length)}`;
  };
  setSpaces(null);
  const need = make('p', 'hint', 'You need Claude Code, a program you run in a terminal on your own computer. ');
  const link = make('a', '', 'About Claude Code');
  link.href = CLAUDE_DOCS;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  need.append(link);
  const steps = make('ol', 'agent-steps');
  const step = (text, ...more) => { const li = make('li'); li.append(make('span', '', text), ...more); steps.append(li); return li; };
  if (!setup) step(`Add this agent to ${/^[aeiou]/i.test(spaceWord) ? 'an' : 'a'} ${spaceWord}.`, make('p', 'hint', `An agent only works in ${spaceWords(2)} it belongs to. Open the ${spaceWord}'s Set up, then Members, switch on "${agentLabel}", and Save.`), where);
  step('Copy the command.', copyBlock('Command', connectCommand(location.origin, token)), ...(note ? [make('p', 'hint', note)] : []));
  step('Open a terminal on your computer, paste it and press Enter.');
  const three = step('Start Claude Code by typing ');
  three.querySelector('span').after(make('code', '', 'claude'));
  step('Ask it the first question below.');
  const next = make('ul', 'agent-try');
  const tries = setup ? [`Make ${/^[aeiou]/i.test(spaceWord) ? 'an' : 'a'} ${spaceWord} for a trip to Lisbon.`, `Rename the ${spaceWord} you made.`, `Ask to add Ana to the ${spaceWord} you made.`] : [`Summarise the chat in ${spaceName || `the ${spaceWord}`}.`, 'What is due this week?', 'Ask the Planner to add a milestone.'];
  for (const line of tries) next.append(make('li', '', line));
  const file = make('details', 'agent-file');
  file.append(make('summary', '', 'Use a project file instead'), make('p', 'hint', 'Save this as .mcp.json in the folder you work in, then start Claude Code there. Or add --scope user to the command to use it in every folder.'), copyBlock('.mcp.json', connectJson(location.origin, token)));
  const apps = make('ol', 'agent-steps');
  const appStep = (text, ...more) => { const li = make('li'); li.append(make('span', '', text), ...more); apps.append(li); };
  appStep('Open the Claude app: Customize, then Connectors, then Add custom connector.');
  appStep('Name it, and use this address:', copyBlock('Address', `${location.origin}/mcp`));
  appStep('Under Authentication, choose No sign-in.');
  appStep('Under Request headers, choose Add header. Name: Authorization. Value: Bearer then a space then the token.', copyBlock('Header value', `Bearer ${token}`));
  appStep('Save, then start a new chat and turn the connector on for that chat. Ask: "Use the chameleon tools. Which spaces can you see?"');
  const envs = make('ol', 'agent-steps');
  envs.dataset.agentEnv = '';
  const envStep = (text, ...more) => { const li = make('li'); li.append(make('span', '', text), ...more); envs.append(li); };
  envStep('Open Connect to a custom MCP, and type Chameleon (or the server\'s name) in Name.');
  envStep('Under Type, choose Streamable HTTP, not STDIO.');
  envStep('URL: use this address.', copyBlock('Address', `${location.origin}/mcp`));
  envStep('Leave Bearer token env var empty.');
  envStep('Under Headers, choose Add header. Key: Authorization. Value: Bearer then a space then the token.', copyBlock('Header value', `Bearer ${token}`));
  envStep('Leave Headers from environment variables empty.');
  envStep('Save the server, then select Restart.');
  envStep('In a Codex conversation type /mcp: Chameleon should be listed and Enabled.');
  envStep('Start a new Codex conversation and ask the first question above.');
  const codexIn = make('ol', 'agent-steps');
  codexIn.dataset.agentCodexSignin = '';
  const inStep = (text) => { const li = make('li'); li.append(make('span', '', text)); codexIn.append(li); };
  inStep('Add the server with only the address (the URL above): Settings, MCP servers, Add server, Streamable HTTP. Leave Bearer token env var and Headers empty.');
  inStep('Save, then select Restart.');
  inStep('Select Authenticate next to Chameleon in the server list. A Chameleon page opens: choose the agent and Allow.');
  inStep('In a Codex conversation type /mcp: Chameleon should be listed and Enabled.');
  inStep('Start a new Codex conversation and ask the first question above.');
  const safer = make('ol', 'agent-steps');
  safer.dataset.agentEnvSafer = '';
  const saferStep = (text, ...more) => { const li = make('li'); li.append(make('span', '', text), ...more); safer.append(li); };
  const cmds = envCommands(token);
  saferStep('Bearer token env var: type the name of a variable, not the token.', copyBlock('Variable name', ENV_VAR_NAME));
  saferStep('Leave Headers empty.');
  saferStep('On your computer, set that variable to the token. Pick your system, paste it in a terminal and press Enter.',
    copyBlock('Windows (PowerShell)', cmds.windows), copyBlock('macOS (Terminal)', cmds.macos), copyBlock('Linux (shell)', cmds.linux));
  saferStep('Quit the app and open it again, because it reads variables only when it starts. Then save the server.');
  const moderatorWord = word('moderator', { a: true });
  const setupIntro = `Let Claude set up ${spaceWords(2)}: make one, and change its name, description and icon. It needs only this connection, and it can't read what is inside a ${spaceWord}. Adding or taking off a person, or making someone ${moderatorWord}, waits for your yes.`;
  // An app that can sign in needs only the server's address; the approval page makes or picks the agent (plan-mcp-oauth.md).
  const signIn = make('div', 'agent-signin');
  signIn.dataset.agentSignin = '';
  signIn.append(
    make('p', '', 'Using an app that can sign in? Give it this address:'),
    copyBlock('Address', `${location.origin}/mcp`),
    make('p', 'hint', 'An app that offers sign-in needs only that. You allow it on a page here, so there is no token to copy.'),
  );
  el.append(
    make('h3', 'agent-connect-title', 'Connect Claude'),
    make('p', 'hint', setup ? setupIntro : 'Let Claude read and help in the spaces this agent is in: the plan, the to-dos and the chat.'),
    signIn,
    make('h4', 'agent-connect-sub', 'Claude Code and scripts'),
    make('p', 'hint', 'These use a pasted token. Follow the steps below.'),
    need, live, steps,
    make('h4', 'agent-connect-sub', 'What to say first'),
    copyBlock('First question', setup ? setupFirstQuestion(spaceWord) : FIRST_QUESTION),
    make('h4', 'agent-connect-sub', 'What to try next'),
    next,
    ...(setup ? [rolesHint('What it may do is set on ', ', in the Set-up agent column.')] : [
      make('p', 'hint', 'A change waits until a person who can change that module has it open.'),
      rolesHint('To let Claude write in Chat, tick Send chat messages for agents on ', '.'),
    ]),
    make('h4', 'agent-connect-sub', 'Claude apps'),
    apps,
    make('p', 'hint', "Tested in the Claude app on 2026-11-20. The header value is shown once by the app and never again; if you make a new token, edit the connector's header."),
    file,
    make('h4', 'agent-connect-sub', 'Codex (an app with environment-variable fields)'),
    make('p', 'hint', "Codex is the OpenAI app that sets up servers in a form titled Connect to a custom MCP. A server added there shows in Codex, not in an ordinary ChatGPT chat. ChatGPT's own chat (Plugins) takes custom servers only on some plans, Business and Enterprise, and needs sign-in, not a token; Codex works on other plans. This worked in a test on 21 November 2026 with a token header. Signing in from this app has not been tested yet."),
    make('h4', 'agent-connect-sub', 'Sign in (first choice)'),
    codexIn,
    make('h4', 'agent-connect-sub', "If it can't sign in, use a token"),
    envs,
    make('h4', 'agent-connect-sub', 'Safer, needs a terminal'),
    make('p', 'hint', "Use these steps instead of the header steps above (same form, same Name, Type and URL). The token stays out of the app's settings file."),
    safer,
  );
  return { el, setUsed, setSpaces };
}

// The token, once: a dialog with the token in a box, Copy and the plain warning. The only place the token is ever on a page.
// `poll()` (optional) answers the token's record again ({ lastUsedAt }); it is asked every few seconds while the window is open.
export function showToken({ token, lifetime, expiresAt, agent, hour12 = true, poll = null, spaceWord, spaceName, spaceWords, word }) {
  return new Promise((resolve) => {
    const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    const dlg = make('dialog', 'sdk-dialog sdk-dialog-confirm agent-token-dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', 'agent-token-title');
    const head = make('div', 'sdk-dialog-head');
    const title = make('h2', 'sdk-dialog-title', `Token for ${agentName(agent)}`);
    title.id = 'agent-token-title';
    head.append(title);
    const body = make('div', 'sdk-dialog-body');
    const warning = make('p', 'agent-token-warning', 'This is shown once. If you lose it, make a new one; the old one then stops working.');
    const box = make('code', 'key agent-token-value', token);
    box.tabIndex = 0;
    const row = make('div', 'row');
    const copy = make('button', 'btn btn-small', 'Copy');
    copy.type = 'button';
    copy.dataset.agent = 'copy';
    const status = make('span', 'status');
    status.setAttribute('role', 'status');
    row.append(copy, status);
    const ends = make('p', 'hint', `${lifetimeText(lifetime, expiresAt)} Keep it as a secret, never in a chat.`.trim());
    const guide = connectGuide({ token, agentLabel: agentName(agent), spaceWord, spaceName, spaceWords, setup: agent && agent.kind === 'setup', word });
    const connect = guide.el;
    body.append(warning, box, row, ends, connect);
    const foot = make('div', 'sdk-dialog-foot');
    const done = make('button', 'btn btn-primary', 'Done');
    done.type = 'button';
    done.dataset.agent = 'token-done';
    foot.append(done);
    dlg.append(head, body, foot);
    const root = document.documentElement;
    const was = root.style.overflow;
    let timer = null;
    const refresh = async () => { try { const t = poll && await poll(); if (dlg.isConnected && t) { guide.setUsed(t.lastUsedAt || null); guide.setSpaces(t.spaceNames); } } catch { /* the line keeps what it said */ } };
    if (poll) refresh();
    if (poll) timer = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    const close = () => {
      clearInterval(timer);
      if (dlg.open) dlg.close();
      root.style.overflow = was;
      dlg.remove();
      if (opener && opener.isConnected) opener.focus();
      resolve();
    };
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(token);
        status.textContent = 'Copied';
      } catch {
        // No clipboard here: the box is selected so it can be copied by hand.
        const range = document.createRange();
        range.selectNodeContents(box);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        status.textContent = 'Select and copy it by hand';
      }
    });
    done.addEventListener('click', close);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    document.body.appendChild(dlg);
    root.style.overflow = 'hidden';
    dlg.showModal();
    copy.focus();
  });
}

// What one change of a set-up agent's reads like on its page (GET /api/users/:key/changes), matching the log: no person's name,
// only the space's. `word` is the page's word(). A space that has since gone has no name.
export function changeText(c, word = (w) => w) {
  const x = c && typeof c === 'object' ? c : {};
  const name = x.space && typeof x.space.name === 'string' && x.space.name ? x.space.name : '';
  if (x.change === 'made') return name ? `Made the ${word('space')} ${name}` : `Made ${word('space', { a: true })}`;
  const fields = Object.keys(x.after || {});
  const named = name ? `the ${word('space')} ${name}` : word('space', { a: true });
  if (fields.length === 1) return `${{ name: 'Renamed', description: 'Changed the description of', icon: 'Changed the icon of' }[fields[0]] || 'Changed'} ${named}`;
  return `Changed ${named}`;
}
// What it has left of a daily limit, in plain words: "Spaces it can still make today: 3 of 5".
export const leftText = (label, limit) => (limit && Number.isInteger(limit.perDay) ? `${label}: ${Math.max(0, limit.perDay - (limit.usedToday || 0))} of ${limit.perDay}` : '');

// Wires #agent-page. `ctx`: { api, say(el, text, error), spaces() (the spaces as the page knows them), hour12(), word, onChanged(user)
// (a name or the switch changed), onDeleted(key) }. Returns { open(user), close() }.
export function mountAgentPage(ctx) {
  const $ = (sel) => document.querySelector(`#agent-page ${sel}`);
  let agent = null;
  let oldest = null; // the `at` of the oldest line shown, for the next page
  let token = null; // GET /api/users/:key/token's answer: the pasted token
  let connection = null; // and its sign-in connection (one way in per agent: at most one of the two)
  let lastRun = null; // the last run of lines shown (see foldLines)
  let guide = null; // the Connect Claude block drawn by paint(), for its live line
  let timer = null;
  let changeLimits = null; // the daily limits the changes route carries
  const tokenUrl = () => `/api/users/${encodeURIComponent(agent.key)}/token`;
  const spaceHint = () => { const first = ctx.spaces()[0]; return { spaceWord: ctx.word('space'), spaceName: first ? first.name : '', spaceWords: (n) => ctx.word('space', { many: n !== 1 }), agentLabel: agentName(agent), setup: agent.kind === 'setup', word: ctx.word }; };
  // The names of the spaces the agent is a member of (the Lobby is never one), from the spaces list.
  const memberOf = async () => ((await ctx.api('GET', '/api/spaces')).spaces || []).filter((r) => !r.isLobby && Array.isArray(r.members) && r.members.includes(agent.key)).map((r) => r.name);
  const useNow = async () => ({ ...(await ctx.api('GET', tokenUrl())).token, spaceNames: await memberOf() });

  const spaceName = (id) => { const s = ctx.spaces().find((r) => r.id === id); return s ? s.name : ''; };
  const speak = (text, error = false) => ctx.say($('[data-agent-status]'), text, error);

  function paint() {
    $('[data-agent-title]').textContent = agentName(agent);
    const setup = agent.kind === 'setup';
    for (const panel of document.querySelectorAll('#agent-page [data-agent-setup]')) panel.hidden = !setup;
    for (const panel of document.querySelectorAll('#agent-page [data-agent-ordinary]')) panel.hidden = setup;
    const name = $('[data-agent-name]');
    if (document.activeElement !== name) name.value = agent.displayName || '';
    const off = agent.off === true;
    const chip = $('[data-agent-state]');
    chip.textContent = off ? 'Off' : 'On';
    chip.dataset.tone = off ? 'warn' : 'ok';
    $('[data-agent="off"]').textContent = off ? 'Turn on' : 'Turn off';
    $('[data-agent="off"]').classList.toggle('btn-primary', off);
    $('[data-agent-off-hint]').textContent = off
      ? 'It is off. Its token does nothing until you turn it on.'
      : 'Turning it off stops its token working at once. You can turn it on again.';
    const wayIn = connection || token;
    const ending = connection ? connectionEndingText(connection.expiresAt) : token ? endingText(token.expiresAt) : '';
    const ended = ending === 'This token has ended. Make a new token.' || (connection && ending === 'This connection has ended. Connect again from the app.');
    $('[data-agent-token-state]').textContent = connection ? connectionText(connection) : !token ? 'No token yet.' : ended ? `The token ended ${dayText(token.expiresAt)}.` : lifetimeText(token.lifetime, token.expiresAt);
    const life = $('[data-agent-connection-life]');
    life.textContent = connection ? (ended ? `The connection ended ${dayText(connection.expiresAt)}.` : lifetimeText(connection.lifetime, connection.expiresAt)) : '';
    life.hidden = !connection;
    const warn = $('[data-agent-ending]');
    warn.textContent = ending;
    warn.hidden = !ending;
    $('[data-agent-used]').textContent = !wayIn ? '' : wayIn.lastUsedAt
      ? `Last used ${whenText(wayIn.lastUsedAt, ctx.hour12())}${wayIn.lastAddress ? ` from ${wayIn.lastAddress}` : ''}`
      : 'Not used yet.';
    $('[data-agent="make"]').textContent = token ? 'Make a new token' : 'Make token';
    $('[data-agent="make"]').classList.toggle('btn-primary', !wayIn);
    const connect = $('[data-agent-connect]');
    guide = connectGuide({ token: PLACEHOLDER_TOKEN, note: `Your token goes where it says ${PLACEHOLDER_TOKEN}. It is shown once, when you make it. To get one, use "${token ? 'Make a new token' : 'Make token'}" above.`, ...spaceHint() });
    connect.replaceChildren(guide.el);
    guide.setUsed(wayIn ? wayIn.lastUsedAt || null : null);
    memberOf().then((names) => { if (guide && agent) guide.setSpaces(names); }).catch(() => {});
    $('[data-agent="revoke"]').hidden = !wayIn;
    $('[data-agent="revoke"]').textContent = connection ? 'End connection' : 'Revoke';
    $('[data-agent-make-hint]').textContent = connection ? 'A token ends the connection.' : token ? 'A new token ends the old one.' : `Claude uses the token to work in the ${ctx.word('space', { many: true })} you add it to.`;
  }

  async function loadToken() {
    try {
      const got = await ctx.api('GET', `/api/users/${encodeURIComponent(agent.key)}/token`);
      token = got.token;
      connection = got.connection || null;
    } catch (err) { token = null; connection = null; speak(err.message, true); }
  }

  // The live line and the "Last used" line, from the token's record. Light: no redraw of the page.
  async function refreshUse() {
    if (!agent) return;
    const key = agent.key;
    try {
      const got = await ctx.api('GET', tokenUrl());
      const t = got.connection || got.token;
      const names = await memberOf();
      if (!agent || agent.key !== key) return;
      if (guide) guide.setSpaces(names);
      if (!t) return;
      token = got.token;
      connection = got.connection || null;
      if (guide) guide.setUsed(t.lastUsedAt || null);
      if (agent.kind === 'setup' && !document.querySelector('dialog[open]')) { loadAsks(); loadChanges(); } // a new ask shows without a reload
      $('[data-agent-used]').textContent = t.lastUsedAt ? `Last used ${whenText(t.lastUsedAt, ctx.hour12())}${t.lastAddress ? ` from ${t.lastAddress}` : ''}` : 'Not used yet.';
    } catch { /* the line keeps what it said */ }
  }
  const stopPolling = () => { clearInterval(timer); timer = null; document.removeEventListener('visibilitychange', onVisible); };
  const startPolling = () => {
    stopPolling();
    timer = setInterval(() => { if (!document.hidden) refreshUse(); }, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
  };
  function onVisible() { if (!document.hidden && agent) refreshUse(); }

  const setupUrl = (what) => `/api/users/${encodeURIComponent(agent.key)}/${what}`;
  const WHEN_NOTE = (iso) => { const t = whenText(iso, ctx.hour12()); return t ? `Runs out ${t}` : ''; };

  // Waiting for you: the asks still waiting, each with Approve and Decline. A 409 comes back as a plain sentence, shown under the
  // list; the list is then drawn again from the server, so what ran out is gone.
  async function loadAsks() {
    if (!agent || agent.kind !== 'setup') return;
    const key = agent.key;
    let answer;
    try { answer = await ctx.api('GET', setupUrl('asks')); } catch (err) { $('[data-agent-asks-status]').textContent = err.message; return; }
    if (!agent || agent.key !== key) return;
    const list = $('[data-agent-asks]');
    const waiting = (answer.asks || []).filter((a) => a.state === 'waiting');
    list.replaceChildren();
    for (const a of waiting) {
      const li = make('li', 'agent-ask');
      li.dataset.agentAsk = a.id;
      const what = make('span', 'agent-ask-what');
      what.append(make('span', '', String(a.text || '')), make('span', 'agent-ask-when', [a.at ? `Asked ${agoText(a.at)}` : '', a.expiresAt ? WHEN_NOTE(a.expiresAt) : ''].filter(Boolean).join(' · ')));
      const buttons = make('span', 'agent-ask-buttons');
      for (const [decision, label, cls] of [['approve', 'Approve', 'btn btn-primary btn-small'], ['decline', 'Decline', 'btn btn-small']]) {
        const b = make('button', cls, label);
        b.type = 'button';
        b.dataset.agentAnswer = decision;
        b.dataset.ask = a.id;
        buttons.append(b);
      }
      li.append(what, buttons);
      list.append(li);
    }
    $('[data-agent-asks-empty]').hidden = waiting.length > 0;
    if (changeLimits) paintLimits(waiting.length);
    else limitsWaiting = waiting.length;
  }
  let limitsWaiting = 0;

  // The changes it made in the last days, each with Undo: disabled, with the server's `why`, when it can't be undone now.
  async function loadChanges() {
    if (!agent || agent.kind !== 'setup') return;
    const key = agent.key;
    let answer;
    try { answer = await ctx.api('GET', setupUrl('changes')); } catch (err) { $('[data-agent-changes-status]').textContent = err.message; return; }
    if (!agent || agent.key !== key) return;
    changeLimits = answer.limits || null;
    const list = $('[data-agent-changes]');
    list.replaceChildren();
    const days = Number.isInteger(answer.days) ? answer.days : 7;
    $('[data-agent-changes-hint]').textContent = `A change can be undone for ${days} days. Undoing a change puts back what was there.`;
    for (const c of answer.changes || []) {
      const li = make('li', `agent-change${c.undone ? ' is-undone' : ''}`);
      li.dataset.agentChange = c.id;
      const what = make('span', 'agent-change-what');
      const when = [whenText(c.at, ctx.hour12()), c.undone ? `Undone${c.undoneAt ? ` ${agoText(c.undoneAt)}` : ''}` : ''].filter(Boolean).join(' · ');
      what.append(make('span', 'agent-change-text', changeText(c, ctx.word)), make('span', 'agent-change-when', when));
      if (!c.undone && !c.undoable && c.why) { const why = make('span', 'agent-change-when', c.why); why.dataset.agentWhy = ''; what.append(why); }
      li.append(what);
      if (!c.undone) {
        const buttons = make('span', 'agent-change-buttons');
        const b = make('button', 'btn btn-small', 'Undo');
        b.type = 'button';
        b.dataset.agentUndo = c.id;
        b.dataset.made = c.change === 'made' ? '1' : '';
        b.disabled = !c.undoable;
        if (!c.undoable && c.why) b.title = c.why;
        buttons.append(b);
        li.append(buttons);
      }
      list.append(li);
    }
    $('[data-agent-changes-empty]').hidden = list.children.length > 0;
    paintLimits(limitsWaiting);
  }

  // What it has left today: its spaces, its changes and the asks it can have waiting at once.
  function paintLimits(waiting) {
    limitsWaiting = waiting;
    const list = $('[data-agent-limits]');
    if (!list) return;
    const lines = [
      leftText(`${ctx.word('space', { many: true, cap: true })} it can still make today`, changeLimits && changeLimits.made),
      leftText('Changes it can still make today', changeLimits && changeLimits.changes),
      `Waiting for you: ${waiting}`,
    ].filter(Boolean);
    list.replaceChildren(...lines.map((t) => make('li', '', t)));
  }

  async function answerAsk(id, decision) {
    const status = $('[data-agent-asks-status]');
    status.textContent = '';
    for (const b of document.querySelectorAll(`#agent-page [data-ask="${CSS.escape(id)}"]`)) b.disabled = true;
    try {
      await ctx.api('POST', setupUrl(`asks/${encodeURIComponent(id)}`), { decision });
      ctx.say(status, decision === 'approve' ? 'Approved' : 'Declined');
    } catch (err) {
      ctx.say(status, err.message, true); // the server's plain sentence (409: answered, run out or not possible)
    }
    await loadAsks();
    await loadChanges();
  }

  async function undoChange(id, made) {
    const status = $('[data-agent-changes-status]');
    status.textContent = '';
    if (made && !await confirmDialog({ title: `Remove this ${ctx.word('space')}?`, message: 'Everything in it goes.', action: 'Remove', kind: 'final' })) return;
    try {
      await ctx.api('POST', setupUrl(`changes/${encodeURIComponent(id)}/undo`));
      ctx.say(status, 'Undone');
    } catch (err) {
      ctx.say(status, err.message, true);
    }
    await loadChanges();
    loadLog(false);
  }

  async function loadLog(more) {
    const list = $('[data-agent-log]');
    const key = agent.key;
    let answer;
    try {
      answer = await ctx.api('GET', `/api/users/${encodeURIComponent(key)}/agent-log${more && oldest ? `?before=${encodeURIComponent(oldest)}` : ''}`);
    } catch (err) {
      $('[data-agent-log-status]').textContent = err.message;
      return;
    }
    if (!agent || agent.key !== key) return;
    $('[data-agent-log-status]').textContent = '';
    if (!more) { list.replaceChildren(); oldest = null; }
    if (!more) lastRun = null;
    for (const run of foldLines(answer.entries, more ? lastRun : null)) {
      const { entry, last, count } = run;
      const line = logLine(entry, { spaceName, moduleName: ctx.moduleName, hour12: ctx.hour12(), word: ctx.word });
      if (count > 1) line.text = `${line.text} (${count} messages)`;
      if (run.li) run.li.querySelector('.agent-log-what').textContent = line.text; // a run that went on over the page's edge
      else {
        run.li = make('li', `agent-log-line${line.note ? ' is-note' : ''}`);
        run.li.append(make('span', 'agent-log-what', line.text), make('span', 'agent-log-detail', line.detail));
        if (line.message) run.li.append(make('span', 'agent-log-detail', line.message));
        list.append(run.li);
      }
      oldest = last.at;
      lastRun = run;
    }
    $('[data-agent-log-empty]').hidden = list.children.length > 0;
    $('[data-agent="older"]').hidden = answer.more !== true;
  }

  // The choice remembers nothing: 30 days each time.
  const resetLifetime = () => { $('[data-agent-lifetime]').value = '30d'; $('[data-agent-never]').hidden = true; };
  $('[data-agent-lifetime]').addEventListener('change', (event) => { $('[data-agent-never]').hidden = event.target.value !== 'never'; });

  async function make_() {
    $('[data-agent="make"]').disabled = true;
    try {
      const made = await ctx.api('POST', `/api/users/${encodeURIComponent(agent.key)}/token`, { expires: $('[data-agent-lifetime]').value });
      resetLifetime();
      await loadToken();
      paint();
      await showToken({ token: made.token, lifetime: made.lifetime, expiresAt: made.expiresAt, agent, hour12: ctx.hour12(), poll: useNow, ...spaceHint() });
      await loadToken();
      paint();
      loadLog(false);
    } catch (err) {
      speak(err.message, true);
    } finally {
      $('[data-agent="make"]').disabled = false;
    }
  }

  document.querySelector('#agent-page').addEventListener('click', (event) => {
    const answer = event.target.closest('[data-agent-answer]');
    if (answer && agent) { answerAsk(answer.dataset.ask, answer.dataset.agentAnswer); return; }
    const undo = event.target.closest('[data-agent-undo]');
    if (undo && agent && !undo.disabled) undoChange(undo.dataset.agentUndo, undo.dataset.made === '1');
  });
  document.querySelector('#agent-page').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-agent]');
    if (!button || !agent) return;
    const what = button.dataset.agent;
    try {
      if (what === 'make') await make_();
      else if (what === 'revoke') {
        const ending = Boolean(connection);
        if (!await confirmDialog(ending
          ? { title: `End the connection of ${agentName(agent)}?`, message: `It stops working at once. ${connection.app} can connect again from its own sign-in.`, action: 'End connection', kind: 'destructive' }
          : { title: `Revoke the token of ${agentName(agent)}?`, message: 'It stops working at once. You can make a new one.', action: 'Revoke', kind: 'destructive' })) return;
        await ctx.api('DELETE', `/api/users/${encodeURIComponent(agent.key)}/token`);
        token = null;
        connection = null;
        paint();
        speak(ending ? 'Connection ended' : 'Token revoked');
        loadLog(false);
      } else if (what === 'off') {
        const { user } = await ctx.api('PATCH', `/api/users/${encodeURIComponent(agent.key)}`, { off: agent.off !== true });
        agent = { ...agent, ...user };
        ctx.onChanged(agent);
        paint();
        speak(agent.off ? 'Turned off' : 'Turned on');
        loadLog(false);
      } else if (what === 'delete') {
        if (!await confirmDialog({ title: `Delete ${agentName(agent)}?`, message: 'Its token stops working. What it added keeps its name.', action: 'Delete', kind: 'final', typed: String(agent.displayName || agent.key) })) return;
        const key = agent.key;
        await ctx.api('DELETE', `/api/users/${encodeURIComponent(key)}`);
        agent = null;
        ctx.onDeleted(key);
      } else if (what === 'older') await loadLog(true);
      else if (what === 'rename') {
        const value = $('[data-agent-name]').value.trim();
        if (!value) { speak('Give it a name.', true); return; }
        const { user } = await ctx.api('PATCH', `/api/users/${encodeURIComponent(agent.key)}`, { displayName: value });
        agent = { ...agent, ...user };
        ctx.onChanged(agent);
        paint();
        speak('Saved');
      }
    } catch (err) {
      if (what !== 'make') speak(err.message, true);
    }
  });
  $('[data-agent-name]').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); $('[data-agent="rename"]').click(); } });
  $('[data-agent-name]').maxLength = MAX_NAME;

  return {
    async open(user) {
      resetLifetime();
      agent = { ...user };
      token = null;
      connection = null;
      oldest = null;
      $('[data-agent-log]').replaceChildren();
      $('[data-agent="older"]').hidden = true;
      $('[data-agent-log-empty]').hidden = true;
      speak('');
      paint();
      changeLimits = null;
      limitsWaiting = 0;
      for (const sel of ['[data-agent-asks]', '[data-agent-changes]', '[data-agent-limits]']) $(sel).replaceChildren();
      $('[data-agent-asks-status]').textContent = '';
      $('[data-agent-changes-status]').textContent = '';
      await loadToken();
      paint();
      startPolling();
      await Promise.all([loadLog(false), loadAsks(), loadChanges()]);
    },
    close() { stopPolling(); agent = null; token = null; connection = null; guide = null; changeLimits = null; },
  };
}
