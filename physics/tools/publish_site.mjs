#!/usr/bin/env node
// Assemble a self-contained copy of the preview under ../docs/physics so GitHub
// Pages can serve it: vendored three.js, the runtime, and one or more baked
// shots.  Everything the page fetches is committed, so no build step runs on the
// server.
//
//   node tools/publish_site.mjs                 # bridge only
//   node tools/publish_site.mjs --shots bridge,implode
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const site = path.resolve(root, '..', 'docs', 'physics');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const shots = arg('shots', 'bridge').split(',').map((s) => s.trim()).filter(Boolean);
const exists = (p) => access(p).then(() => true, () => false);

// where each baked shot lives, and where it goes under the published folder
const shotMap = {
  bridge: { from: 'out/bridge', to: 'shots/bridge' },
  implode: { from: 'out/implode', to: 'shots/implode' },
};

// three itself plus the addons the preview imports.  Addons pull in other
// addons by relative path, so follow those imports instead of listing files by
// hand (GLTFLoader -> utils/BufferGeometryUtils, for instance).
const VENDOR_ADDONS = [
  'controls/OrbitControls.js',
  'environments/RoomEnvironment.js',
  'loaders/GLTFLoader.js',
];

const put = async (from, to) => {
  const dst = path.join(site, to);
  await mkdir(path.dirname(dst), { recursive: true });
  await copyFile(from, dst);
  return dst;
};

const copied = [];
const missing = [];

const threeModule = path.join(root, 'node_modules', 'three', 'build', 'three.module.js');
if (await exists(threeModule)) copied.push(await put(threeModule, 'vendor/three.module.js'));
else missing.push('three/build/three.module.js');

const seen = new Set();
const vendorAddon = async (rel) => {
  if (seen.has(rel)) return;
  seen.add(rel);
  const from = path.join(root, 'node_modules', 'three', 'examples', 'jsm', ...rel.split('/'));
  if (!(await exists(from))) {
    missing.push(`three/examples/jsm/${rel}`);
    return;
  }
  copied.push(await put(from, `vendor/addons/${rel}`));
  const text = await readFile(from, 'utf8');
  for (const m of text.matchAll(/from\s+'(\.\.?\/[^']+)'/g)) {
    await vendorAddon(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
  }
};
for (const rel of VENDOR_ADDONS) await vendorAddon(rel);

copied.push(await put(path.join(root, 'src', 'debris.mjs'), 'src/debris.mjs'));

// the preview page: same file as local dev, with the import map pointed at the
// vendored three.js and a sensible default shot
const page = await readFile(path.join(root, 'preview', 'index.html'), 'utf8');
const published = page
  .replace(
    '"three": "../node_modules/three/build/three.module.js"',
    '"three": "./vendor/three.module.js"',
  )
  .replace('"three/addons/": "../node_modules/three/examples/jsm/"', '"three/addons/": "./vendor/addons/"')
  .replace("'../src/debris.mjs'", "'./src/debris.mjs'")
  .replace("params.get('shot') ?? '../out/bridge/'", "params.get('shot') ?? 'shots/bridge/'");
await mkdir(site, { recursive: true });
await writeFile(path.join(site, 'index.html'), published);
copied.push(path.join(site, 'index.html'));

for (const name of shots) {
  const map = shotMap[name];
  if (!map) {
    missing.push(`unknown shot "${name}" (known: ${Object.keys(shotMap).join(', ')})`);
    continue;
  }
  const from = path.join(root, map.from);
  if (!(await exists(path.join(from, 'sim.json')))) {
    missing.push(`${map.from}/sim.json — bake it first`);
    continue;
  }
  for (const file of ['debris.glb', 'sim.json', 'motion.bin', 'shot.json']) {
    if (await exists(path.join(from, file))) {
      copied.push(await put(path.join(from, file), `${map.to}/${file}`));
    }
  }
}

for (const f of copied) console.log(`  ${path.relative(path.resolve(root, '..'), f)}`);
if (missing.length) {
  console.log('\nskipped:');
  for (const m of missing) console.log(`  ${m}`);
}
console.log(`\npublished ${copied.length} file(s) to ${path.relative(path.resolve(root, '..'), site)}`);
console.log('remember to link it from docs/index.html');
