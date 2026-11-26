// End-to-end bake test: build the demo bridge, run a full simulation bake, and
// check the artefacts a renderer depends on (piece count, fall distance, water
// hits, per-piece transforms, paired break materials).
//
//   node test/bake.test.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bake } from '../src/bake.mjs';
import { readGLB } from '../src/glb.mjs';
import { loadShot } from '../tools/simstats.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures++;
};

const out = mkdtempSync(path.join(tmpdir(), 'bake-test-'));
const shot = path.join(root, 'examples/bridge/shot.json');

execFileSync('node', [path.join(root, 'src/make_demo_bridge.mjs')], { cwd: root });

const t0 = Date.now();
const baked = await bake(shot, { out });
const seconds = (Date.now() - t0) / 1000;

check(baked, 'bake returns a result');
const stats = baked.resolved.stats;
check(stats.volumeKept > 0.999, `fracture keeps volume (${(stats.volumeKept * 100).toFixed(2)}%)`);
check(stats.pieces > 200, `fracture produced ${stats.pieces} pieces`);
check(stats.joints > 100, `joint network has ${stats.joints} welds`);
check(seconds < 60, `bake finished in ${seconds.toFixed(1)}s`);
check(baked.glbSize > 5e5, `debris.glb is ${(baked.glbSize / 1e6).toFixed(2)} MB`);

// every source material gets a matching "__break" material
const { materials } = await readGLB(path.join(out, 'debris.glb'));
const names = new Set(materials.map((m) => m.name));
const broken = materials.filter((m) => m.name.endsWith('__break'));
check(broken.length > 0, `${broken.length} paired break materials`);
check(
  materials.every((m) => !m.name.endsWith('__break') || names.has(m.name.replace(/__break$/, ''))),
  'every break material has a surface twin',
);
check(
  broken.every((m) => (m.roughness ?? 0) > 0.9 && (m.metallic ?? 0) === 0),
  'break faces are rough and non-metallic',
);

// ---- motion ---------------------------------------------------------------
const { sim, motion, at } = await loadShot(out);
check(!!motion, `motion sidecar has ${(motion.byteLength / 1e6).toFixed(2)} MB of transforms`);
check(sim.frames >= 60, `${sim.frames} frames @ ${sim.fps}fps`);

const released = sim.bodies.filter((b) => b.releaseFrame !== null);
check(released.length > 100, `${released.length} pieces released`);

// Mass-weighted height of the released superstructure: individual pieces may
// legitimately come to rest on a pier cap, but the bulk of the tonnage must go
// down, and nothing may be launched upward.
const heavyY = (f) => {
  let m = 0;
  let y = 0;
  for (const b of released) {
    m += b.mass;
    y += b.mass * at(b, f).y;
  }
  return y / m;
};
const yMaxAt = (f) => Math.max(...released.map((b) => at(b, f).y));
const start = heavyY(0);
const mid = heavyY(Math.round(sim.frames * 0.4));
const end = heavyY(sim.frames);
check(end < start - 3, `superstructure settles from y=${start.toFixed(1)} to y=${end.toFixed(1)}`);
check(mid < start + 1.5, `nothing explodes upward (mid y=${mid.toFixed(1)})`);
const belowDeck = released.filter((b) => at(b, sim.frames).y < 0).length;
check(
  belowDeck / released.length > 0.75,
  `${belowDeck}/${released.length} released pieces end below deck level`,
);
check(yMaxAt(sim.frames) < yMaxAt(0) + 0.5, 'no released piece is thrown above its start');

// every released piece must have at least one recorded transform
const missing = released.filter((b) => !b.motion || b.motion.count === 0);
check(missing.length === 0, `${missing.length} released pieces without motion`);

// transforms stay finite
let bad = 0;
for (const b of sim.bodies) {
  const p = at(b, sim.frames);
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) bad++;
}
check(bad === 0, `${bad} non-finite transforms`);

// ---- events ---------------------------------------------------------------
check(sim.splashes.length > 50, `${sim.splashes.length} water impacts`);
check(sim.splashes.every((s) => Math.abs(s.position[1] - sim.water.level) < 0.01), 'splashes sit on the water line');
check(sim.decals.length > 0, `${sim.decals.length} gunshot decals`);

console.log(`\nartefacts in ${out}`);
console.log(failures ? `${failures} failure(s)` : 'all bake tests passed');
process.exit(failures ? 1 : 0);
