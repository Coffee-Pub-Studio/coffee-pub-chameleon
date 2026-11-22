#!/usr/bin/env node
/*
 * eval-extract.mjs -- how well a real AI model reads bookings out of pasted text (plan-assistant-reboot.md, step 3 and decision 8).
 * Thomas starts this himself, when he wants a number. It is NOT part of `npm run check` and never runs on a schedule: it spends
 * money. It runs every sample in tools/golden/extract/ through the same code the server uses (Ai.extract in server/ai.js, with
 * prompts/extract.js and the checks in server/ai-extract.js), and scores the answer against the sample's `expected`.
 *
 *   node tools/eval-extract.mjs --dry-run                  the stand-in model (tools/fake-model.mjs): no key, no network, no cost
 *   EVAL_AI_PROVIDER=openai EVAL_AI_KEY=... EVAL_PRICE_IN=0.15 EVAL_PRICE_OUT=0.60 node tools/eval-extract.mjs --report eval.txt
 *
 * Environment variables (the key is read from the environment only, never from a file, and never printed):
 *   EVAL_AI_PROVIDER   openai, anthropic or compatible. Without it nothing is sent anywhere (unless --dry-run).
 *   EVAL_AI_KEY        the provider's key (openai and anthropic need one; a compatible service may not).
 *   EVAL_AI_MODEL      the model; the server's own default for the provider when not set.
 *   EVAL_AI_ADDRESS    the service's address, for compatible only (for example http://127.0.0.1:11434/v1).
 *   EVAL_PRICE_IN      US$ per million tokens read (input); needed for a real run, so the spending cap can be kept.
 *   EVAL_PRICE_OUT     US$ per million tokens written (output); needed for a real run.
 *   EVAL_REAL_DIR      a private folder of real-anonymised samples, outside the repo (optional; see below).
 *   EVAL_SPEND_CAP     the most to spend, in US$ (default 5). It stops before the next sample when that would pass it.
 *
 * Options: --dry-run, --report <path> (the report goes there; default stdout), --only <text> (only samples whose file name has it).
 *
 * Scoring, per field, exact after normalisation (case, accents, spaces and punctuation ignored):
 *   a match counts 1; a blank where `expected` has a value counts 0; a value that is not the expected one, or a value where
 *   `expected` has none, counts -1 (an invented value). A booking that was not expected counts -1 under kind; a booking that was
 *   expected and not found counts 0 for each of its fields. A sample that expects no booking scores 1 when nothing is returned.
 *   The fields: kind, title, date, times (departs, arrives, checkIn, checkOut, starts, ends), from, to, reference, cost, currency,
 *   travellers. A title is a label, not a fact: it counts 1 when it holds every word of the expected title, else 0, never -1.
 *   A time given as a day only counts as blank. from and to match on the code, or on the name when one holds the other.
 *   travellers match as a set of names (Mr, Mrs and the like ignored). Reported per sample, per kind, per field and overall,
 *   `written` and `real-anonymised` samples apart.
 *
 * Real samples (this repository is public, so they are never committed, even anonymised):
 *   1. Put the files in a private folder on your own machine, outside the repo (same shape as the samples in
 *      tools/golden/extract/, one .json each, with "mark": "real-anonymised").
 *   2. Set EVAL_REAL_DIR=/path/to/folder when you run this. Without it only the written samples run and the report says
 *      "no real samples: set EVAL_REAL_DIR". A folder inside the repo is refused.
 *   3. Anonymise first: remove names, confirmation numbers, addresses, emails, phone numbers and card digits (swap them for
 *      made-up ones, in the text and in `expected`).
 *   Do not commit them. tools/golden/extract/real/ ignores everything but its .gitignore, and check-eval-extract fails if a file
 *   there is tracked.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOLDEN = path.join(ROOT, 'tools', 'golden', 'extract');
const require = createRequire(import.meta.url);

export const FIELDS = ['kind', 'title', 'date', 'times', 'from', 'to', 'reference', 'cost', 'currency', 'travellers'];
export const MARKS = ['written', 'real-anonymised'];
const TIME_KEYS = ['departs', 'arrives', 'checkIn', 'checkOut', 'starts', 'ends'];
const STOP = new Set(['to', 'a', 'de', 'the', 'at', 'from', 'and', 'of', 'in', 'e', 'del', 'da', 'di']);
const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'sr', 'sra', 'mister']);
export const DEFAULT_CAP = 5;

// --- normalising and scoring ---------------------------------------------------------------------------------------------
const norm = (s) => String(s == null ? '' : s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const squash = (s) => norm(s).replace(/ /g, '');
const words = (s) => norm(s).split(' ').filter((w) => w && !STOP.has(w));
const nameSet = (list) => (Array.isArray(list) ? list : []).map((n) => norm(n).split(' ').filter((w) => !HONORIFICS.has(w)).sort().join(' ')).filter(Boolean).sort();
const looseName = (a, b) => { const x = norm(a); const y = norm(b); return Boolean(x) && Boolean(y) && (x === y || x.includes(y) || y.includes(x)); };

// The scored values of one object: { key: { field, value } }. A blank is not there at all.
function slots(o) {
  const out = {};
  const put = (key, field, value) => { if (value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length)) out[key] = { field, value }; };
  const d = (o && o.details) || {};
  put('kind', 'kind', o && o.kind);
  put('title', 'title', o && o.title);
  put('date', 'date', o && o.date);
  for (const k of TIME_KEYS) put(k, 'times', d[k]);
  put('from', 'from', d.from);
  put('to', 'to', d.to);
  put('reference', 'reference', d.reference);
  put('cost', 'cost', d.cost);
  put('currency', 'currency', d.currency);
  put('travellers', 'travellers', d.travellers);
  return out;
}

// Whether the actual value of a slot is the expected one.
function same(key, e, a) {
  if (key === 'title') { const have = new Set(words(a)); const want = words(e); return want.length > 0 && want.every((w) => have.has(w)); }
  if (key === 'from' || key === 'to') {
    const ec = e && typeof e === 'object' ? e.code : (/^[A-Z]{3}$/.test(String(e)) ? e : '');
    const ac = a && typeof a === 'object' ? a.code : (/^[A-Z]{3}$/.test(String(a)) ? a : '');
    const en = e && typeof e === 'object' ? e.name : (ec ? '' : e);
    const an = a && typeof a === 'object' ? a.name : (ac ? '' : a);
    if (ec && ac) return ec.toUpperCase() === ac.toUpperCase();
    return looseName(en, an);
  }
  if (key === 'reference') return squash(e) === squash(a);
  if (key === 'cost') return Math.abs(Number(e) - Number(a)) < 0.005;
  if (key === 'currency') return String(e).toUpperCase() === String(a).toUpperCase();
  if (key === 'travellers') { const x = nameSet(e); const y = nameSet(a); return x.length === y.length && x.every((n, i) => n === y[i]); }
  if (key === 'kind') return e === a;
  return String(e).trim() === String(a).trim(); // date and times
}

// A time slot where the actual value is only a day counts as blank.
const isBlank = (key, e, a) => TIME_KEYS.includes(key) && /T/.test(String(e)) && !/T/.test(String(a));

// One expected object against one actual: how many of its slots match, for pairing.
const likeness = (e, a) => Object.keys(slots(e)).filter((k) => slots(a)[k] && same(k, slots(e)[k].value, slots(a)[k].value) && k !== 'kind').length;

const emptyTally = () => Object.fromEntries(FIELDS.map((f) => [f, { points: 0, possible: 0, wrong: 0 }]));
function add(tally, field, points, possible) {
  tally[field].points += points;
  tally[field].possible += possible;
  if (points < 0) tally[field].wrong += 1;
}

// Scores the objects a model returned against a sample's expected ones. Answers { points, possible, fields, extra, missing }.
export function scoreObjects(expected, actual) {
  const fields = emptyTally();
  let points = 0;
  let possible = 0;
  const book = (field, p, poss) => { add(fields, field, p, poss); points += p; possible += poss; };
  const pairs = [];
  expected.forEach((e, i) => actual.forEach((a, j) => { const n = likeness(e, a); if (n > 0 || e.kind === a.kind) pairs.push({ i, j, n, kind: e.kind === a.kind ? 1 : 0 }); }));
  pairs.sort((x, y) => (y.n - x.n) || (y.kind - x.kind) || (x.i - y.i) || (x.j - y.j));
  const takenE = new Set();
  const takenA = new Set();
  const match = new Map();
  for (const p of pairs) { if (takenE.has(p.i) || takenA.has(p.j)) continue; takenE.add(p.i); takenA.add(p.j); match.set(p.i, p.j); }
  let missing = 0;
  expected.forEach((e, i) => {
    const es = slots(e);
    if (!match.has(i)) { missing += 1; for (const s of Object.values(es)) book(s.field, 0, 1); return; }
    const as = slots(actual[match.get(i)]);
    for (const [key, s] of Object.entries(es)) {
      const a = as[key];
      if (!a || isBlank(key, s.value, a.value)) book(s.field, 0, 1);
      else if (same(key, s.value, a.value)) book(s.field, 1, 1);
      else book(s.field, key === 'title' ? 0 : -1, 1);
    }
    for (const [key, a] of Object.entries(as)) if (!es[key] && key !== 'title') book(a.field, -1, 0);
  });
  let extra = 0;
  actual.forEach((_, j) => { if (!takenA.has(j)) { extra += 1; book('kind', -1, expected.length ? 0 : 1); } });
  // A sample that expects no booking: nothing returned is the one right answer.
  if (!expected.length && !actual.length) book('kind', 1, 1);
  return { points, possible, fields, extra, missing };
}

const fresh = () => ({ points: 0, possible: 0, samples: 0, fields: emptyTally() });
function rollInto(into, score) {
  into.points += score.points;
  into.possible += score.possible;
  into.samples += 1;
  for (const f of FIELDS) { into.fields[f].points += score.fields[f].points; into.fields[f].possible += score.fields[f].possible; into.fields[f].wrong += score.fields[f].wrong; }
}
export const percent = (points, possible) => (possible > 0 ? Math.round((points / possible) * 1000) / 10 : null);

// Totals of scored samples: { overall, byKind, byMark: { mark: { overall, byKind } } }.
export function summarise(results) {
  const out = { overall: fresh(), byKind: {}, byMark: {} };
  for (const r of results) {
    if (!r.score) continue;
    const m = (out.byMark[r.sample.mark] ||= { overall: fresh(), byKind: {} });
    for (const into of [out.overall, (out.byKind[r.sample.kind] ||= fresh()), m.overall, (m.byKind[r.sample.kind] ||= fresh())]) rollInto(into, r.score);
  }
  return out;
}

// --- the samples ----------------------------------------------------------------------------------------------------------
// Every .json in tools/golden/extract/, then those in `realDir` (a private folder outside the repo, EVAL_REAL_DIR), by file name.
// A real sample that cannot be read is skipped and named in `notes`. A folder inside the repo is refused.
export function loadSamples(dir = GOLDEN, realDir = '', notes = []) {
  const out = [];
  const read = (d, prefix, real) => {
    for (const f of fs.readdirSync(d).filter((n) => n.endsWith('.json')).sort()) {
      const name = path.join(prefix, f);
      let s;
      try {
        s = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
        if (!MARKS.includes(s.mark)) throw new Error('mark must be written or real-anonymised.');
        if (real && (typeof s.text !== 'string' || !s.text.trim() || !Array.isArray(s.expected))) throw new Error('it needs text and an expected list.');
      } catch (err) {
        if (!real) throw new Error(`${f}: ${err.message}`);
        notes.push(`Skipped ${name}: it could not be read (${err instanceof SyntaxError ? 'not valid JSON' : err.message.replace(/\.$/, '')}).`);
        continue;
      }
      out.push({ ...s, file: name });
    }
  };
  if (fs.existsSync(dir)) read(dir, '', false);
  if (realDir) {
    const at = fs.existsSync(realDir) ? fs.realpathSync(realDir) : path.resolve(realDir);
    const rel = path.relative(fs.realpathSync(ROOT), at);
    if (!rel || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new Error('Keep real samples outside the repo.');
    if (!fs.existsSync(at) || !fs.statSync(at).isDirectory()) throw new Error('EVAL_REAL_DIR is not a folder.');
    read(at, 'real', true);
  }
  return out;
}

// --- the run ---------------------------------------------------------------------------------------------------------------
const cost = (tokens, prices) => ((tokens.in || 0) * (prices.in || 0) + (tokens.out || 0) * (prices.out || 0)) / 1e6;
const WORDS = { object: 'object', objects: 'objects', space: 'trip' };

// One sample through the server's own extraction. `ai`: a server/ai.js Ai. Answers { objects, tokens: { in, out }, error }.
async function extractOne(ai, sample, scrub) {
  const prompts = require('../server/prompts');
  const { reviewExtract } = require('../server/ai-extract.js');
  const { TRAVEL_KINDS } = require('../server/object-format.js');
  const text = prompts.cleanAttachedText(sample.text).trim();
  const trip = sample.trip || { name: 'Trip' };
  const today = sample.today || { date: '2026-11-21', weekday: 'Saturday', timeZone: 'Europe/London' };
  const inputs = { text, trip, today, kinds: TRAVEL_KINDS, words: WORDS };
  const before = ai.records().length;
  try {
    const out = await ai.extract(inputs, { purpose: 'chat', counts: { characters: [...text].length } }, { review: (read) => reviewExtract(read, { text, trip, today: today.date, kinds: TRAVEL_KINDS, words: WORDS }) });
    const rec = ai.records().slice(before).at(-1) || {};
    return { objects: out.review.objects, unread: out.unread, tokens: { in: rec.tokensIn || 0, out: rec.tokensOut || 0 }, rounds: out.rounds };
  } catch (err) {
    const rec = ai.records().slice(before).at(-1) || {};
    return { objects: [], tokens: { in: rec.tokensIn || (err && err.tokens) || 0, out: rec.tokensOut || 0 }, error: scrub(String((err && err.message) || err)) };
  }
}

// Runs the samples one by one. `ai`: an Ai set up for the service; `prices` { in, out } US$ per million tokens; `cap` US$.
// `script(sample)`: called before each sample (the stand-in model is told its answer). Stops before a sample when the spend plus
// the largest one so far (for the first: its size at four characters a token plus the answer's room) would pass the cap, and
// after three failed answers in a row. Answers { results, spent, tokens, stopped }.
export async function evaluate({ ai, samples, prices = { in: 0, out: 0 }, cap = DEFAULT_CAP, script = null, scrub = (s) => s, progress = () => {} }) {
  const results = [];
  const tokens = { in: 0, out: 0 };
  let spent = 0;
  let biggest = 0;
  let failed = 0;
  let stopped = '';
  const answerRoom = require('../server/prompts').template('extract').budget.answer;
  for (const [n, sample] of samples.entries()) {
    const estimate = biggest || cost({ in: Math.ceil([...sample.text].length / 4) + 2000, out: answerRoom }, prices);
    if (spent + estimate > cap) { stopped = `Stopped before sample ${n + 1} of ${samples.length}: spending US$${(spent + estimate).toFixed(4)} would pass the cap of US$${cap}.`; break; }
    if (script) script(sample);
    const got = await extractOne(ai, sample, scrub);
    const c = cost(got.tokens, prices);
    spent += c;
    biggest = Math.max(biggest, c);
    tokens.in += got.tokens.in;
    tokens.out += got.tokens.out;
    const score = scoreObjects(sample.expected || [], got.objects);
    results.push({ sample, score, tokens: got.tokens, cost: c, error: got.error, objects: got.objects.length });
    progress(`${n + 1}/${samples.length} ${sample.file} ${score.points}/${score.possible}${got.error ? ` (${got.error})` : ''}`);
    failed = got.error ? failed + 1 : 0;
    if (failed >= 3) { stopped = 'Stopped: three answers in a row failed.'; break; }
  }
  return { results, spent, tokens, stopped, notRun: samples.slice(results.length).map((s) => s.file) };
}

// --- the report -------------------------------------------------------------------------------------------------------------
const pct = (p, q) => { const v = percent(p, q); return v === null ? '-' : `${v}%`; };
const line = (label, t) => `  ${label.padEnd(34)} ${String(t.points).padStart(4)} / ${String(t.possible).padEnd(4)} ${pct(t.points, t.possible).padStart(7)}`;
function block(title, part) {
  const out = [`${title} (${part.overall.samples} samples)`, line('overall', part.overall), 'By kind', ...Object.keys(part.byKind).sort().map((k) => line(`${k} (${part.byKind[k].samples})`, part.byKind[k])), 'By field'];
  for (const f of FIELDS) out.push(`${line(f, part.overall.fields[f])}${part.overall.fields[f].wrong ? `   (${part.overall.fields[f].wrong} wrong or invented)` : ''}`);
  return out;
}

export function report({ run, label, dry, cap, prices, realDir = '', notes = [] }) {
  const s = summarise(run.results);
  const out = [`Booking extraction evaluation${dry ? ' (stand-in model: nothing real was asked)' : ''}`, `Service: ${label}`, ''];
  out.push('Per sample', ...run.results.map((r) => `  ${r.sample.file.padEnd(46)} ${r.sample.mark.padEnd(15)} ${String(r.score.points).padStart(3)} / ${String(r.score.possible).padEnd(3)} ${pct(r.score.points, r.score.possible).padStart(7)}  tokens ${r.tokens.in}+${r.tokens.out}${r.error ? `  ERROR: ${r.error}` : ''}`), '');
  for (const mark of MARKS) {
    if (s.byMark[mark]) out.push(...block(`Samples marked ${mark}`, s.byMark[mark]), '');
    else if (mark === 'real-anonymised' && !realDir) out.push('Samples marked real-anonymised: none (no real samples: set EVAL_REAL_DIR).', '');
    else out.push(`Samples marked ${mark}: none${run.results.length ? '' : ' were run'}.`, '');
  }
  if (notes.length) out.push(...notes, '');
  out.push(...block('All samples together', s), '');
  out.push(`Tokens: ${run.tokens.in} read, ${run.tokens.out} written.`);
  out.push(`Estimated cost: US$${run.spent.toFixed(4)} of a cap of US$${cap}${prices.in || prices.out ? ` (US$${prices.in} in and US$${prices.out} out per million tokens)` : ' (no prices given, so no cost is counted)'}.`);
  if (run.stopped) out.push(run.stopped, `Not run: ${run.notRun.join(', ')}.`);
  return `${out.join('\n')}\n`;
}

// --- the command -------------------------------------------------------------------------------------------------------------
export function readSettings(env) {
  const provider = String(env.EVAL_AI_PROVIDER || '').trim();
  const num = (v) => (v === undefined || v === '' ? null : Number(v));
  const cap = num(env.EVAL_SPEND_CAP);
  return { provider, key: String(env.EVAL_AI_KEY || ''), model: String(env.EVAL_AI_MODEL || '').trim(), address: String(env.EVAL_AI_ADDRESS || '').trim(), priceIn: num(env.EVAL_PRICE_IN), priceOut: num(env.EVAL_PRICE_OUT), cap: cap === null ? DEFAULT_CAP : cap };
}

// An Ai (server/ai.js) for one service in a folder of its own; the service and key are put straight into what the server reads,
// so no file holds the key.
export function makeAi({ provider, key, model, address }, dir, hosts) {
  const { Ai, DEFAULT_MODELS } = require('../server/ai.js');
  const ai = new Ai(dir, {}, hosts);
  const use = { provider, address: provider === 'compatible' ? address : '', model: model || DEFAULT_MODELS[provider] || '', key, workspace: '' };
  ai.effective = () => ({ ...use });
  return { ai, model: use.model };
}

export async function main(argv, env, io = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }) {
  const dry = argv.includes('--dry-run');
  const at = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const reportPath = at('--report');
  const only = at('--only');
  const st = readSettings(env);
  const fail = (m) => { io.err(`${m}\n`); return 2; };
  if (!dry) {
    if (!st.provider) return fail('Set EVAL_AI_PROVIDER (openai, anthropic or compatible) to run against a real service, or use --dry-run.');
    if (!['openai', 'anthropic', 'compatible'].includes(st.provider)) return fail('EVAL_AI_PROVIDER must be openai, anthropic or compatible.');
    if (st.provider !== 'compatible' && !st.key) return fail('Set EVAL_AI_KEY to the provider\'s key.');
    if (st.provider === 'compatible' && !st.address) return fail('Set EVAL_AI_ADDRESS to the service\'s address.');
    if (!(st.priceIn >= 0) || !(st.priceOut >= 0) || st.priceIn === null || st.priceOut === null) return fail('Set EVAL_PRICE_IN and EVAL_PRICE_OUT (US$ per million tokens) so the spending cap can be kept.');
  }
  if (!(st.cap > 0)) return fail('EVAL_SPEND_CAP must be a number above 0 (US$).');
  const realDir = String(env.EVAL_REAL_DIR || '').trim();
  const notes = [];
  let samples;
  try { samples = loadSamples(GOLDEN, realDir, notes); } catch (err) { return fail(err.message); }
  for (const n of notes) io.err(`${n}\n`);
  if (only) samples = samples.filter((s) => s.file.includes(only));
  if (!samples.length) return fail('No samples to run.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-extract-'));
  const scrub = (text) => (st.key ? String(text).split(st.key).join('[key]') : String(text));
  let fake = null;
  try {
    let ai;
    let label;
    let script = null;
    if (dry) {
      const { startFakeModel } = await import('./fake-model.mjs');
      fake = await startFakeModel();
      ({ ai } = makeAi({ provider: 'compatible', key: '', model: 'stand-in', address: `${fake.url}/v1` }, dir));
      label = 'stand-in model';
      script = (s) => {
        const answer = s.standIn || { objects: [], unread: [] };
        fake.clear();
        fake.next({ json: answer, tokens: [Math.ceil(s.text.length / 4) + 1800, Math.ceil(JSON.stringify(answer).length / 4)] });
      };
    } else {
      let made;
      try { made = makeAi(st, dir); } catch (err) { return fail(scrub(err.message)); }
      ai = made.ai;
      label = `${st.provider}, model ${made.model}`;
    }
    const prices = { in: st.priceIn || 0, out: st.priceOut || 0 };
    const run = await evaluate({ ai, samples, prices, cap: st.cap, script, scrub, progress: (m) => io.err(`${m}\n`) });
    const text = report({ run, label, dry, cap: st.cap, prices, realDir, notes });
    if (reportPath) { fs.writeFileSync(reportPath, text); io.err(`Report written to ${reportPath}\n`); } else io.out(text);
    return 0;
  } finally {
    if (fake) await fake.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2), process.env).then((code) => process.exit(code), (err) => { process.stderr.write(`eval-extract: ${String((err && err.message) || err).replace(process.env.EVAL_AI_KEY || '\u0000', '[key]')}\n`); process.exit(1); });
}
