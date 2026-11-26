#!/usr/bin/env node
// Builds the demo asset: a three-span concrete bridge over water, plus the two
// shots that exercise the simulator (controlled demolition + implosion).
//
//   node src/make_demo_bridge.mjs
//   node src/bake.mjs --shot examples/bridge/shot.json --out out/bridge
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeGLB } from './glb.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const MATERIALS = [
  { name: 'concrete', color: [0.66, 0.65, 0.62, 1], avg: [0.66, 0.65, 0.62], metallic: 0, roughness: 0.92 },
  { name: 'asphalt', color: [0.14, 0.145, 0.15, 1], avg: [0.14, 0.145, 0.15], metallic: 0, roughness: 0.96 },
  { name: 'steel', color: [0.36, 0.39, 0.43, 1], avg: [0.36, 0.39, 0.43], metallic: 0.85, roughness: 0.42 },
  { name: 'rust', color: [0.42, 0.22, 0.13, 1], avg: [0.42, 0.22, 0.13], metallic: 0.15, roughness: 0.82 },
];
const MAT = Object.fromEntries(MATERIALS.map((m, i) => [m.name, i]));

/** Axis aligned box with per-face normals and metre UVs. */
function box(cx, cy, cz, sx, sy, sz, uvScale = 1) {
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
      uv.push(((su + 1) * hu * uvScale), ((sv + 1) * hv * uvScale));
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { pos, nor, uv, idx };
}

