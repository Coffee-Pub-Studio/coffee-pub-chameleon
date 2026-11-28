// Test only: stands in for GitHub so tools/check-issues.mjs can run the whole pull against its own fake service. It is not an
// issue service: it is registered only when ISSUES_TEST_STANDIN is set (to the origin of the check's fake service, http allowed),
// and it must never be offered to a person. It speaks GitHub's REST shape, so the GitHub adapter's reading is what is checked.
// Its timings come from the check: ISSUES_TEST_POLL_MS (the timer's wait), ISSUES_TEST_FULL_MS (how long a full pull lasts) and
// ISSUES_TEST_GAP_MS (the least time between two pulls asked by a person) and ISSUES_TEST_WRITE_GAP_MS (between two writes; 0 here);
// each defaults to GitHub's but the last. Its writes are GitHub's adapter's, sent to the check's fake service, which records every
// request it receives (tools/check-issues.mjs); the stand-in itself is only an origin. Its list takes GitHub's `state` ('all',
// 'open', 'closed') and its `closedBefore` makes GitHub's closed-issues address on the fake's origin (its web origin here).
'use strict';

const { makeAdapter } = require('./github');

const ms = (name, fallback) => { const n = Number(process.env[name]); return Number.isFinite(n) && n >= 0 ? n : fallback; };
const origin = new URL(process.env.ISSUES_TEST_STANDIN || 'http://127.0.0.1:9').origin;

module.exports = {
  ...makeAdapter({
    id: 'issues-standin',
    name: 'Test stand-in (not an issue service)',
    origin,
    webOrigin: origin, // the check's fake serves the sign-in too
    terms: 'https://example.test/issues-standin-terms',
    allowHttp: true,
    pollMs: ms('ISSUES_TEST_POLL_MS', 10 * 60 * 1000),
    fullEveryMs: ms('ISSUES_TEST_FULL_MS', 24 * 3600 * 1000),
    writeGapMs: ms('ISSUES_TEST_WRITE_GAP_MS', 0),
  }),
  nowGapMs: ms('ISSUES_TEST_GAP_MS', 60 * 1000),
};
