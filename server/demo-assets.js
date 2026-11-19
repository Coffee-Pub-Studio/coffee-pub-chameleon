// The files a demo makes for itself: profile pictures, call backgrounds, and the Vault's trip documents. Every one is drawn
// here, by code, from the few words a demo file gives it (templates/demo/<template id>.json: "files" and a person's "images"):
// small illustrated pictures, a plain PDF, a Markdown note. Nothing is a photograph, nothing is copied from anywhere, and no
// name, number or address in them is real. server/demo-loader.js sends each through the real upload routes.
'use strict';

const zlib = require('zlib');

// --- PNG -------------------------------------------------------------------------------------------------------------
const CRC_STEPS = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_STEPS[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
// `pixel(x, y)` answers [r, g, b]; each row is stored as the difference from the row above (filter 2), which keeps smooth pictures small.
function png(w, h, pixel) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  let above = Buffer.alloc(stride);
  for (let y = 0; y < h; y += 1) {
    const row = Buffer.alloc(stride);
    for (let x = 0; x < w; x += 1) { const [r, g, b] = pixel(x, y); row[x * 3] = r; row[x * 3 + 1] = g; row[x * 3 + 2] = b; }
    raw[y * (stride + 1)] = y ? 2 : 0;
    for (let i = 0; i < stride; i += 1) raw[y * (stride + 1) + 1 + i] = y ? (row[i] - above[i]) & 0xff : row[i];
    above = row;
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
// Four samples a pixel, so edges are soft.
function sampled(w, h, shade) {
  return (x, y) => {
    const acc = [0, 0, 0];
    for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) { const c = shade(x + dx, y + dy); acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; }
    return acc.map((v) => Math.round(v / 4));
  };
}

// A round illustrated face and shoulders on a soft gradient: spec { skin, hair, shirt, top, bottom, style: 'short' | 'long' | 'curly' }.
function avatar(spec) {
  const S = 256;
  const skin = hex(spec.skin); const hair = hex(spec.hair); const shirt = hex(spec.shirt);
  const top = hex(spec.top); const bottom = hex(spec.bottom);
  const style = spec.style || 'short';
  const shade = (x, y) => {
    let c = mix(top, bottom, y / S);
    const inEllipse = (cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
    if (style === 'long' && (inEllipse(128, 118, 62, 74) && y > 100)) c = hair;
    if (inEllipse(128, 262, 96, 84)) c = shirt;
    if (inEllipse(128, 180, 15, 26)) c = mix(skin, [0, 0, 0], 0.08);
    if (inEllipse(128, 104, 42, 48)) c = skin;
    if (inEllipse(128, 94, 46, 46) && y < (style === 'curly' ? 104 : 92) + (Math.abs(x - 128) > 38 ? 18 : 0)) c = hair;
    if (style === 'curly') for (const [cx, cy] of [[92, 78], [112, 62], [144, 62], [164, 78], [88, 100], [168, 100]]) if (inEllipse(cx, cy, 20, 20)) c = hair;
    if (inEllipse(112, 108, 4.5, 5.5) || inEllipse(144, 108, 4.5, 5.5)) c = [40, 32, 30];
    if (inEllipse(128, 128, 15, 6) && y > 128) c = [150, 78, 70];
    return c;
  };
  return { bytes: png(S, S, sampled(S, S, shade)), type: 'image/png' };
}

// A soft pattern for behind a camera: a gradient with diagonal bands and large circles. spec { from, to, band, ring }.
function backdrop(spec) {
  const W = 640; const H = 360;
  const from = hex(spec.from); const to = hex(spec.to); const band = hex(spec.band); const ring = hex(spec.ring);
  const shade = (x, y) => {
    let c = mix(from, to, (x / W) * 0.6 + (y / H) * 0.4);
    if (((x + y) % 120) < 36) c = mix(c, band, 0.18);
    const d = Math.hypot(x - W * 0.78, y - H * 0.35);
    if (d < 120) c = mix(c, ring, 0.28);
    if (d < 70) c = mix(c, ring, 0.28);
    return c;
  };
  return { bytes: png(W, H, sampled(W, H, shade)), type: 'image/png' };
}

// An illustrated view, not a photograph: sky, sun, hills or houses, water. spec { sky: [top, bottom], sun, ground, near, scene }.
function view(spec, w = 640, h = 420) {
  const [skyTop, skyBottom] = spec.sky.map(hex);
  const sun = hex(spec.sun); const ground = hex(spec.ground); const near = hex(spec.near);
  const horizon = h * 0.62;
  const houses = [];
  for (let i = 0; i < 14; i += 1) houses.push({ x: i * (w / 13) - 20, w: 40 + ((i * 37) % 38), h: 40 + ((i * 53) % 70) });
  const shade = (x, y) => {
    let c = mix(skyTop, skyBottom, y / horizon);
    if (Math.hypot(x - w * 0.72, y - h * 0.3) < 38) c = sun;
    if (spec.scene === 'hills') {
      const hill = horizon - 60 - 50 * Math.sin(x / 90) - 25 * Math.sin(x / 37 + 1);
      if (y > hill) c = mix(ground, near, (y - hill) / 120);
    } else if (spec.scene === 'roofs') {
      for (const b of houses) if (x >= b.x && x <= b.x + b.w && y >= horizon - b.h) c = ((x - b.x) % 14 < 5 && (y - horizon) % 16 < 6 && y > horizon - b.h + 10) ? mix(ground, [250, 226, 150], 0.7) : ground;
      if (y > horizon) c = near;
    } else {
      if (y > horizon) c = mix(near, ground, 0.5 + 0.5 * Math.sin(y / 5 + Math.sin(x / 30) * 2));
      for (let i = 0; i < 9; i += 1) { const bx = 30 + i * 72; const bh = 50 + ((i * 41) % 60); if (x >= bx && x <= bx + 52 && y >= horizon - bh && y <= horizon) c = mix(ground, [236, 190, 130], (i % 3) * 0.25); }
    }
    return c;
  };
  return { bytes: png(w, h, sampled(w, h, shade)), type: 'image/png' };
}

// --- PDF -------------------------------------------------------------------------------------------------------------
const pdfText = (s) => String(s).replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '?');
// spec { title, lines: [text], route?: { points: [[x, y]], labels: [[x, y, text]] } }: one page, plain text and a few lines.
function pdf(spec) {
  let body = 'BT /F2 20 Tf 56 780 Td (' + pdfText(spec.title) + ') Tj ET\n0.7 0.7 0.7 RG 56 768 m 540 768 l S\n';
  let y = 740;
  for (const line of spec.lines || []) { body += `BT /F1 12 Tf 56 ${y} Td (${pdfText(line)}) Tj ET\n`; y -= 20; }
  if (spec.route) {
    body += '0.9 0.93 0.95 rg 56 90 484 420 re f 0.2 0.5 0.6 RG 3 w\n';
    spec.route.points.forEach(([px, py], i) => { body += `${56 + px} ${90 + py} ${i ? 'l' : 'm'}\n`; });
    body += 'S 0.9 0.35 0.3 rg\n';
    for (const [px, py] of spec.route.points) body += `${56 + px - 5} ${90 + py - 5} 10 10 re f\n`;
    for (const [px, py, t] of spec.route.labels) body += `BT /F2 12 Tf 0.1 0.15 0.25 rg ${56 + px + 10} ${90 + py + 6} Td (${pdfText(t)}) Tj ET\n`;
  }
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 596 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];
  let out = '%PDF-1.4\n';
  const at = [];
  objects.forEach((o, i) => { at.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${at.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { bytes: Buffer.from(out, 'latin1'), type: 'application/pdf' };
}

function markdown(spec) { return { bytes: Buffer.from(`${(spec.lines || []).join('\n')}\n`, 'utf8'), type: 'text/markdown' }; }

// What a demo file's "art" word makes. `{ art: 'avatar', ... }` answers { bytes, type }.
const ARTS = { avatar, backdrop, view, pdf, markdown };
function makeAsset(spec) {
  const make = spec && ARTS[spec.art];
  if (!make) throw new Error(`There is no demo picture or file called "${spec && spec.art}".`);
  return make(spec);
}
// The small picture of a view, for the Vault's grid.
const thumbOf = (spec) => view(spec, 160, 105);

module.exports = { makeAsset, thumbOf, ARTS };