function cylinderY(cx, cy, cz, r, h, seg = 24) {
  const pos = [], nor = [], uv = [], idx = [];
  const y0 = cy - h / 2, y1 = cy + h / 2;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const b = ((i + 1) / seg) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const cb = Math.cos(b), sb = Math.sin(b);
    const base = pos.length / 3;
    pos.push(cx + ca * r, y0, cz + sa * r, cx + cb * r, y0, cz + sb * r, cx + cb * r, y1, cz + sb * r, cx + ca * r, y1, cz + sa * r);
    nor.push(ca, 0, sa, cb, 0, sb, cb, 0, sb, ca, 0, sa);
    uv.push(i / seg, 0, (i + 1) / seg, 0, (i + 1) / seg, 1, i / seg, 1);
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  // caps
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

function buildBridge() {
  const meshes = [];
  const add = (name, mat, geo) => meshes.push({ name, material: MAT[mat], ...geo });

  // deck + wearing course
  add('deck', 'concrete', box(0, -0.375, 0, 60, 0.75, 8));
  add('asphalt', 'asphalt', box(0, 0.04, 0, 59.6, 0.08, 7.4));
  // girders under the deck
  for (const z of [-3.2, 3.2]) add('girder', 'steel', box(0, -1.03, z, 60, 0.5, 0.6));
  // cross braces between girders
  for (let x = -27; x <= 27; x += 6) add('brace', 'steel', box(x, -1.0, 0, 0.25, 0.3, 5.8));

  // piers: cap sits below the girders so released steel never starts wedged
  // inside a fixed cap
  for (const x of [-18, 0, 18]) {
    add('pier_cap', 'concrete', box(x, -1.8, 0, 7, 0.9, 7));
    for (const z of [-2.4, 2.4]) add('pier_column', 'concrete', cylinderY(x, -7.0, z, 1.2, 9.5));
  }

  // abutments
  // abutment sits outside the deck span and just under its soffit
  for (const x of [-33, 33]) add('abutment', 'concrete', box(x, -5.75, 0, 6, 10, 9));

  // railings
  for (const z of [-3.85, 3.85]) {
    for (let x = -29; x <= 29.001; x += 3.5) {
      add('railing_post', x % 2 === 0 ? 'steel' : 'rust', box(x, 0.65, z, 0.1, 1.14, 0.1));
    }
    add('railing_rail', 'steel', box(0, 1.26, z, 59, 0.12, 0.14));
    add('railing_rail', 'rust', box(0, 0.72, z, 59, 0.08, 0.1));
  }

  // lamp posts
  for (const x of [-9, 9]) {
    for (const z of [-3.55, 3.55]) {
      add('lamp_pole', 'steel', box(x, 2.6, z, 0.16, 5.0, 0.16));
      add('lamp_head', 'steel', box(x, 5.05, z + (z > 0 ? -0.55 : 0.55), 0.42, 0.22, 1.2));
    }
  }
  return meshes;
}

const WATER = { level: -7.0, extent: [220, 220], buoyancy: 1.5, drag: 2.2, splashSpeed: 2.0 };
// whole superstructure (deck + girders + braces + railings) but neither the
// pier caps below it nor the abutments outside the span
const DECK_RELEASE = { lo: [-31, -1.45, -5.5], hi: [31, 6.0, 5.5] };

const base = {
  asset: 'bridge.glb',
  up: 'y',
  fps: 30,
  duration: 9,
  seed: 20261126,
  fracture: { pieces: 300, density: 2400, siteShare: 0.6, minVolume: 0.0004 },
  joints: { gap: 0.06, breakDistance: 0.2, breakSpeed: 6, anchor: true },
  targets: [
    { name: 'deck', match: 'deck|asphalt|girder|brace', pieces: 150 },
    { name: 'piers', match: 'pier|abutment', pieces: 60 },
    { name: 'railings', match: 'railing|lamp', pieces: 90 },
  ],
  charges: [
    {
      name: 'cut-pier-a',
      time: 0.5,
      position: [-18, -1.0, 0],
      radius: 9,
      power: 2.0,
      upBias: 0.06,
      visible: true,
      release: DECK_RELEASE,
      dust: 34,
    },
    {
      name: 'cut-pier-b',
      time: 0.5,
      position: [18, -1.0, 0],
      radius: 9,
      power: 2.0,
      upBias: 0.06,
      visible: true,
      release: DECK_RELEASE,
      dust: 34,
    },
    {
      name: 'mid-span',
      time: 2.6,
      position: [0, 0.2, 0],
      radius: 7,
      power: 3.6,
      upBias: 0.1,
      visible: true,
      dust: 24,
    },
  ],
  shots: [
    { time: 0.12, from: [-20, 3.2, 11], to: [-9, 3.4, 3.55], kind: 'bullet', size: 0.1, chips: 5, spread: 0.7 },
    { time: 0.24, from: [-20, 3.0, 11], to: [-9, 1.8, 3.55], kind: 'bullet', size: 0.09, chips: 4, spread: 0.6 },
    { time: 0.38, from: [-7, 4.5, 12], to: [-2, 0.08, -1.2], kind: 'bullet', size: 0.22, chips: 7, spread: 1.0 },
  ],
  water: WATER,
  ground: { level: -12.5, extent: 240 },
  killY: -40,
};

const implode = {
  ...base,
  duration: 7,
  fracture: { ...base.fracture, pieces: 260 },
  charges: [
    {
      name: 'implode-core',
      time: 1.0,
      position: [0, -0.6, 0],
      radius: 26,
      power: 1.15,
      upBias: 0.02,
      implode: true,
      implodeFrames: 9,
      visible: false,
      dust: 60,
      dustLife: 3.2,
    },
  ],
  releaseAll: true,
  shots: base.shots.slice(0, 2),
};

const outDir = path.join(root, 'examples', 'bridge');
await mkdir(outDir, { recursive: true });
const meshes = buildBridge();
const glbPath = path.join(outDir, 'bridge.glb');
const bytes = await writeGLB(glbPath, meshes, MATERIALS);
await writeFile(path.join(outDir, 'shot.json'), JSON.stringify(base, null, 2));
await writeFile(path.join(outDir, 'shot-implode.json'), JSON.stringify(implode, null, 2));

const tris = meshes.reduce((s, m) => s + m.idx.length / 3, 0);
console.log(`bridge  ${meshes.length} meshes, ${tris} triangles, ${(bytes / 1e6).toFixed(2)} MB -> ${path.relative(process.cwd(), glbPath)}`);
console.log('shots   examples/bridge/shot.json (controlled demolition)');
console.log('        examples/bridge/shot-implode.json (bomb implosion, invisible blast)');
