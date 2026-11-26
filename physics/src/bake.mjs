#!/usr/bin/env node
// Bake a destruction shot into a deterministic clip for Three.js / Remotion.
//
//   node src/bake.mjs --shot examples/bridge/shot.json --out out/bridge
//
// Outputs
//   debris.glb  every piece as a node (piece_000...), original UVs/normals and
//               two materials per source material (surface + fresh break)
//   sim.json    per-frame rigid transforms, decals, splashes, chips, dust
//   shot.json   the resolved config that produced them
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGLB, writeGLB, sceneBounds } from './glb.mjs';
import { adjacency, fractureVoronoi, sampleSeeds } from './fracture.mjs';
import { bbox, meshVolume } from './geom.mjs';
import { simulate } from './sim.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

const num = (v, d) => (v === undefined ? d : Number(v));
const fmt = (n, d = 1) => Number(n).toFixed(d);

export async function bake(shotPath, opts = {}) {
  const t0 = Date.now();
  const shotDir = path.dirname(path.resolve(shotPath));
  const shot = JSON.parse(await readFile(shotPath, 'utf8'));
  if (opts.pieces) shot.fracture = { ...shot.fracture, pieces: Number(opts.pieces) };
  if (opts.fps) shot.fps = Number(opts.fps);
  if (opts.duration) shot.duration = Number(opts.duration);
  if (opts.seed) shot.seed = Number(opts.seed);

  const assetPath = path.resolve(shotDir, shot.asset);
  const outDir = path.resolve(opts.out ?? shot.out ?? 'out/bridge');
  await mkdir(outDir, { recursive: true });

  const log = opts.quiet ? () => {} : (...a) => console.log(...a);

  // ---- read ---------------------------------------------------------------
  const { meshes: source, materials } = await readGLB(assetPath, { up: shot.up ?? 'y' });
  const waterRe = new RegExp(shot.water?.mesh ?? 'water|ocean|sea|river|lake', 'i');
  const meshes = source.filter((m) => {
    if (m.idx.length < 12) return false;
    if (shot.water && waterRe.test(m.name)) return false;
    const b = bbox(m.pos);
    return b.size[0] > 1e-4 && b.size[1] > 1e-4 && b.size[2] > 1e-4;
  });
  if (!meshes.length) throw new Error(`no usable meshes in ${assetPath}`);
  log(`asset   ${path.relative(process.cwd(), assetPath)}  (${meshes.length} meshes, ${materials.length} materials)`);

  // ---- allocate piece budget ---------------------------------------------
  const targets = (shot.targets ?? []).map((t) => ({
    ...t,
    re: new RegExp(t.match ?? t.name ?? '.', 'i'),
  }));
  const groupOf = (mesh) => targets.find((t) => t.re.test(mesh.name) || t.re.test(mesh.meshName ?? ''));
  const volumeWeight = (m) => {
    const b = bbox(m.pos);
    return Math.max(1e-4, b.size[0] * b.size[1] * b.size[2]);
  };

  const groups = new Map();
  for (const m of meshes) {
    const g = groupOf(m) ?? { name: '__rest' };
    if (!groups.has(g)) groups.set(g, { pieces: g.pieces, meshes: [] });
    groups.get(g).meshes.push(m);
  }
  const globalPieces = shot.fracture?.pieces ?? 200;
  const budget = [];
  for (const [g, grp] of groups) {
    const total = g.pieces ?? globalPieces;
    const ws = grp.meshes.map(volumeWeight);
    const sum = ws.reduce((a, b) => a + b, 0);
    let left = total;
    grp.meshes.forEach((m, i) => {
      const n = Math.max(1, Math.min(left, Math.round((total * ws[i]) / sum)));
      budget.push({ mesh: m, count: n });
      left -= n;
    });
  }

  // ---- fracture -----------------------------------------------------------
  const seedsCfg = shot.fracture ?? {};
  const siteSigma = seedsCfg.siteSigma;
  const pieces = [];
  let srcVolume = 0;
  let srcTris = 0;
  for (let mi = 0; mi < budget.length; mi++) {
    const { mesh, count } = budget[mi];
    srcVolume += meshVolume(mesh.pos, mesh.idx);
    srcTris += mesh.idx.length / 3;
    const b = bbox(mesh.pos);
    const sites = (shot.charges ?? [])
      .map((c) => c.position)
      .filter((p) => p && Math.hypot(p[0] - (b.lo[0] + b.hi[0]) / 2, p[1] - (b.lo[1] + b.hi[1]) / 2, p[2] - (b.lo[2] + b.hi[2]) / 2) < Math.hypot(...b.size) * 1.2);
    const seedList = count === 1 && !seedsCfg.alwaysSplit
      ? [meshCentroidSafe(mesh)]
      : sampleSeeds(mesh, count, {
          seed: (shot.seed ?? 20261126) + mi * 7919,
          sites,
          siteShare: seedsCfg.siteShare ?? 0.55,
          siteSigma: siteSigma ?? Math.min(...b.size) * 0.6 + 0.4,
        });
    const cells = fractureVoronoi(
      { ...mesh, material: mesh.material },
      seedList,
      {
        neighbors: Math.min(seedsCfg.neighbors ?? 1e9, Math.max(2, count - 1)),
        density: seedsCfg.density ?? 2400,
        minVolume: seedsCfg.minVolume ?? 0.0004,
        capUvScale: seedsCfg.capUvScale ?? 1,
      },
    );
    for (const p of cells) pieces.push(p);
  }
  if (srcTris > 60000) log(`warn    source has ${srcTris} triangles; fracture cost is O(seeds*tris)`);

  const sumVolume = pieces.reduce((s, p) => s + p.volume, 0);
  log(`fracture ${pieces.length} pieces from ${budget.length} meshes, volume kept ${fmt((100 * sumVolume) / Math.max(1e-9, srcVolume), 2)}%`);

  const pairs = adjacency(pieces, shot.joints?.gap ?? 0.05);
  const joints = weldSet(pieces, pairs, shot.joints ?? {});
  log(`joints   ${joints.length} welds (${pairs.length} contacts)`);

  // ---- simulate -----------------------------------------------------------
  let sim = null;
  if (!opts.noSim) {
    sim = await simulate(pieces, joints, { ...shot, fps: shot.fps ?? 30 });
    const moving = sim.bodies.filter((b) => b.frames.length).length;
    log(`sim      ${sim.frames} frames @ ${sim.fps}fps, ${moving} moving pieces, ${sim.decals.length} decals, ${sim.splashes.length} splashes`);
  }

  // ---- write --------------------------------------------------------------
  const glbPieces = pieces.map((p, i) => {
    const c = p.centroid;
    const pos = new Float32Array(p.pos.length);
    for (let k = 0; k < p.pos.length; k += 3) {
      pos[k] = p.pos[k] - c[0];
      pos[k + 1] = p.pos[k + 1] - c[1];
      pos[k + 2] = p.pos[k + 2] - c[2];
    }
    return {
      name: `piece_${String(i).padStart(3, '0')}`,
      material: p.material,
      pos,
      nor: p.nor,
      uv: p.uv,
      idx: new Uint32Array(p.idx),
      idxCap: new Uint32Array(p.idxCap),
      translation: [c[0], c[1], c[2]],
    };
  });
  const glbPath = path.join(outDir, 'debris.glb');
  const glbBytes = await writeGLB(glbPath, glbPieces, materials);

  const bounds = sceneBounds(meshes);
  const resolved = {
    ...shot,
    asset: path.basename(assetPath),
    stats: {
      sourceMeshes: meshes.length,
      sourceTriangles: srcTris,
      pieces: pieces.length,
      joints: joints.length,
      volumeKept: sumVolume / Math.max(1e-9, srcVolume),
      bakeSeconds: (Date.now() - t0) / 1000,
    },
    bounds,
    materials: materials.map((m) => ({ name: m.name, color: m.color, avg: m.avg })),
  };
  const simPath = path.join(outDir, 'sim.json');
  let motionBytes = 0;
  if (sim) {
    // Pack per-frame transforms into one Float32 sidecar (7 floats/frame).
    const parts = [];
    let floatOffset = 0;
    for (const b of sim.bodies) {
      const arr = new Float32Array(b.frames.length * 7);
      for (let i = 0; i < b.frames.length; i++) {
        const f = b.frames[i];
        arr[i * 7] = f[1]; arr[i * 7 + 1] = f[2]; arr[i * 7 + 2] = f[3];
        arr[i * 7 + 3] = f[4]; arr[i * 7 + 4] = f[5]; arr[i * 7 + 5] = f[6]; arr[i * 7 + 6] = f[7];
      }
      b.motion = { offset: floatOffset, count: b.frames.length };
      delete b.frames;
      parts.push(arr);
      floatOffset += arr.length;
    }
    const all = new Float32Array(floatOffset);
    let at = 0;
    for (const part of parts) { all.set(part, at); at += part.length; }
    await writeFile(path.join(outDir, 'motion.bin'), Buffer.from(all.buffer));
    motionBytes = all.byteLength;
    sim.motion = 'motion.bin';
  }
  await writeFile(
    simPath,
    JSON.stringify({
      version: 1,
      asset: path.basename(assetPath),
      bounds,
      materials: resolved.materials,
      ...(sim ?? { fps: shot.fps ?? 30, frames: 0, bodies: [], decals: [], splashes: [], chips: [], dust: [], explosions: [] }),
    }),
  );
  await writeFile(path.join(outDir, 'shot.json'), JSON.stringify(resolved, null, 2));

  const glbSize = (await stat(glbPath)).size;
  const simSize = (await stat(simPath)).size;
  log(`wrote   ${glbPath} (${fmt(glbSize / 1e6, 2)} MB)`);
  log(`wrote   ${simPath} (${fmt(simSize / 1e6, 2)} MB)`);
  if (motionBytes) log(`wrote   ${path.join(outDir, 'motion.bin')} (${fmt(motionBytes / 1e6, 2)} MB)`);
  log(`done    ${fmt((Date.now() - t0) / 1000, 1)} s`);
  return { outDir, glbPath, simPath, glbSize, simSize, pieces: pieces.length, sim, resolved };
}

