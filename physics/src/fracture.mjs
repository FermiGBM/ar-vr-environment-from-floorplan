// Voronoi fracture that preserves the source mesh's UVs, normals and material
// identity.
//
// Every output piece is made of the original triangles (clipped) plus capped cut
// faces.  Triangles [idx, idxCap) are original surface; idxCap holds the fresh
// break faces, so the exporter can give them their own "interior" material
// derived from the source albedo instead of a generic grey.
import earcut from 'earcut';
import { EPS, bbox, meshCentroid, meshVolume, mulberry32 } from './geom.mjs';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function basis(n) {
  // u x v == n, so a CCW loop in (u,v) has normal +n
  const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize([
    a[1] * n[2] - a[2] * n[1],
    a[2] * n[0] - a[0] * n[2],
    a[0] * n[1] - a[1] * n[0],
  ]);
  const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  return [u, v];
}

/**
 * Keep the half-space n·p - c >= 0.  Adds a capped cut face whose outward
 * normal is -n (the solid sits on the +n side).
 */
export function clipMesh(mesh, n, c, opts = {}) {
  const out = { pos: [], nor: mesh.nor ? [] : null, uv: mesh.uv ? [] : null, idx: [], tri: [] };
  const segs = [];
  const { pos: P, nor: N, uv: U, idx: I } = mesh;
  const srcTri = mesh.tri;
  const hasUv = !!U;
  const hasN = !!N;

  const pushV = (p, u, nn) => {
    const i = out.pos.length / 3;
    out.pos.push(p[0], p[1], p[2]);
    if (hasUv) out.uv.push(u ? u[0] : 0, u ? u[1] : 0);
    if (hasN) out.nor.push(nn[0], nn[1], nn[2]);
    return i;
  };
  const pushTri = (a, b, cc, type) => {
    const ia = pushV(a.p, a.u, a.n), ib = pushV(b.p, b.u, b.n), ic = pushV(cc.p, cc.u, cc.n);
    out.idx.push(ia, ib, ic);
    out.tri.push(type);
  };

  for (let t = 0; t < I.length; t += 3) {
    const ia = I[t], ib = I[t + 1], ic = I[t + 2];
    const a = [P[ia * 3], P[ia * 3 + 1], P[ia * 3 + 2]];
    const b = [P[ib * 3], P[ib * 3 + 1], P[ib * 3 + 2]];
    const d = [P[ic * 3], P[ic * 3 + 1], P[ic * 3 + 2]];
    const ua = hasUv ? [U[ia * 2], U[ia * 2 + 1]] : null;
    const ub = hasUv ? [U[ib * 2], U[ib * 2 + 1]] : null;
    const uc = hasUv ? [U[ic * 2], U[ic * 2 + 1]] : null;
    const fn = normalize([
      (b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]),
      (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]),
      (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]),
    ]);
    const na = hasN ? [N[ia * 3], N[ia * 3 + 1], N[ia * 3 + 2]] : fn;
    const nb = hasN ? [N[ib * 3], N[ib * 3 + 1], N[ib * 3 + 2]] : fn;
    const nc = hasN ? [N[ic * 3], N[ic * 3 + 1], N[ic * 3 + 2]] : fn;
    const da = dot(n, a) - c, db = dot(n, b) - c, dc = dot(n, d) - c;

    if (da >= -EPS && db >= -EPS && dc >= -EPS) {
      pushTri(
        { p: a, u: ua, n: na }, { p: b, u: ub, n: nb }, { p: d, u: uc, n: nc },
        srcTri ? srcTri[t / 3] : 0,
      );
      continue;
    }
    if (da <= EPS && db <= EPS && dc <= EPS) continue;

    const poly = [];
    const edges = [
      [a, b, da, db, ua, ub, na, nb],
      [b, d, db, dc, ub, uc, nb, nc],
      [d, a, dc, da, uc, ua, nc, na],
    ];
    for (const [A, B, dA, dB, uA, uB, nA, nB] of edges) {
      if (dA >= -EPS) poly.push({ p: A, u: uA, n: nA });
      if ((dA > EPS && dB < -EPS) || (dA < -EPS && dB > EPS)) {
        const tt = dA / (dA - dB);
        poly.push({
          p: lerp3(A, B, tt),
          u: hasUv ? [uA[0] + (uB[0] - uA[0]) * tt, uA[1] + (uB[1] - uA[1]) * tt] : null,
          n: normalize(lerp3(nA, nB, tt)),
        });
      }
    }
    const clean = [];
    for (const q of poly) {
      const last = clean[clean.length - 1];
      if (!last || Math.hypot(q.p[0] - last.p[0], q.p[1] - last.p[1], q.p[2] - last.p[2]) > 1e-9) clean.push(q);
    }
    if (clean.length >= 3) {
      const ty = srcTri ? srcTri[t / 3] : 0;
      for (let k = 1; k + 1 < clean.length; k++) pushTri(clean[0], clean[k], clean[k + 1], ty);
      const on = clean.filter((q) => Math.abs(dot(n, q.p) - c) <= 1e-5);
      if (on.length === 2) segs.push([on[0].p, on[1].p]);
    }
  }

  if (segs.length) addCaps(out, segs, n, opts);
  return out;
}

