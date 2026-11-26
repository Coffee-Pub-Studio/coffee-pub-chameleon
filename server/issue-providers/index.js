// The issue services the server knows (documentation/plans/plan-github-pull.md). An adapter is a module in this folder that
// exports:
//   { id, name, terms, origin, needsToken: false, tokenEnv?, allowHttp?, pollMs, fullEveryMs, nowGapMs?,
//     validRepo(repo) -> whether "owner/name" is a repository's name there,
//     list({ repo, since, etag, token, page }, get) -> { status, etag, records, more, wait, bad? } }
// `list` asks for one page: `page` is the address the last page's `more` gave (null for the first), `since` an ISO time (only
// what changed after it), `etag` the first page's last etag (sent back so an unchanged answer is a 304). `get(url, headers)` is
// the core's (server/issues.js): it asks only `origin` (https unless `allowHttp`; only the stand-in), caps the answer at 2 MB
// and 6 seconds and follows a redirect only on `origin`. `status` is the service's (200, 304, 403, 404, 429...; 0 with `bad`
// for an answer that is not the list), `more` the next page's address or null, `wait` what it said about waiting
// ({ retryAfterMs?, resetAt?, pollMs? }). `pollMs`: how long between two timed pulls; `fullEveryMs`: how long between two full
// pulls (every page, to find what is gone); `tokenEnv`: the environment variable a token is read from, when the server has
// one (never logged, never answered, never kept in a space's data); `nowGapMs`: the least time between two pulls a person asks for (default a minute).
//
// A record, the same for every service (nothing else in the core knows which service it came from):
//   { number, title, open, labels: [{ name, color }], url, created, updated, closed?, milestone?: { number, title, due, open } }
// `created`, `updated` and `closed` are ISO times; `color` six hex digits or ''; `due` YYYY-MM-DD or ''. Pull requests, people
// (authors, assignees), bodies and comments are never in a record.
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
    && typeof p.list === 'function' && typeof p.validRepo === 'function' && typeof p.origin === 'string'
    && (p.allowHttp ? /^https?:\/\//.test(p.origin) : /^https:\/\//.test(p.origin))
    && typeof p.terms === 'string' && /^https:\/\//.test(p.terms)
    && Number.isFinite(p.pollMs) && p.pollMs >= 0 && Number.isFinite(p.fullEveryMs) && p.fullEveryMs >= 0
    && (p.tokenEnv === undefined || /^ISSUES_[A-Z0-9_]{1,40}$/.test(p.tokenEnv))
    && (p.nowGapMs === undefined || (Number.isFinite(p.nowGapMs) && p.nowGapMs >= 0));
}

const registered = [require('./github')];
if (process.env.ISSUES_TEST_STANDIN) registered.push(require('./test-standin'));
for (const p of registered) if (!valid(p)) throw new Error('an issue adapter is not valid');

const providers = Object.fromEntries(registered.map((p) => [p.id, p]));
module.exports = { providers, list: () => registered, valid };
