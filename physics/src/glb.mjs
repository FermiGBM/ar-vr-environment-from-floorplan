// GLB in / GLB out.  The baker reads the user's asset exactly as authored and
// writes debris that keeps the source UVs, normals and materials.
import { readFile, writeFile } from 'node:fs/promises';
import { Document, NodeIO } from '@gltf-transform/core';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { applyMat4, mat4Mul } from './geom.mjs';

const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export const srgbToLinear = (c) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

function imageAverage(bytes, mime) {
  try {
    let w, h, data;
    if (/jpe?g/i.test(mime)) {
      const img = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 512 });
      w = img.width; h = img.height; data = img.data;
    } else if (/png/i.test(mime)) {
      const img = PNG.sync.read(Buffer.from(bytes));
      w = img.width; h = img.height; data = img.data;
    } else return null;
    let r = 0, g = 0, b = 0, n = 0;
    const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 4096)));
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        if (data[i + 3] < 16) continue;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
    }
    if (!n) return null;
    return [r / n / 255, g / n / 255, b / n / 255];
  } catch {
    return null;
  }
}

/**
 * Read a GLB into world-space triangle soups, one entry per primitive.
 * @param input path or Uint8Array
 * @param opts {up:'y'|'z', name?:string}
 */
export async function readGLB(input, opts = {}) {
  const io = new NodeIO();
  const bytes = typeof input === 'string' ? new Uint8Array(await readFile(input)) : input;
  const doc = await io.readBinary(bytes);
  const root = doc.getRoot();

  // material table (deduplicated by gltf-transform property)
  const materials = [];
  const matIndex = new Map();
  const materialInfo = (mat) => {
    if (!mat) {
      if (!matIndex.has(null)) {
        matIndex.set(null, materials.length);
        materials.push({ name: 'default', color: [0.72, 0.72, 0.7, 1], metallic: 0, roughness: 0.8, avg: [0.72, 0.72, 0.7] });
      }
      return matIndex.get(null);
    }
    if (matIndex.has(mat)) return matIndex.get(mat);
    const color = mat.getBaseColorFactor().slice();
    const tex = mat.getBaseColorTexture();
    let avg = null;
    let texData = null;
    if (tex) {
      const img = tex.getImage();
      const mime = tex.getMimeType() || 'image/png';
      if (img) {
        const a = imageAverage(img, mime);
        if (a) avg = a;
        texData = { bytes: img, mime };
      }
    }
    const s = avg ?? color;
    const info = {
      name: mat.getName() || `material_${materials.length}`,
      color,
      metallic: mat.getMetallicFactor(),
      roughness: mat.getRoughnessFactor(),
      emissive: mat.getEmissiveFactor().slice(),
      avg: [s[0], s[1], s[2]],
      texture: texData,
      doubleSided: mat.getDoubleSided(),
      alphaMode: mat.getAlphaMode(),
    };
    const i = materials.length;
    materials.push(info);
    matIndex.set(mat, i);
    return i;
  };

  const meshes = [];
  const up = opts.up ?? 'y';
  const convert = (p) => (up === 'z' ? [p[0], p[2], -p[1]] : [p[0], p[1], p[2]]);

  const visit = (node, parent) => {
    const local = node.getMatrix() ? Array.from(node.getMatrix()) : IDENT;
    const world = mat4Mul(parent, local);
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const posAttr = prim.getAttribute('POSITION');
        if (!posAttr) continue;
        const idxAttr = prim.getIndices();
        const norAttr = prim.getAttribute('NORMAL');
        const uvAttr = prim.getAttribute('TEXCOORD_0');
        const count = posAttr.getCount();
        const srcPos = posAttr.getArray();
        const pos = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          const p = convert(applyMat4(world, [srcPos[i * 3], srcPos[i * 3 + 1], srcPos[i * 3 + 2]]));
          pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2];
        }
        let nor = null;
        if (norAttr) {
          const srcNor = norAttr.getArray();
          nor = new Float32Array(count * 3);
          for (let i = 0; i < count; i++) {
            // uniform scale assumption: rotate then normalise
            const n = convert([
              world[0] * srcNor[i * 3] + world[4] * srcNor[i * 3 + 1] + world[8] * srcNor[i * 3 + 2],
              world[1] * srcNor[i * 3] + world[5] * srcNor[i * 3 + 1] + world[9] * srcNor[i * 3 + 2],
              world[2] * srcNor[i * 3] + world[6] * srcNor[i * 3 + 1] + world[10] * srcNor[i * 3 + 2],
            ]);
            const l = Math.hypot(n[0], n[1], n[2]) || 1;
            nor[i * 3] = n[0] / l; nor[i * 3 + 1] = n[1] / l; nor[i * 3 + 2] = n[2] / l;
          }
        }
        let uv = null;
        if (uvAttr) {
          const a = uvAttr.getArray();
          uv = new Float32Array(count * 2);
          uv.set(a.subarray ? a.subarray(0, count * 2) : a);
        }
        const idx = new Uint32Array(idxAttr ? idxAttr.getArray() : Array.from({ length: count }, (_, i) => i));
        meshes.push({
          name: node.getName() || mesh.getName() || `mesh_${meshes.length}`,
          meshName: mesh.getName() || '',
          material: materialInfo(prim.getMaterial()),
          pos, nor, uv, idx,
        });
      }
    }
    for (const child of node.listChildren()) visit(child, world);
  };

  const scene = root.getDefaultScene() || root.listScenes()[0];
  if (scene) for (const node of scene.listChildren()) visit(node, IDENT);
  else for (const node of root.listNodes()) if (!node.getParentNode()) visit(node, IDENT);

  return { meshes, materials, doc };
}

