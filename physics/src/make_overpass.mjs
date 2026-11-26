#!/usr/bin/env node
// Build the high-poly overpass shot asset from CC0 pieces.
//
//   node src/make_overpass.mjs --inspect      # download props, print their stats
//   node src/make_overpass.mjs                # write examples/overpass/overpass.glb
//   node src/bake.mjs --shot examples/overpass/shot.json --out out/overpass
//
// The deck, girders and piers are modelled here; the road is a painted 12 m x
// 16 m tile (see roadtile.mjs) and the barriers and lamps are Poly Haven CC0
// models, decimated to a fracture-friendly budget.  Downloads are cached under
// --cache (default a temp dir), so re-runs are offline.
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptSimplifier } from 'meshoptimizer';
import { readGLB, writeGLB } from './glb.mjs';
import { bbox } from './geom.mjs';
import { decode, encodeJPEG, resize } from './texture.mjs';
import { buildRoadTile } from './roadtile.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 || process.argv[i + 1]?.startsWith('--') ? fallback : process.argv[i + 1];
};
const flag = (name) => process.argv.includes(`--${name}`);

const CACHE = path.resolve(String(arg('cache', path.join(os.tmpdir(), 'overpass-cache'))));
const OUT = path.resolve(String(arg('out', path.join(root, 'examples', 'overpass'))));
const INSPECT = flag('inspect');

// ---- deck dimensions -------------------------------------------------------
const L = 72;              // span length (x)
const HALF = L / 2;
const WID = 16;            // deck width (z)
const ROAD_W = 15.4;       // paved width
const ROAD_T = 0.12;       // wearing course
const DECK_T = 0.7;        // slab
const DECK_Y = -0.12;      // slab top (road underside)
const GIRDER_TOP = DECK_Y - DECK_T; // -0.82
const PIERS = [-24, 0, 24];
const EDGE_Z = 7.95;

const PRECAST = {
  barrier: { id: 'concrete_road_barrier', tris: 700, height: 0.86, maxSeg: 6, maxStretch: 3.0, maxN: 14 },
  edge: { id: 'concrete_road_barrier_02', tris: 600, height: 1.11, maxSeg: 8, maxStretch: 4.0, maxN: 14 },
  lamp: { id: 'street_lamp_01', tris: 900, height: 9.0 },
};

// ---- http + cache ----------------------------------------------------------
const exists = (p) => access(p).then(() => true, () => false);