function addCaps(out, segs, n, opts) {
  const scale = opts.capUvScale ?? 1;
  const keyOf = (p) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
  const pts = new Map();
  const edges = [];
  for (const [a, b] of segs) {
    const ka = keyOf(a), kb = keyOf(b);
    if (ka === kb) continue;
    if (!pts.has(ka)) pts.set(ka, a);
    if (!pts.has(kb)) pts.set(kb, b);
    edges.push([ka, kb]);
  }
  if (!edges.length) return;

  const adj = new Map();
  edges.forEach(([a, b], i) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(i);
    adj.get(b).push(i);
  });

  const used = new Array(edges.length).fill(false);
  const [uAx, vAx] = basis(n);
  let guard = 0;
  for (let e0 = 0; e0 < edges.length; e0++) {
    if (used[e0]) continue;
    const loopKeys = [];
    let cur = e0;
    const start = edges[e0][0];
    let node = edges[e0][1];
    used[e0] = true;
    loopKeys.push(start, node);
    let closed = false;
    while (guard++ < edges.length * 4) {
      if (node === start) { closed = true; break; }
      const cands = (adj.get(node) || []).filter((i) => !used[i]);
      if (!cands.length) break;
      const nxt = cands[0];
      used[nxt] = true;
      const [x, y] = edges[nxt];
      node = x === node ? y : x;
      loopKeys.push(node);
    }
    if (!closed || loopKeys.length < 4) continue;

    const keys = loopKeys.slice(0, -1);
    const flat = [];
    const coords = [];
    for (const k of keys) {
      const p = pts.get(k);
      const x = dot(p, uAx) / scale, y = dot(p, vAx) / scale;
      flat.push(x, y);
      coords.push([x, y]);
    }
    const tris = earcut(flat);
    if (!tris.length) continue;
    // earcut normalises ring winding, so orient from the first emitted triangle:
    // CCW in (u,v) has normal +n, and the cap must face -n.
    // earcut always emits CCW triangles in (u,v); a CCW triangle has normal +n,
    // and the cap must face -n, so reverse every triangle.
    const base = out.pos.length / 3;
    for (const k of keys) {
      const p = pts.get(k);
      out.pos.push(p[0], p[1], p[2]);
      if (out.uv) out.uv.push(dot(p, uAx) / scale, dot(p, vAx) / scale);
      if (out.nor) out.nor.push(-n[0], -n[1], -n[2]);
    }
    for (let i = 0; i < tris.length; i += 3) {
      out.idx.push(base + tris[i], base + tris[i + 2], base + tris[i + 1]);
      out.tri.push(1); // fresh break face
    }
  }
}

function finalize(mesh, material, opts) {
  const idxSurface = [], idxCap = [];
  for (let t = 0; t < mesh.idx.length; t += 3) {
    const dst = mesh.tri[t / 3] ? idxCap : idxSurface;
    dst.push(mesh.idx[t], mesh.idx[t + 1], mesh.idx[t + 2]);
  }
  const piece = {
    pos: mesh.pos,
    nor: mesh.nor,
    uv: mesh.uv,
    idx: idxSurface,
    idxCap,
    idxAll: mesh.idx,
    material,
    volume: meshVolume(mesh.pos, mesh.idx),
    centroid: meshCentroid(mesh.pos, mesh.idx),
    bounds: bbox(mesh.pos),
  };
  piece.mass = Math.max(1e-3, piece.volume * (opts.density ?? 2400));
  return piece;
}