/**
 * Fixed joints are rigid constraints: a graph full of loops is over-constrained
 * and can blow up, especially with big mass ratios.  Weld a spanning forest
 * (every piece still attached, no cycles) plus a few redundant edges for
 * stiffness.
 */
export function weldSet(pieces, pairs, opts = {}) {
  const redundancy = opts.redundancy ?? 0.12;
  const maxExtra = opts.maxExtraPerPiece ?? 2;
  const dist = (i, j) => {
    const a = pieces[i].centroid, b = pieces[j].centroid;
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  };
  const order = pairs.map(([i, j]) => [i, j, dist(i, j)]).sort((a, b) => a[2] - b[2]);
  const parent = pieces.map((_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const kept = [];
  const extras = [];
  for (const [i, j] of order) {
    const a = find(i), b = find(j);
    if (a !== b) {
      parent[a] = b;
      kept.push([i, j]);
    } else {
      extras.push([i, j]);
    }
  }
  const degree = new Map();
  for (const [i, j] of kept) {
    degree.set(i, (degree.get(i) ?? 0) + 1);
    degree.set(j, (degree.get(j) ?? 0) + 1);
  }
  let budget = Math.round(kept.length * redundancy);
  for (const [i, j] of extras) {
    if (budget <= 0) break;
    if ((degree.get(i) ?? 0) >= maxExtra || (degree.get(j) ?? 0) >= maxExtra) continue;
    kept.push([i, j]);
    degree.set(i, (degree.get(i) ?? 0) + 1);
    degree.set(j, (degree.get(j) ?? 0) + 1);
    budget--;
  }
  return kept;
}

function meshCentroidSafe(mesh) {
  const b = bbox(mesh.pos);
  return [(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, (b.lo[2] + b.hi[2]) / 2];
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.shot) {
    console.error('usage: node src/bake.mjs --shot examples/bridge/shot.json [--out out/bridge] [--pieces N] [--no-sim]');
    process.exit(2);
  }
  bake(args.shot, {
    out: args.out,
    pieces: args.pieces,
    fps: args.fps,
    duration: args.duration,
    seed: args.seed,
    noSim: !!args['no-sim'],
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