async function download(url, dest) {
  if (await exists(dest)) return dest;
  await mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

async function api(p) {
  const res = await fetch(`https://api.polyhaven.com${p}`);
  if (!res.ok) throw new Error(`api ${p} -> ${res.status}`);
  return res.json();
}

/** Download a model's .gltf plus every file it includes; return the .gltf path. */
async function fetchModel(id, size = '1k') {
  const files = await api(`/files/${id}`);
  const g = files?.gltf?.[size]?.gltf;
  if (!g?.url) throw new Error(`no gltf for ${id}@${size}`);
  const dir = path.join(CACHE, id);
  const gltf = await download(g.url, path.join(dir, `${id}_${size}.gltf`));
  for (const [name, info] of Object.entries(g.include ?? {})) {
    await download(info.url, path.join(dir, name));
  }
  return gltf;
}

const MAPS = { albedo: 'Diffuse', normal: 'nor_gl', rough: 'Rough', arm: 'arm' };

/** Download one texture map (1k jpg) and return its path. */
async function fetchMap(id, key, size = '1k') {
  const files = await api(`/files/${id}`);
  const v = files?.[MAPS[key]]?.[size];
  const url = v?.jpg?.url ?? v?.png?.url ?? v?.url;
  if (!url) throw new Error(`no ${MAPS[key]} ${size} for ${id}`);
  const ext = url.split('.').pop();
  return download(url, path.join(CACHE, id, `${MAPS[key]}_${size}.${ext}`));
}

// ---- geometry --------------------------------------------------------------
/** Axis aligned box with per-face normals and metre UVs (openTop drops +Y). */
function box(cx, cy, cz, sx, sy, sz, uvScale = 0.3, openTop = false) {
  const h = [sx / 2, sy / 2, sz / 2];
  const axes = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  const pos = [], nor = [], uv = [], idx = [];
  for (const [n, u, v] of axes) {
    if (openTop && n[1] > 0) continue;
    const hn = Math.abs(n[0] * h[0] + n[1] * h[1] + n[2] * h[2]);
    const hu = Math.abs(u[0] * h[0] + u[1] * h[1] + u[2] * h[2]);
    const hv = Math.abs(v[0] * h[0] + v[1] * h[1] + v[2] * h[2]);
    const base = pos.length / 3;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(
        cx + n[0] * hn + u[0] * hu * su + v[0] * hv * sv,
        cy + n[1] * hn + u[1] * hu * su + v[1] * hv * sv,
        cz + n[2] * hn + u[2] * hu * su + v[2] * hv * sv,
      );
      nor.push(...n);
      uv.push((su + 1) * hu * uvScale, (sv + 1) * hv * uvScale);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { pos, nor, uv, idx };
}

function cylinderY(cx, cy, cz, r, h, seg = 20) {
  const pos = [], nor = [], uv = [], idx = [];
  const y0 = cy - h / 2, y1 = cy + h / 2;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2, b = ((i + 1) / seg) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    const base = pos.length / 3;
    pos.push(cx + ca * r, y0, cz + sa * r, cx + cb * r, y0, cz + sb * r, cx + cb * r, y1, cz + sb * r, cx + ca * r, y1, cz + sa * r);
    nor.push(ca, 0, sa, cb, 0, sb, cb, 0, sb, ca, 0, sa);
    uv.push(i / seg, 0, (i + 1) / seg, 0, (i + 1) / seg, 1, i / seg, 1);
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  for (const [y, ny] of [[y0, -1], [y1, 1]]) {
    const base = pos.length / 3;
    pos.push(cx, y, cz);
    nor.push(0, ny, 0);
    uv.push(0.5, 0.5);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pos.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
      nor.push(0, ny, 0);
      uv.push(0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
    }
    for (let i = 0; i < seg; i++) {
      if (ny > 0) idx.push(base, base + 2 + i, base + 1 + i);
      else idx.push(base, base + 1 + i, base + 2 + i);
    }
  }
  return { pos, nor, uv, idx };
}

/** The painted road top: UVs are metres/12 (u) and (z + 8)/16 (v). */
function roadQuad(x0, x1, z0, z1, y, worldU = 12, worldV = 16) {
  const corners = [[x0, z0], [x0, z1], [x1, z1], [x1, z0]];
  const pos = [], nor = [], uv = [];
  for (const [x, z] of corners) {
    pos.push(x, y, z);
    nor.push(0, 1, 0);
    uv.push(x / worldU, (z + worldV / 2) / worldV);
  }
  return { pos, nor, uv, idx: [0, 1, 2, 0, 2, 3] };
}

function merge(...parts) {
  const out = { pos: [], nor: [], uv: [], idx: [] };
  for (const p of parts) {
    const base = out.pos.length / 3;
    out.pos.push(...p.pos);
    out.nor.push(...p.nor);
    out.uv.push(...p.uv);
    for (const i of p.idx) out.idx.push(base + i);
  }
  return out;
}

// ---- prop placement --------------------------------------------------------
/** Decimate to ~targetTris with meshoptimizer, then compact away dead vertices. */
async function decimateTo(mesh, targetTris, error = 0.015) {
  const tris = mesh.idx.length / 3;
  if (!MeshoptSimplifier.supported || tris <= targetTris) return mesh;
  await MeshoptSimplifier.ready;
  const src = mesh.idx instanceof Uint32Array ? mesh.idx : new Uint32Array(mesh.idx);
  const pos = mesh.pos instanceof Float32Array ? mesh.pos : new Float32Array(mesh.pos);
  const [idx] = MeshoptSimplifier.simplify(src, pos, 3, targetTris * 3, error, []);
  const remap = new Int32Array(pos.length / 3).fill(-1);
  const out = new Uint32Array(idx.length);
  const np = [], nn = mesh.nor ? [] : null, nu = mesh.uv ? [] : null;
  let n = 0;
  for (let i = 0; i < idx.length; i++) {
    const v = idx[i];
    if (remap[v] < 0) {
      remap[v] = n++;
      np.push(mesh.pos[v * 3], mesh.pos[v * 3 + 1], mesh.pos[v * 3 + 2]);
      if (mesh.nor) nn.push(mesh.nor[v * 3], mesh.nor[v * 3 + 1], mesh.nor[v * 3 + 2]);
      if (mesh.uv) nu.push(mesh.uv[v * 2], mesh.uv[v * 2 + 1]);
    }
    out[i] = remap[v];
  }
  return {
    ...mesh,
    pos: new Float32Array(np),
    nor: mesh.nor ? new Float32Array(nn) : null,
    uv: nu ? new Float32Array(nu) : null,
    idx: out,
  };
}

/**
 * Rotate about Y, scale to a target height, optionally stretch along X.
 * `bounds` is the *group* bounds so multi-mesh props stay aligned.
 */
function instantiate(mesh, { at = [0, 0, 0], height = null, lenX = null, rotY = 0, alignX = false, scaleUv = true }, bounds) {
  const b = bounds ?? bbox(mesh.pos);
  let rot = rotY;
  let long = b.size[0];
  if (alignX && b.size[2] > b.size[0]) {
    rot += Math.PI / 2;
    long = b.size[2];
  }
  const s = height ? height / b.size[1] : 1;
  const stretch = lenX ? lenX / (long * s) : 1;
  const ox = (b.lo[0] + b.hi[0]) / 2, oy = b.lo[1], oz = (b.lo[2] + b.hi[2]) / 2;
  const c = Math.cos(rot), sn = Math.sin(rot);
  const pos = new Float32Array(mesh.pos.length);
  for (let i = 0; i < mesh.pos.length; i += 3) {
    const x = mesh.pos[i] - ox, y = mesh.pos[i + 1] - oy, z = mesh.pos[i + 2] - oz;
    const rx = x * c + z * sn, rz = -x * sn + z * c;
    pos[i] = rx * s * stretch + at[0];
    pos[i + 1] = y * s + at[1];
    pos[i + 2] = rz * s + at[2];
  }
  let nor = null;
  if (mesh.nor) {
    nor = new Float32Array(mesh.nor.length);
    for (let i = 0; i < mesh.nor.length; i += 3) {
      const x = mesh.nor[i], y = mesh.nor[i + 1], z = mesh.nor[i + 2];
      // inverse-transpose of (stretch on the rotated X axis) keeps normals sane
      const rx = (x * c + z * sn) / stretch, ry = y, rz = -x * sn + z * c;
      const l = Math.hypot(rx, ry, rz) || 1;
      nor[i] = rx / l; nor[i + 1] = ry / l; nor[i + 2] = rz / l;
    }
  }
  let uv = mesh.uv;
  if (uv && scaleUv && Math.abs(stretch - 1) > 1e-6) {
    uv = new Float32Array(uv.length);
    for (let i = 0; i < uv.length; i += 2) { uv[i] = uv[i] * stretch; uv[i + 1] = uv[i + 1]; }
  }
  return { ...mesh, pos, nor, uv };
}

/**
 * Re-encode every material's maps at a bounded resolution so the web payload
 * stays small.  Images are cached by source buffer, so maps that share a file
 * (e.g. an ORM arm map used for both MR and occlusion) are encoded once.
 * A material with `textureMax === false` is left alone (already sized).
 */
async function shrinkMaterials(materials, maxPx, quality = 84) {
  const cache = new Map();
  const conv = async (t, q) => {
    if (!t?.bytes?.length) return null;
    if (cache.has(t.bytes)) return cache.get(t.bytes);
    let img = decode(t.bytes, t.mime);
    if (Math.max(img.w, img.h) > maxPx) {
      const s = maxPx / Math.max(img.w, img.h);
      img = resize(img, Math.max(1, Math.round(img.w * s)), Math.max(1, Math.round(img.h * s)));
    }
    const out = { bytes: encodeJPEG(img, q), mime: 'image/jpeg' };
    cache.set(t.bytes, out);
    return out;
  };
  const out = [];
  for (const m of materials) {
    if (m.textureMax === false) { out.push(m); continue; }
    out.push({
      ...m,
      texture: await conv(m.texture, quality),
      normalTexture: await conv(m.normalTexture, quality + 4),
      metallicRoughnessTexture: await conv(m.metallicRoughnessTexture, quality),
      occlusionTexture: await conv(m.occlusionTexture, quality),
    });
  }
  return out;
}

/** Length of the group's long horizontal axis once scaled to `height`. */
function scaledLength(bounds, height) {
  return Math.max(bounds.size[0], bounds.size[2]) * (height / bounds.size[1]);
}

/**
 * Split a run of `L` metres into `n` props close to their natural length,
 * bounding both the stretch and the instance count.
 */
function segmentPlan(L, natural, cfg) {
  const n = Math.max(
    1,
    Math.min(cfg.maxN, Math.ceil(L / Math.min(natural * cfg.maxStretch, cfg.maxSeg))),
  );
  return { n, seg: L / n, stretch: L / n / natural };
}

const uvRange = (mesh) => {
  if (!mesh.uv) return null;
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (let i = 0; i < mesh.uv.length; i += 2) {
    for (let k = 0; k < 2; k++) {
      if (mesh.uv[i + k] < lo[k]) lo[k] = mesh.uv[i + k];
      if (mesh.uv[i + k] > hi[k]) hi[k] = mesh.uv[i + k];
    }
  }
  return [lo, hi];
};

// ---- main ------------------------------------------------------------------
async function main() {
  console.log(`cache   ${CACHE}`);
  const parts = [];
  let materials = [];
  const register = (m) => { materials.push(m); return materials.length - 1; };

  // ---- CC0 props ----------------------------------------------------------
  const props = {};
  for (const [key, cfg] of Object.entries(PRECAST)) {
    const gltf = await fetchModel(cfg.id);
    const read = await readGLB(gltf, { up: 'y' });
    const before = read.meshes.reduce((s, m) => s + m.idx.length / 3, 0);
    const meshes = [];
    for (const m of read.meshes) {
      // split the tri budget across the prop's primitives by size
      const share = (cfg.tris * (m.idx.length / 3)) / Math.max(1, before);
      meshes.push(await decimateTo(m, Math.max(64, Math.round(share))));
    }
    const after = meshes.reduce((s, m) => s + m.idx.length / 3, 0);
    const b = meshGroupBounds(meshes);
    props[key] = {
      meshes,
      mats: read.materials.map((m) => register(m)),
      size: b.size,
      bounds: b,
      uv: uvRange(meshes[0]),
    };
    console.log(
      `prop    ${cfg.id.padEnd(26)} ${String(before).padStart(7)} -> ${String(after).padStart(6)} tris  ` +
      `size ${b.size.map((v) => v.toFixed(2)).join(' x ')} m  meshes ${meshes.length}`,
    );
    if (props[key].uv) {
      console.log(`        uv ${props[key].uv[0].map((v) => v.toFixed(2))} .. ${props[key].uv[1].map((v) => v.toFixed(2))}`);
    }
  }

  // ---- placement plan -----------------------------------------------------
  const plan = {};
  for (const key of ['barrier', 'edge']) {
    const cfg = PRECAST[key];
    const natural = scaledLength(props[key].bounds, cfg.height);
    plan[key] = { ...segmentPlan(L, natural, cfg), natural };
    const p = plan[key];
    const runs = key === 'edge' ? p.n * 2 : p.n;
    const tris = props[key].meshes.reduce((s, m) => s + m.idx.length / 3, 0);
    console.log(
      `plan    ${key.padEnd(8)} natural ${natural.toFixed(2)} m -> ${p.n} x ${p.seg.toFixed(2)} m ` +
      `(stretch ${p.stretch.toFixed(2)}x, ${runs} runs, ~${Math.round(runs * tris)} tris)`,
    );
  }
  if (INSPECT) return;

  // ---- materials ----------------------------------------------------------
  const ROAD_SRC = 'asphalt_pit_lane';
  const tile = buildRoadTile(
    {
      albedo: decode(await readFile(await fetchMap(ROAD_SRC, 'albedo')), 'image/jpeg'),
      normal: decode(await readFile(await fetchMap(ROAD_SRC, 'normal')), 'image/jpeg'),
      rough: decode(await readFile(await fetchMap(ROAD_SRC, 'rough')), 'image/jpeg'),
    },
    { width: 1536, height: 2048, mean: 64 },
  );
  const MAT = {};
  // The road keeps its full 1536 x 2048 albedo but half-res, high-quality
  // normal and MR maps: normal maps compress badly and the grain reads at
  // half resolution.
  const halfTile = (img) => resize(img, Math.round(img.w / 2), Math.round(img.h / 2));
  MAT.road = register({
    name: 'asphalt',
    color: [1, 1, 1, 1],
    metallic: 1,
    roughness: 1,
    avg: [0.17, 0.17, 0.18],
    textureMax: false,
    texture: { bytes: encodeJPEG(resize(tile.albedo, 1152, 1536), 82), mime: 'image/jpeg' },
    normalTexture: { bytes: encodeJPEG(halfTile(tile.normal), 90), mime: 'image/jpeg' },
    normalScale: 1,
    metallicRoughnessTexture: { bytes: encodeJPEG(halfTile(tile.mr), 80), mime: 'image/jpeg' },
  });
  const conArm = await readFile(await fetchMap('concrete_wall_008', 'arm'));
  MAT.concrete = register({
    name: 'concrete',
    color: [1, 1, 1, 1],
    metallic: 1,
    roughness: 1,
    avg: [0.6, 0.6, 0.57],
    texture: { bytes: await readFile(await fetchMap('concrete_wall_008', 'albedo')), mime: 'image/jpeg' },
    normalTexture: { bytes: await readFile(await fetchMap('concrete_wall_008', 'normal')), mime: 'image/jpeg' },
    normalScale: 1,
    metallicRoughnessTexture: { bytes: conArm, mime: 'image/jpeg' },
    occlusionTexture: { bytes: conArm, mime: 'image/jpeg' },
    occlusionStrength: 1,
  });
  MAT.steel = register({
    name: 'steel',
    color: [0.33, 0.35, 0.39, 1],
    metallic: 0.9,
    roughness: 0.45,
    avg: [0.33, 0.35, 0.39],
  });

  const add = (name, material, geo) => parts.push({
    name, material, pos: geo.pos, nor: geo.nor, uv: geo.uv, idx: geo.idx,
  });

  // ---- deck ---------------------------------------------------------------
  add('road', MAT.road, merge(
    box(0, ROAD_T / -2, 0, L, ROAD_T, ROAD_W, 0.35, true),
    roadQuad(-HALF, HALF, -ROAD_W / 2, ROAD_W / 2, 0.001),
  ));
  add('deck', MAT.concrete, box(0, DECK_Y - DECK_T / 2, 0, L, DECK_T, WID + 0.4, 0.3));
  for (const z of [-7.85, 7.85]) add('curb', MAT.concrete, box(0, 0.09, z, L, 0.42, 0.3, 0.4));

  // ---- steel frame --------------------------------------------------------
  for (const z of [-5.6, -2.6, 2.6, 5.6]) {
    add('girder', MAT.steel, box(0, GIRDER_TOP - 0.05, z, L, 0.1, 0.7, 1));
    add('girder', MAT.steel, box(0, GIRDER_TOP - 0.66, z, L, 0.1, 0.7, 1));
    add('girder', MAT.steel, box(0, GIRDER_TOP - 0.33, z, L, 0.5, 0.12, 1));
  }
  for (let x = -32; x <= 32; x += 8) add('brace', MAT.steel, box(x, GIRDER_TOP - 0.7, 0, 0.2, 0.28, 11.4, 1));

  // ---- piers + abutments --------------------------------------------------
  const CAP_TOP = GIRDER_TOP - 0.88; // top well below the released steel
  for (const x of PIERS) {
    add('pier', MAT.concrete, box(x, CAP_TOP - 0.4, 0, 1.6, 0.8, 12.6, 0.25));
    for (const z of [-4.2, 4.2]) add('pier', MAT.concrete, cylinderY(x, -8.4, z, 1.1, 11.4));
  }
  for (const x of [-HALF, HALF]) add('abutment', MAT.concrete, box(x, GIRDER_TOP - 3.0, 0, 6, 6, 17, 0.22));

  // ---- CC0 median barrier (the showcase asset) ----------------------------
  const med = plan.barrier;
  for (let i = 0; i < med.n; i++) {
    const x = -HALF + (i + 0.5) * med.seg;
    for (const m of props.barrier.meshes) {
      add('barrier', props.barrier.mats[m.material], instantiate(m, {
        at: [x, 0, 0],
        height: PRECAST.barrier.height,
        lenX: med.seg,
        alignX: true,
      }, props.barrier.bounds));
    }
  }
  // ---- CC0 edge barriers --------------------------------------------------
  const edge = plan.edge;
  for (let i = 0; i < edge.n; i++) {
    const x = -HALF + (i + 0.5) * edge.seg;
    for (const z of [-EDGE_Z, EDGE_Z]) {
      for (const m of props.edge.meshes) {
        add('barrier', props.edge.mats[m.material], instantiate(m, {
          at: [x, 0.30, z],
          height: PRECAST.edge.height,
          lenX: edge.seg,
          alignX: true,
        }, props.edge.bounds));
      }
    }
  }
  // ---- CC0 street lamps ---------------------------------------------------
  for (const x of [-28, -10, 10, 28]) {
    for (const z of [-7.6, 7.6]) {
      for (const m of props.lamp.meshes) {
        add('lamp', props.lamp.mats[m.material], instantiate(m, {
          at: [x, 0, z],
          height: PRECAST.lamp.height,
        }, props.lamp.bounds));
      }
    }
  }

  // ---- write --------------------------------------------------------------
  await mkdir(OUT, { recursive: true });
  materials = await shrinkMaterials(materials, 512, 82);
  const glbPath = path.join(OUT, 'overpass.glb');
  const bytes = await writeGLB(glbPath, parts, materials);
  const tris = parts.reduce((s, m) => s + m.idx.length / 3, 0);

  const shot = buildShot();
  await writeFile(path.join(OUT, 'shot.json'), JSON.stringify(shot, null, 2));

  const sizes = {};
  for (const m of parts) sizes[m.name] = (sizes[m.name] ?? 0) + m.idx.length / 3;
  console.log(`\noverpass ${parts.length} meshes, ${tris} triangles, ${(bytes / 1e6).toFixed(2)} MB`);
  console.log(`         materials ${materials.length}: ${materials.map((m) => m.name).join(', ')}`);
  console.log(`         meshes by name: ${Object.entries(sizes).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`         -> ${path.relative(process.cwd(), glbPath)}`);
  console.log(`         -> ${path.relative(process.cwd(), path.join(OUT, 'shot.json'))}`);
}

function meshGroupBounds(meshes) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) {
    const b = bbox(m.pos);
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], b.lo[k]); hi[k] = Math.max(hi[k], b.hi[k]); }
  }
  return { lo, hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
}

// ---- shot ------------------------------------------------------------------
function buildShot() {
  // the whole superstructure, but neither the pier caps below it nor the
  // abutments: girders end at -0.82-0.71 ~ -1.53, caps start at -1.70
  const DECK_RELEASE = { lo: [-HALF - 1, -1.62, -9.5], hi: [HALF + 1, 12, 9.5] };
  return {
    asset: 'overpass.glb',
    up: 'y',
    fps: 30,
    duration: 8,
    seed: 20261126,
    fracture: { pieces: 340, density: 2400, siteShare: 0.6, minVolume: 0.0004, neighbors: 12 },
    joints: { gap: 0.06, breakDistance: 0.2, breakSpeed: 6, anchor: true },
    targets: [
      { name: 'deck', match: 'road|deck|curb', pieces: 190 },
      { name: 'frame', match: 'girder|brace', pieces: 60 },
      { name: 'piers', match: 'pier|abutment', pieces: 40 },
      { name: 'props', match: 'barrier|lamp', pieces: 64 },
    ],
    charges: [
      { name: 'cut-pier-west', time: 0.6, position: [-24, -1.9, 0], radius: 10, power: 2.4, upBias: 0.06, visible: true, release: DECK_RELEASE, dust: 32 },
      { name: 'cut-pier-east', time: 0.6, position: [24, -1.9, 0], radius: 10, power: 2.4, upBias: 0.06, visible: true, release: DECK_RELEASE, dust: 32 },
      { name: 'mid-span', time: 2.4, position: [0, 0.1, 0], radius: 7, power: 3.2, upBias: 0.1, visible: true, dust: 24 },
    ],
    shots: [
      { time: 0.14, from: [-22, 3.4, 11], to: [-12, 0.02, 4.2], kind: 'bullet', size: 0.1, chips: 5, spread: 0.7 },
      { time: 0.28, from: [-22, 3.0, 11], to: [-12, 0.02, 1.4], kind: 'bullet', size: 0.09, chips: 4, spread: 0.6 },
      { time: 0.42, from: [-8, 5.0, 13], to: [-2, 0.02, -1.2], kind: 'bullet', size: 0.22, chips: 7, spread: 1.0 },
    ],
    water: { level: -11, extent: [240, 240], buoyancy: 1.5, drag: 2.2, splashSpeed: 2.0 },
    ground: { level: -16, extent: 260 },
    killY: -40,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
