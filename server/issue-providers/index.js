// The issue services the server knows (documentation/plans/plan-github-pull.md). An adapter is a module in this folder that
// exports:
//   { id, name, terms, origin, needsToken: false, allowHttp?, pollMs, fullEveryMs, nowGapMs?,
//     validRepo(repo) -> whether "owner/name" is a repository's name there,
//     repoFrom(raw) -> the clean "owner/name" from what a person typed or pasted (their address for it too), or "",
//     list({ repo, since, etag, token, page }, get) -> { status, etag, records, more, wait, bad? } }
// `list` asks for one page: `page` is the address the last page's `more` gave (null for the first), `since` an ISO time (only
// what changed after it), `etag` the first page's last etag (sent back so an unchanged answer is a 304). `get(url, headers)` is
// the core's (server/issues.js): it asks only `origin` (https unless `allowHttp`; only the stand-in), caps the answer at 2 MB
// and 6 seconds and follows a redirect only on `origin`. `status` is the service's (200, 304, 403, 404, 429...; 0 with `bad`
// for an answer that is not the list), `more` the next page's address or null, `wait` what it said about waiting
// ({ retryAfterMs?, resetAt?, pollMs? }). `pollMs`: how long between two timed pulls; `fullEveryMs`: how long between two full
// pulls (every page, to find what is gone); `nowGapMs`: the least time between two pulls a person asks for (default a minute).
//
// An adapter may also write (documentation/plans/plan-github-two-way.md); one without these cannot be written through:
//     get({ repo, number, etag, token }, ask), update({ repo, number, title?, state?, stateReason?, token }, ask),
//     addLabels({ repo, number, labels, token }, ask), removeLabel({ repo, number, label, token }, ask),
//     hasLabel({ repo, label, token }, ask), create({ repo, title, labels, token }, ask), and `writeGapMs` (the least time between
//     two writes). A token is the repository's installation token from the GitHub app (server/issue-app.js; never logged, never
//     answered, never kept in a space's data); an adapter that serves the app also has appInfo({ jwt }, ask) and
//     mintToken({ jwt, installation, repositoryId, permissions }, ask). Each answers { status, wait, limited, message, record? }: `limited` when the answer is a limit to wait out (not a
//     refusal of the token or the change), `message` the service's own sentence on one line, `record` the issue after the write.
//     `ask(method, url, headers, body?)` is the core's (server/issues.js, getter): this origin only, 6 seconds, 2 MB, a redirect
//     never followed for a write. Only a title, a state, label names and a new issue's title and labels may be sent.
//
// A record, the same for every service (nothing else in the core knows which service it came from):
//   { number, title, open, labels: [{ name, color }], url, created, updated, closed?, milestone?: { number, title, due, open }, body? }
// `created`, `updated` and `closed` are ISO times; `color` six hex digits or ''; `due` YYYY-MM-DD or ''; `body` the issue's
// description as plain text (newlines and tabs only, cut at 2000 characters with an ellipsis), absent when empty. Pull requests,
// people (authors, assignees) and comments are never in a record.
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
    && (p.nowGapMs === undefined || (Number.isFinite(p.nowGapMs) && p.nowGapMs >= 0));
}

const registered = [require('./github')];
if (process.env.ISSUES_TEST_STANDIN) registered.push(require('./test-standin'));
for (const p of registered) if (!valid(p)) throw new Error('an issue adapter is not valid');

const providers = Object.fromEntries(registered.map((p) => [p.id, p]));
module.exports = { providers, list: () => registered, valid };
