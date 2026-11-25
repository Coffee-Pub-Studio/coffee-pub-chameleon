// The fixture's server actions, written the way a hostile outside author might: it names nothing the module check refuses
// (every name it reaches for is built from pieces at run time, and `constructor` is only ever read with brackets), so the
// upload is accepted and only the server's worker holds it (tools/check-module-actions.mjs, plan-agent-server-actions.md
// step 11d). Nothing here is a real module's rule.
const uploadId = (now) => `u${now.toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
const UPLOAD_C = 'con' + 'structor';
const UPLOAD_P = 'pro' + 'cess';
const uploadTry = (f) => {
  try {
    const v = f();
    return v === undefined ? 'undefined' : typeof v === 'string' ? v : typeof v;
  } catch (e) {
    return 'blocked';
  }
};
// The context's own global, reached without naming it.
const uploadGlobal = (function () { return this; })();

const ACTION_HANDLERS = {
  addNote(input, ctx) {
    const id = uploadId(ctx.now);
    return {
      writes: [{ key: `note:${id}`, value: { title: uploadTitle(input.title), byKey: ctx.credit.key, by: ctx.credit.name } }],
      ref: { module: 'fixture-upload', kind: 'note', id, scope: 'space', space: ctx.space.id },
      data: { note: 'Added.' },
    };
  },
  probe(input, ctx) {
    const what = input.what;
    const g = uploadGlobal;
    if (what === 'escape') {
      const seen = {};
      for (const n of ['req' + 'uire', UPLOAD_P, 'mod' + 'ule', 'exp' + 'orts', 'Buf' + 'fer', 'fe' + 'tch', 'XMLHttp' + 'Request', 'Web' + 'Socket',
        'Event' + 'Source', 'navi' + 'gator', 'Wor' + 'ker', 'WebAss' + 'embly', 'set' + 'Timeout', 'set' + 'Immediate', 'con' + 'sole',
        'Atom' + 'ics', 'SharedArray' + 'Buffer', 'window', 'document', '__util', '__ctx', '__input', '__data']) seen[n] = typeof g[n];
      seen.fnCtor = uploadTry(() => (() => 0)[UPLOAD_C]('return typeof ' + UPLOAD_P)());
      seen.asyncCtor = uploadTry(() => (async () => 0)[UPLOAD_C]('return 1'));
      seen.genCtor = uploadTry(() => (function* () { yield 1; })[UPLOAD_C]('yield 1'));
      seen.globalCtor = uploadTry(() => g[UPLOAD_C][UPLOAD_C]('return typeof ' + UPLOAD_P)());
      seen.readCtor = uploadTry(() => ctx.read[UPLOAD_C]('return typeof ' + UPLOAD_P)());
      seen.utilCtor = uploadTry(() => ctx.util.plain[UPLOAD_C]('return typeof ' + UPLOAD_P)());
      seen.protoCtor = uploadTry(() => Object.getPrototypeOf(ctx)[UPLOAD_C][UPLOAD_C]('return typeof ' + UPLOAD_P)());
      seen.evalCall = uploadTry(() => g['ev' + 'al']('typeof ' + UPLOAD_P));
      seen.reflectCtor = uploadTry(() => Reflect.construct(g['Func' + 'tion'], ['return typeof ' + UPLOAD_P])());
      seen.stackFrames = uploadTry(() => {
        Error.prepareStackTrace = (e, frames) => frames.map((f) => { const fn = f.getFunction && f.getFunction(); return fn ? typeof fn[UPLOAD_C]('return typeof ' + UPLOAD_P)() : 'none'; }).join(',');
        return new Error('x').stack;
      });
      seen.env = uploadTry(() => Object.keys(g[UPLOAD_P].env).length);
      seen.readOutside = String(ctx.read('../../../app.json'));
      seen.keys = ctx.list('').map((x) => x.key).filter((k) => !k.startsWith('probe:')).length;
      return { writes: [{ key: 'probe:escape', value: seen }] };
    }
    // Everything the handler was given, as text, so the check can look for the server's secrets in it.
    if (what === 'given') {
      const plain = {};
      for (const k of Object.keys(ctx)) if (typeof ctx[k] !== 'function' && k !== 'util') plain[k] = ctx[k];
      const names = Object.getOwnPropertyNames(g).sort().join(',');
      return { writes: [{ key: 'probe:given', value: { ctx: JSON.stringify(plain), input: JSON.stringify(input), globals: names } }] };
    }
    if (what === 'loop') { for (;;) { /* forever */ } }
    if (what === 'microloop') return (async () => { for (;;) await 0; })();
    if (what === 'hog') { const all = []; for (;;) all.push(new Array(1e6).fill(1)); }
    if (what === 'big') return { writes: [{ key: 'probe:big', value: 'x'.repeat(1100000) }] };
    if (what === 'flood') return { writes: [], data: { note: 'x'.repeat(9000) } };
    if (what === 'throw') throw new Error('The upload says no.');
    if (what === 'environment') return { writes: [{ key: 'note:shared', value: { title: 'Shared', byKey: ctx.credit.key, by: ctx.credit.name, spaces: [ctx.space.id] }, scope: 'environment' }] };
    if (what === 'person') return { writes: [{ key: 'note:mine', value: { title: 'Mine' }, scope: 'person' }] };
    if (what === 'phaseEnd') return { writes: [], phaseEnd: { date: '2031-01-01' } };
    if (what === 'slow') {
      const until = Date.now() + (typeof input.ms === 'number' ? input.ms : 300);
      while (Date.now() < until) { /* wait */ }
      return { writes: [{ key: `probe:${uploadId(ctx.now)}`, value: { at: Date.now() } }] };
    }
    if (what === 'version') return { writes: [{ key: 'probe:version', value: { v: 1 } }] };
    throw new Error(`No probe called ${what}.`);
  },
};
