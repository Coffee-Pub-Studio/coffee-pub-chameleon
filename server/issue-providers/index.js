// The issue services the server knows (documentation/plans/plan-github-pull.md). An adapter is a module in this folder that
// exports:
//   { id, name, terms, origin, needsToken: false, allowHttp?, pollMs, fullEveryMs, nowGapMs?,
//     validRepo(repo) -> whether "owner/name" is a repository's name there,
//     repoFrom(raw) -> the clean "owner/name" from what a person typed or pasted (their address for it too), or "",
//     list({ repo, since, etag, token, page, state }, get) -> { status, etag, records, more, wait, bad? },
//     closedBefore?(repo, day) -> the service's own list of the issues closed before `day`, as an address a person opens, or "",
//     milestones?({ repo, etag, token }, get) -> { status, etag, milestones: [{ number, title, due, open }], wait, bad? } }
// `list` asks for one page: `page` is the address the last page's `more` gave (null for the first), `since` an ISO time (only
// what changed after it), `etag` the first page's last etag (sent back so an unchanged answer is a 304), `state` which issues:
// 'all' (the default), 'open' or 'closed' (the daily full pull asks 'open', then 'closed' since the done window's cutoff,
// plan-done-window.md step 3). `closedBefore` asks nothing: `day` is YYYY-MM-DD, the address is on the service's web origin
// (never its API origin), and anything invalid answers "". `get(url, headers)` is
// the core's (server/issues.js): it asks only `origin` (https unless `allowHttp`; only the stand-in), caps the answer at 2 MB
// and 6 seconds and follows a redirect only on `origin`. `status` is the service's (200, 304, 403, 404, 429...; 0 with `bad`
// for an answer that is not the list), `more` the next page's address or null, `wait` what it said about waiting
// ({ retryAfterMs?, resetAt?, pollMs? }). `pollMs`: how long between two timed pulls; `fullEveryMs`: how long between two full
// pulls (every page, to find what is gone); `nowGapMs`: the least time between two pulls a person asks for (default a minute).
// `milestones` (documentation/plans/plan-github-full-sync.md, section 5) asks for the repository's open milestones with the same
// `get`, one page, conditional on `etag`; the pull asks it once after each list it reads, so a milestone with no issue stays in the plan.
//
// An adapter may also write (documentation/plans/plan-github-two-way.md); one without these cannot be written through:
//     get({ repo, number, etag, token }, ask), update({ repo, number, title?, state?, stateReason?, body?, milestone?, token }, ask),
//     addLabels({ repo, number, labels, token }, ask), removeLabel({ repo, number, label, token }, ask),
//     hasLabel({ repo, label, token }, ask), create({ repo, title, labels, body?, token }, ask), and `writeGapMs` (the least time between
//     two writes). For the issue view and its writes (documentation/plans/plan-github-full-sync.md, step 3) also
//     comments({ repo, number, total, etag, token }, ask) (the newest 100, oldest first: { comments: [{ id, author: { id, login } | null,
//     at, edited, text }], total, etag }), addComment({ repo, number, text, token }, ask) and editComment({ repo, id, text, token }, ask)
//     (each answering the `comment`), deleteComment({ repo, id, token }, ask) (204), assign and unassign({ repo, number, logins, token },
//     ask) (each answering the record) and canAssign({ repo, login, token }, ask) (204, or 404 when the login can't be assigned). A token is the repository's installation token from the GitHub app (server/issue-app.js; never logged, never
//     answered, never kept in a space's data); an adapter that serves the app also has appInfo({ jwt }, ask) and
//     mintToken({ jwt, installation, repositoryId, permissions }, ask), and for the sign-in exchangeCode, userInstallations,
//     userRepositories, revokeUserToken and whoAmI({ userToken }, ask) (the signed-in account's { id, login }, for a person's link on
//     Profile, plan-github-full-sync.md section 4). Each answers { status, wait, limited, message, record? }: `limited` when the answer is a limit to wait out (not a
//     refusal of the token or the change), `message` the service's own sentence on one line, `record` the issue after the write.
//     `ask(method, url, headers, body?)` is the core's (server/issues.js, getter): this origin only, 6 seconds, 2 MB, a redirect
//     never followed for a write. Only a title, a state, label names, a body, a milestone's number, a comment's text, linked Owners'
//     logins and a new issue's title, labels and body may be sent.
//
// A record, the same for every service (nothing else in the core knows which service it came from):
//   { number, title, open, labels: [{ name, color }], url, created, updated, closed?, milestone?: { number, title, due, open }, body?,
//     assignees: [{ id, login }], comments }
// `created`, `updated` and `closed` are ISO times; `color` six hex digits or ''; `due` YYYY-MM-DD or ''; `body` the issue's whole
// description as plain text (newlines and tabs only, at most 65,536 characters), absent when empty; the plan's shorter cut is the
// core's (server/issues.js, workOf). `assignees` the people assigned (at most 10, each with the service's account id and login);
// `comments` how many comments the issue has. Pull requests, authors and comments' text are never in a record.
//
// THE RULE (Thomas, 2026-11-25): a registered adapter is for a service that costs nothing and whose free use allows commercial
// use, its terms read before the adapter is written and named in its header. Registered: GitHub (github.js, terms read
// 2026-11-26). Registering is not turning on: nothing is asked until an administrator accepts its terms
// (server/service-terms.js) and an owner turns a pull on for a space. The test stand-in is registered only when the check sets
// ISSUES_TEST_STANDIN to the origin of its own fake service.
'use strict';

const ID = /^[a-z][a-z0-9-]{0,23}$/;

function valid(p) {
  return p && typeof p === 'object' && ID.test(p.id) && typeof p.name === 'string' && p.name && p.needsToken === false
    && typeof p.list === 'function' && typeof p.validRepo === 'function' && typeof p.repoFrom === 'function' && typeof p.origin === 'string'
    && (p.allowHttp ? /^https?:\/\//.test(p.origin) : /^https:\/\//.test(p.origin))
    && typeof p.terms === 'string' && /^https:\/\//.test(p.terms)
    && Number.isFinite(p.pollMs) && p.pollMs >= 0 && Number.isFinite(p.fullEveryMs) && p.fullEveryMs >= 0
    && (p.nowGapMs === undefined || (Number.isFinite(p.nowGapMs) && p.nowGapMs >= 0))
    && (p.closedBefore === undefined || typeof p.closedBefore === 'function')
    && (p.milestones === undefined || typeof p.milestones === 'function');
}

const registered = [require('./github')];
if (process.env.ISSUES_TEST_STANDIN) registered.push(require('./test-standin'));
for (const p of registered) if (!valid(p)) throw new Error('an issue adapter is not valid');

const providers = Object.fromEntries(registered.map((p) => [p.id, p]));
module.exports = { providers, list: () => registered, valid };