/**
 * Write a GLB.
 * @param meshes [{name, material, pos, nor, uv, idx, idxCap?, translation?}]
 *        `pos` must already be in the piece's local space; `translation` is the
 *        node transform.  `idxCap` becomes a second primitive using the
 *        material's "__break" variant.
 * @param materials from readGLB (or hand-authored {name,color,avg,metallic,roughness})
 */
export async function writeGLB(outPath, meshes, materials) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const io = new NodeIO();

  const surfaceMats = [];
  const breakMats = [];
  const texCache = new Map();

  materials.forEach((m, i) => {
    const sm = doc.createMaterial(`${m.name || `mat_${i}`}`);
    const c = m.color ?? [m.avg?.[0] ?? 0.7, m.avg?.[1] ?? 0.7, m.avg?.[2] ?? 0.7, 1];
    sm.setBaseColorFactor(c);
    sm.setMetallicFactor(m.metallic ?? 0);
    sm.setRoughnessFactor(m.roughness ?? 0.8);
    if (m.emissive && m.emissive.some((v) => v > 0)) sm.setEmissiveFactor(m.emissive);
    if (m.alphaMode === 'BLEND' || m.alphaMode === 'MASK') sm.setAlphaMode(m.alphaMode);
    sm.setDoubleSided(!!m.doubleSided);
    if (m.texture?.bytes) {
      const key = `${i}:${m.texture.bytes.length}`;
      let tex = texCache.get(key);
      if (!tex) {
        const img = doc.createTexture(`${m.name}_baseColor`).setImage(m.texture.bytes).setMimeType(m.texture.mime);
        tex = doc.createTextureInfo().setTexture(img);
        texCache.set(key, tex);
      }
      sm.setBaseColorTexture(tex);
    }
    surfaceMats.push(sm);

    // Fresh break: same albedo, no atlas (the cut face has planar UVs), rougher.
    const bm = doc.createMaterial(`${m.name || `mat_${i}`}__break`);
    const a = m.avg ?? [0.7, 0.7, 0.7];
    const k = m.breakTint ?? 0.62;
    bm.setBaseColorFactor([
      srgbToLinear(a[0]) * k,
      srgbToLinear(a[1]) * k,
      srgbToLinear(a[2]) * k,
      1,
    ]);
    bm.setMetallicFactor(0);
    bm.setRoughnessFactor(0.96);
    bm.setDoubleSided(!!m.doubleSided);
    breakMats.push(bm);
  });

  const f32 = (a) => (a instanceof Float32Array ? a : new Float32Array(a));
  const u32 = (a) => (a instanceof Uint32Array ? a : new Uint32Array(a));
  for (const m of meshes) {
    const mesh = doc.createMesh(m.name);
    const pos = doc.createAccessor(`${m.name}_pos`).setType('VEC3').setArray(f32(m.pos)).setBuffer(buffer);
    const ind = doc.createAccessor(`${m.name}_idx`).setType('SCALAR').setArray(u32(m.idx)).setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute('POSITION', pos).setIndices(ind);
    if (m.nor) prim.setAttribute('NORMAL', doc.createAccessor(`${m.name}_nor`).setType('VEC3').setArray(f32(m.nor)).setBuffer(buffer));
    if (m.uv) prim.setAttribute('TEXCOORD_0', doc.createAccessor(`${m.name}_uv`).setType('VEC2').setArray(f32(m.uv)).setBuffer(buffer));
    prim.setMaterial(surfaceMats[m.material] ?? surfaceMats[0]);
    mesh.addPrimitive(prim);

    if (m.idxCap && m.idxCap.length) {
      const capIdx = doc.createAccessor(`${m.name}_capIdx`).setType('SCALAR').setArray(u32(m.idxCap)).setBuffer(buffer);
      const capPrim = doc.createPrimitive().setAttribute('POSITION', pos).setIndices(capIdx);
      if (m.nor) capPrim.setAttribute('NORMAL', prim.getAttribute('NORMAL'));
      if (m.uv) capPrim.setAttribute('TEXCOORD_0', prim.getAttribute('TEXCOORD_0'));
      capPrim.setMaterial(breakMats[m.material] ?? breakMats[0]);
      mesh.addPrimitive(capPrim);
    }

    const node = doc.createNode(m.name).setMesh(mesh);
    if (m.translation) node.setTranslation(m.translation);
    scene.addChild(node);
  }

  doc.getRoot().setDefaultScene(scene);
  const out = await io.writeBinary(doc);
  await writeFile(outPath, Buffer.from(out));
  return out.byteLength;
}

/** Bounds of a mesh list, in world space. */
export function sceneBounds(meshes) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) {
    for (let i = 0; i < m.pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (m.pos[i + k] < lo[k]) lo[k] = m.pos[i + k];
        if (m.pos[i + k] > hi[k]) hi[k] = m.pos[i + k];
      }
    }
  }
  return { lo, hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
}