/**
 * Split a mesh into Voronoi cells.
 * @param mesh {pos, nor, uv, idx, material}
 * @param seeds [[x,y,z], ...] in the same space as mesh
 */
export function fractureVoronoi(mesh, seeds, opts = {}) {
  const neighbors = Math.min(opts.neighbors ?? 12, Math.max(0, seeds.length - 1));
  const pieces = [];
  for (let i = 0; i < seeds.length; i++) {
    const si = seeds[i];
    const order = seeds
      .map((s, j) => [j, dot(sub(s, si), sub(s, si))])
      .filter(([j]) => j !== i)
      .sort((a, b) => a[1] - b[1]);
    let cur = {
      pos: mesh.pos.slice(),
      nor: mesh.nor ? mesh.nor.slice() : null,
      uv: mesh.uv ? mesh.uv.slice() : null,
      idx: mesh.idx.slice(),
      tri: new Array(mesh.idx.length / 3).fill(0),
    };
    for (let k = 0; k < neighbors; k++) {
      const sj = seeds[order[k][0]];
      const nrm = normalize(sub(sj, si));
      const c = dot(nrm, mid(si, sj));
      // closer to si  <=>  nrm·p - c <= 0  <=>  (-nrm)·p - (-c) >= 0
      cur = clipMesh(cur, [-nrm[0], -nrm[1], -nrm[2]], -c, opts);
      if (cur.idx.length < 12) break;
    }
    if (cur.idx.length >= 12) {
      const p = finalize(cur, mesh.material, opts);
      if (p.volume > (opts.minVolume ?? 1e-5)) pieces.push(p);
    }
  }
  return pieces;
}

/**
 * Interior seed sampling.
 *
 * Seeds are picked on the surface (area weighted) and then pushed to the middle
 * of the material thickness by casting a ray inward.  That puts the Voronoi
 * sites inside slabs, beams and walls, so the cells look like chunks of the
 * object instead of shards of its skin.  Open meshes (a single plane) fall back
 * to the surface point.
 */
export function sampleSeeds(mesh, count, opts = {}) {
  const rng = mulberry32(opts.seed ?? 1234);
  const { pos, idx } = mesh;
  const tris = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = [pos[idx[t] * 3], pos[idx[t] * 3 + 1], pos[idx[t] * 3 + 2]];
    const b = [pos[idx[t + 1] * 3], pos[idx[t + 1] * 3 + 1], pos[idx[t + 1] * 3 + 2]];
    const c = [pos[idx[t + 2] * 3], pos[idx[t + 2] * 3 + 1], pos[idx[t + 2] * 3 + 2]];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (!(area > 1e-12)) continue;
    tris.push({ a, b, c, area, centroid: mid(mid(a, b), c) });
  }
  if (!tris.length) return [];

  const pick = (weightFn) => {
    let total = 0;
    const w = tris.map((tr) => {
      const v = tr.area * (weightFn ? weightFn(tr) : 1);
      total += v;
      return v;
    });
    let r = rng() * total;
    for (let i = 0; i < w.length; i++) {
      r -= w[i];
      if (r <= 0) return tris[i];
    }
    return tris[w.length - 1];
  };

  const sites = opts.sites ?? [];
  const siteShare = sites.length ? (opts.siteShare ?? 0.5) : 0;
  const sigma = opts.siteSigma ?? 0.35;
  const siteWeight = (tr) => {
    let best = Infinity;
    for (const s of sites) {
      const d = Math.hypot(tr.centroid[0] - s[0], tr.centroid[1] - s[1], tr.centroid[2] - s[2]);
      if (d < best) best = d;
    }
    return Math.exp(-(best * best) / (2 * sigma * sigma));
  };

  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (pos[i + k] < lo[k]) lo[k] = pos[i + k];
      if (pos[i + k] > hi[k]) hi[k] = pos[i + k];
    }
  }
  const bboxVolume = Math.max(1e-6, (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]));
  const minSpacing = opts.minSpacing ?? Math.cbrt(bboxVolume / Math.max(1, count)) * 0.4;

  const out = [];
  const farEnough = (p) =>
    out.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) >= minSpacing);

  for (let i = 0; i < count; i++) {
    let candidate = null;
    for (let attempt = 0; attempt < 16; attempt++) {
      const tr = pick(i < count * siteShare ? siteWeight : null);
      let u = rng(), v = rng();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const p = [
        tr.a[0] + (tr.b[0] - tr.a[0]) * u + (tr.c[0] - tr.a[0]) * v,
        tr.a[1] + (tr.b[1] - tr.a[1]) * u + (tr.c[1] - tr.a[1]) * v,
        tr.a[2] + (tr.b[2] - tr.a[2]) * u + (tr.c[2] - tr.a[2]) * v,
      ];
      const n = normalize([
        (tr.b[1] - tr.a[1]) * (tr.c[2] - tr.a[2]) - (tr.b[2] - tr.a[2]) * (tr.c[1] - tr.a[1]),
        (tr.b[2] - tr.a[2]) * (tr.c[0] - tr.a[0]) - (tr.b[0] - tr.a[0]) * (tr.c[2] - tr.a[2]),
        (tr.b[0] - tr.a[0]) * (tr.c[1] - tr.a[1]) - (tr.b[1] - tr.a[1]) * (tr.c[0] - tr.a[0]),
      ]);

      const origin = [p[0] - n[0] * 1e-4, p[1] - n[1] * 1e-4, p[2] - n[2] * 1e-4];
      let best = Infinity;
      for (const other of tris) {
        const t = rayTriangle(origin, [-n[0], -n[1], -n[2]], other.a, other.b, other.c);
        if (t !== null && t > 1e-4 && t < best) best = t;
      }
      const depth = Number.isFinite(best) ? best * (0.3 + 0.4 * rng()) : 0.01;
      candidate = [p[0] - n[0] * depth, p[1] - n[1] * depth, p[2] - n[2] * depth];
      if (farEnough(candidate)) break;
    }
    out.push(candidate);
  }
  return out;
}

