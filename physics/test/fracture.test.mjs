import { fractureVoronoi, makeSeeds, clipMesh } from '../src/fracture.mjs';
import { bbox, meshVolume, faceNormal } from '../src/geom.mjs';

function boxMesh(sx, sy, sz) {
  const h = [sx / 2, sy / 2, sz / 2];
  // normal, u, v with u x v == n, so every face winds CCW outward
  const axes = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  const pos = [], uv = [], idx = [];
  for (const [n, u, v] of axes) {
    const hn = Math.abs(n[0] * h[0] + n[1] * h[1] + n[2] * h[2]);
    const hu = Math.abs(u[0] * h[0] + u[1] * h[1] + u[2] * h[2]);
    const hv = Math.abs(v[0] * h[0] + v[1] * h[1] + v[2] * h[2]);
    const c = n.map(x => x * hn);
    const quad = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) =>
      [0, 1, 2].map(k => c[k] + u[k] * hu * su + v[k] * hv * sv));
    const b = pos.length / 3;
    quad.forEach((p, i) => {
      pos.push(...p);
      uv.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0);
    });
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { pos, uv, idx, material: 0 };
}

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };

// --- single plane clip keeps the expected volume -------------------------
const box = boxMesh(2, 2, 2);
const half = clipMesh(box, [1, 0, 0], 0);
const vHalf = meshVolume(half.pos, half.idx);
check(Math.abs(vHalf - 4) < 0.05, `plane clip volume 4.0 (got ${vHalf.toFixed(3)})`);
check(half.tri.filter(Boolean).length > 0, 'plane clip produced cap triangles');

// --- voronoi ------------------------------------------------------------
const seeds = [];
for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) seeds.push([x, y, z]);
const pieces = fractureVoronoi(box, seeds, { neighbors: 8, density: 1000 });
const total = pieces.reduce((s, p) => s + p.volume, 0);
check(pieces.length >= 6, `voronoi produced ${pieces.length} pieces from 8 seeds`);
check(Math.abs(total - 8) / 8 < 0.06, `volume conserved: ${total.toFixed(3)} / 8 (${(100 * Math.abs(total - 8) / 8).toFixed(1)}% lost)`);
check(pieces.every(p => p.uv && p.uv.length === p.pos.length / 3 * 2), 'every piece kept UVs');
check(pieces.every(p => p.idxCap.length > 0), 'every piece has break faces');
check(pieces.every(p => p.mass > 0 && Number.isFinite(p.mass)), 'every piece has finite mass');

// cap normals must point away from the piece centroid
let capOk = 0, capBad = 0;
for (const p of pieces) {
  const c = p.centroid;
  for (let t = 0; t < p.idxCap.length; t += 3) {
    const a = [p.pos[p.idxCap[t] * 3], p.pos[p.idxCap[t] * 3 + 1], p.pos[p.idxCap[t] * 3 + 2]];
    const b = [p.pos[p.idxCap[t + 1] * 3], p.pos[p.idxCap[t + 1] * 3 + 1], p.pos[p.idxCap[t + 1] * 3 + 2]];
    const d = [p.pos[p.idxCap[t + 2] * 3], p.pos[p.idxCap[t + 2] * 3 + 1], p.pos[p.idxCap[t + 2] * 3 + 2]];
    const n = faceNormal(a, b, d);
    const out = [(a[0] + b[0] + d[0]) / 3 - c[0], (a[1] + b[1] + d[1]) / 3 - c[1], (a[2] + b[2] + d[2]) / 3 - c[2]];
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] > 0) capOk++; else capBad++;
  }
}
check(capBad === 0, `cap winding outward (${capOk} ok, ${capBad} inverted)`);

// --- deterministic seeds ------------------------------------------------
const s1 = makeSeeds(bbox(box.pos), 12, [[0, 0, 0]], { seed: 7 });
const s2 = makeSeeds(bbox(box.pos), 12, [[0, 0, 0]], { seed: 7 });
check(JSON.stringify(s1) === JSON.stringify(s2), 'seed cloud is deterministic');
check(s1.length === 12, `seed count ${s1.length}`);

console.log(failures ? `\n${failures} failure(s)` : '\nall fracture tests passed');
process.exit(failures ? 1 : 0);
