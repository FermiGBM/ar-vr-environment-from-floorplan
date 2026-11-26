#!/usr/bin/env node
// Copy a baked shot into remotion/public/ so Remotion can serve it.
//
//   node scripts/prepare.mjs                     # ../out/bridge -> public/bridge
//   node scripts/prepare.mjs --from ../out/bridge --shot bridge
//
// Runs automatically on `npm install` (npm's "prepare" lifecycle), and skips
// quietly when the bake has not been produced yet.
import { access, cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const shot = arg('shot', 'bridge');
const from = path.resolve(root, arg('from', path.join('..', 'out', shot)));
const to = path.join(root, 'public', shot);

const exists = (p) => access(p).then(() => true, () => false);

if (!(await exists(path.join(from, 'sim.json')))) {
  console.log(`[prepare] nothing at ${from} yet — run "node src/bake.mjs --shot examples/${shot}/shot.json --out out/${shot}" first`);
  process.exit(0);
}

await mkdir(to, { recursive: true });
for (const file of ['debris.glb', 'sim.json', 'motion.bin', 'shot.json']) {
  const src = path.join(from, file);
  if (!(await exists(src))) continue;
  await rm(path.join(to, file), { force: true });
  await cp(src, path.join(to, file));
  console.log(`[prepare] ${path.relative(root, src)} -> public/${shot}/${file}`);
}
console.log(`[prepare] shot "${shot}" ready`);
