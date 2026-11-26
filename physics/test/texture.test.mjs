// GLB material round-trip: the baker must carry base colour, normal and
// metallic-roughness maps (plus normal scale) from the source asset through the
// fracture output, since the debris keeps the source material.
//
//   node test/texture.test.mjs
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import jpeg from 'jpeg-js';
import { readGLB, writeGLB } from '../src/glb.mjs';

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures++;
};

// A tiny solid-colour JPEG stands in for each map.
const swatch = (r, g, b) => {
  const w = 8;
  const h = 8;
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return Buffer.from(jpeg.encode({ data, width: w, height: h }, 90).data);
};

const dir = mkdtempSync(path.join(tmpdir(), 'tex-test-'));

// source asset: one triangle with every channel mapped
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene();
const mat = doc
  .createMaterial('road')
  .setBaseColorTexture(doc.createTexture('albedo').setImage(swatch(30, 32, 34)).setMimeType('image/jpeg'))
  .setNormalTexture(doc.createTexture('normal').setImage(swatch(128, 128, 255)).setMimeType('image/jpeg'))
  .setNormalScale(0.7)
  .setMetallicRoughnessTexture(doc.createTexture('mr').setImage(swatch(255, 20, 0)).setMimeType('image/jpeg'));
const acc = (name, type, arr) =>
  doc.createAccessor(name).setType(type).setArray(arr).setBuffer(buffer);
const prim = doc
  .createPrimitive()
  .setAttribute('POSITION', acc('pos', 'VEC3', new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])))
  .setAttribute('NORMAL', acc('nor', 'VEC3', new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])))
  .setAttribute('TEXCOORD_0', acc('uv', 'VEC2', new Float32Array([0, 0, 1, 0, 0, 1])))
  .setIndices(acc('idx', 'SCALAR', new Uint32Array([0, 1, 2])))
  .setMaterial(mat);
scene.addChild(doc.createNode('tri').setMesh(doc.createMesh('tri').addPrimitive(prim)));
doc.getRoot().setDefaultScene(scene);
const src = path.join(dir, 'src.glb');
await new NodeIO().write(src, doc);

const srcRead = await readGLB(src, { up: 'y' });
const m = srcRead.materials[0];
check(!!m.texture, 'source base-colour texture read');
check(!!m.normalTexture, 'source normal texture read');
check(!!m.metallicRoughnessTexture, 'source metallic-roughness texture read');
check(Math.abs(m.normalScale - 0.7) < 1e-6, `normal scale survives (${m.normalScale})`);

// bake output: same material table, one fractured-style piece
const out = path.join(dir, 'debris.glb');
await writeGLB(
  out,
  [{
    name: 'piece_000',
    material: 0,
    pos: srcRead.meshes[0].pos,
    nor: srcRead.meshes[0].nor,
    uv: srcRead.meshes[0].uv,
    idx: srcRead.meshes[0].idx,
    idxCap: new Uint32Array([0, 1, 2]),
  }],
  srcRead.materials,
);
const back = (await readGLB(out, { up: 'y' })).materials;
const bm = back[0];
check(!!bm.texture, 'debris base-colour texture written');
check(!!bm.normalTexture, 'debris normal texture written');
check(!!bm.metallicRoughnessTexture, 'debris metallic-roughness texture written');
check(Math.abs(bm.normalScale - 0.7) < 1e-6, `debris normal scale written (${bm.normalScale})`);
check(back.length >= 2 && back.some((x) => x.name.endsWith('__break')), 'break material still paired');
check(readFileSync(out).length > 600, 'debris GLB carries embedded map bytes');

console.log(failures ? `\n${failures} failure(s)` : '\nall texture tests passed');
process.exit(failures ? 1 : 0);
