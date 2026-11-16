#!/usr/bin/env node
// A space's icon is the same everywhere: its link icon, else the template's home icon, else `folder` (the server's
// spaceSummary). The public branding carries `templateHomeIcon` so the pages can do the same; read as code. Icons in
// use that no list offers any more are drawn through brand.js iconClasses from branding's `inUseIcons`, never offered
// (iconClasses itself is run here on lists).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const server = read('server/index.js');
const brand = read('public/brand.js');
const profile = read('public/profile.js');
const space = read('public/space.js');
const problems = [];
const must = (ok, msg) => { if (!ok) problems.push(msg); };

const branding = server.match(/function branding\(\) \{[\s\S]*?\n\}/)[0];
must(/templateHomeIcon: store\.templateHomeIcon \|\| null/.test(branding), 'branding() does not carry templateHomeIcon');
must(/store\.templateHomeIcon \|\| SPACE_ICON/.test(server) && /const SPACE_ICON = 'folder'/.test(server), "the server's spaceSummary fallback changed");
must(/b\.templateHomeIcon/.test(brand), 'brand.js does not read branding.templateHomeIcon');
must(/templateHomeIcon \|\| 'folder'/.test(brand), "brand.js spaceIconId does not fall back to the template's home icon, then folder");
must(/spaceIconId\(spacesById\.get\(id\)\)/.test(profile), "profile.js does not use spaceIconId for a space's icon");
must(!/linkIcon !== 'link' \? [^:]+ : 'folder'/.test(profile), 'profile.js still falls back to folder by itself');
must(/spaceCrumbIcon\(null\)/.test(space) && !/'message'/.test(space.match(/const iconOf = .*/)[0]), "space.js uses a chat icon when no space is open");
// Icons in use that the offered list no longer holds (a template switch took away the one that offered them) are drawn,
// never offered: branding carries them apart (inUseIcons), iconClasses looks in the offered list, then in them, then
// draws the chain link; getIcons, which every picker reads, is the offered list alone, and no page reads inUseIcons.
must(/inUseIcons: store\.lookOf\(null\)\.inUseIcons/.test(branding), 'branding() does not carry inUseIcons');
must(/IN_USE_ICONS = Array\.isArray\(b\.inUseIcons\) \? b\.inUseIcons : \[\]/.test(brand), 'brand.js does not keep branding.inUseIcons');
must(/export const getIcons = \(\) => ICONS;/.test(brand), 'getIcons is not the offered list alone');
for (const f of fs.readdirSync(path.join(root, 'public'), { recursive: true }).filter((f) => String(f).endsWith('.js') && String(f) !== 'brand.js')) {
  must(!/inUseIcons|IN_USE_ICONS/.test(read(path.join('public', String(f)))), `public/${f} reads the icons in use: only brand.js iconClasses may`);
}
const fnSource = brand.match(/export function iconClasses\(id\) \{[\s\S]*?\n\}/);
must(Boolean(fnSource), 'brand.js has no iconClasses');
if (fnSource) {
  const make = (ICONS, IN_USE_ICONS) => new Function('ICONS', 'IN_USE_ICONS', `${fnSource[0].replace('export ', '')}; return iconClasses;`)(ICONS, IN_USE_ICONS);
  const offered = [{ id: 'dragon', classes: 'fa-solid fa-dragon' }, { id: 'discord', classes: 'fa-brands fa-discord' }];
  const inUse = [{ id: 'diagram-project', classes: 'fa-solid fa-diagram-project' }, { id: 'discord', classes: 'fa-solid fa-discord' }];
  const draw = make(offered, inUse);
  must(draw('dragon') === 'fa-solid fa-dragon', 'iconClasses: an offered icon');
  must(draw('diagram-project') === 'fa-solid fa-diagram-project', 'iconClasses: an icon in use the list no longer offers is drawn, not the chain link');
  must(draw('discord') === 'fa-brands fa-discord', 'iconClasses: the offered list first');
  must(draw('nothing-here') === 'fa-solid fa-link', 'iconClasses: an id in neither draws the chain link');
  must(make([], [])('dragon') === 'fa-solid fa-dragon', 'iconClasses: before the list loads, the id itself');
}
assert.deepEqual(problems, [], problems.join('\n'));
console.log('check-space-icon: OK');