function rayTriangle(origin, dir, a, b, c) {
  const e1 = sub(b, a), e2 = sub(c, a);
  const h = [
    dir[1] * e2[2] - dir[2] * e2[1],
    dir[2] * e2[0] - dir[0] * e2[2],
    dir[0] * e2[1] - dir[1] * e2[0],
  ];
  const det = dot(e1, h);
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const s = sub(origin, a);
  const u = dot(s, h) * inv;
  if (u < -1e-6 || u > 1 + 1e-6) return null;
  const q = [
    s[1] * e1[2] - s[2] * e1[1],
    s[2] * e1[0] - s[0] * e1[2],
    s[0] * e1[1] - s[1] * e1[0],
  ];
  const v = dot(dir, q) * inv;
  if (v < -1e-6 || u + v > 1 + 1e-6) return null;
  return dot(e2, q) * inv;
}

/** Deterministic seed cloud: concentrated at the charges, filling the bounds. */
export function makeSeeds(bounds, count, sites = [], opts = {}) {
  const rng = mulberry32(opts.seed ?? 1234);
  const size = [bounds.hi[0] - bounds.lo[0], bounds.hi[1] - bounds.lo[1], bounds.hi[2] - bounds.lo[2]];
  const seeds = [];
  const siteShare = sites.length ? Math.round(count * (opts.siteShare ?? 0.55)) : 0;
  const sigma = opts.siteSigma ?? 0.28;

  for (const s of sites) {
    const n = Math.max(1, Math.round(siteShare / sites.length));
    for (let i = 0; i < n; i++) {
      seeds.push([
        s[0] + (rng() - 0.5) * 2 * sigma * size[0],
        s[1] + (rng() - 0.5) * 2 * sigma * size[1],
        s[2] + (rng() - 0.5) * 2 * sigma * size[2],
      ]);
    }
  }
  let guard = 0;
  while (seeds.length < count && guard++ < count * 40) {
    const p = [
      bounds.lo[0] + rng() * size[0],
      bounds.lo[1] + rng() * size[1],
      bounds.lo[2] + rng() * size[2],
    ];
    const minD = opts.minSpacing ?? Math.min(size[0], size[2]) * 0.05;
    if (seeds.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) >= minD)) seeds.push(p);
  }
  return seeds.slice(0, count);
}

/** Piece pairs that touch, used to weld the intact structure with breakable joints. */
export function adjacency(pieces, maxGap = 0.06) {
  const pairs = [];
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i].bounds, b = pieces[j].bounds;
      let gap = 0;
      for (let k = 0; k < 3; k++) gap = Math.max(gap, a.lo[k] - b.hi[k], b.lo[k] - a.hi[k]);
      if (gap <= maxGap) pairs.push([i, j]);
    }
  }
  return pairs;
}
