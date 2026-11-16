'use strict';

// Test only (tools/check-agent-tokens.mjs): loaded with `node -r` ahead of server/index.js, never by the server itself.
// It notes the path every layer of Express's router was added with (the router keeps only a matcher, not the path), and
// when the app starts listening writes every layer of the app's router stack, mounted routers walked into, in order, to
// the file ROUTE_WALK_OUT names:
//   { kind: 'route', method, path, mount }  a route (`mount`: the prefix of the router it is in, '' or '/' for the app's own) (one entry per method; `_all` for app.all)
//   { kind: 'use', name, path }        a middleware or a mounted app (express.static, say), with the path it was added at
//   { kind: 'unknown', name }          a layer this file could not read the path of: the check fails on it
const fs = require('fs');
const path = require('path');

const express = require('express');
const Router = require(require.resolve('router', { paths: [require.resolve('express')] }));

const useOriginal = Router.prototype.use;
Router.prototype.use = function use(...args) {
  const before = this.stack.length;
  const out = useOriginal.apply(this, args);
  const at = typeof args[0] === 'string' ? args[0] : '/';
  for (const layer of this.stack.slice(before)) layer.walkPath = Array.isArray(args[0]) ? null : at;
  return out;
};

const join = (a, b) => (`${a}/${b}`).replace(/\/+/g, '/').replace(/(.)\/$/, '$1');

function walk(router, prefix, out) {
  for (const layer of router.stack) {
    if (layer.route) {
      const p = layer.route.path;
      if (typeof p !== 'string') { out.push({ kind: 'unknown', name: `route ${String(p)}` }); continue; }
      for (const m of Object.keys(layer.route.methods)) out.push({ kind: 'route', method: m === '_all' ? '_all' : m.toUpperCase(), path: join(prefix, p), mount: prefix });
    } else if (typeof layer.walkPath !== 'string') {
      out.push({ kind: 'unknown', name: layer.name });
    } else if (layer.handle && Array.isArray(layer.handle.stack)) {
      walk(layer.handle, join(prefix, layer.walkPath), out);
    } else {
      out.push({ kind: 'use', name: layer.name, path: join(prefix, layer.walkPath) });
    }
  }
}

const listenOriginal = express.application.listen;
express.application.listen = function listen(...args) {
  const out = [];
  walk(this.router, '', out);
  if (process.env.ROUTE_WALK_OUT) fs.writeFileSync(path.resolve(process.env.ROUTE_WALK_OUT), JSON.stringify(out));
  return listenOriginal.apply(this, args);
};
