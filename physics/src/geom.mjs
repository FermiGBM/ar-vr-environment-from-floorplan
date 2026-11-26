// Triangle-soup helpers shared by the fracture engine and the baker.
// A mesh is { pos: number[] (3n), uv: number[]|null (2n), idx: number[] (3t) }.
// Everything is plain JS arrays so the same code runs in Node and the browser.

export const EPS = 1e-7;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bbox(pos) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = pos[i + k];
      if (v < lo[k]) lo[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
  }
  return { lo, hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
}

export function meshVolume(pos, idx) {
  // signed volume of a closed triangle mesh (divergence theorem)
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    const bx = pos[b], by = pos[b + 1], bz = pos[b + 2];
    const cx = pos[c], cy = pos[c + 1], cz = pos[c + 2];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return Math.abs(v) / 6;
}

export function meshCentroid(pos, idx) {
  // volume-weighted centroid; falls back to the vertex mean for open meshes
  let vol = 0;
  let cx = 0, cy = 0, cz = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    const bx = pos[b], by = pos[b + 1], bz = pos[b + 2];
    const cx2 = pos[c], cy2 = pos[c + 1], cz2 = pos[c + 2];
    const v = ax * (by * cz2 - bz * cy2) - ay * (bx * cz2 - bz * cx2) + az * (bx * cy2 - by * cx2);
    vol += v;
    cx += (ax + bx + cx2) * v;
    cy += (ay + by + cy2) * v;
    cz += (az + bz + cz2) * v;
  }
  if (Math.abs(vol) > 1e-12) return [cx / (4 * vol), cy / (4 * vol), cz / (4 * vol)];
  let n = 0, sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < pos.length; i += 3) { sx += pos[i]; sy += pos[i + 1]; sz += pos[i + 2]; n++; }
  return [sx / n, sy / n, sz / n];
}

export function meshBoundsRadius(pos) {
  const b = bbox(pos);
  return 0.5 * Math.hypot(b.size[0], b.size[1], b.size[2]);
}

export function emptyMesh() {
  return { pos: [], uv: null, idx: [] };
}

export function meshTriangles(mesh) {
  const out = [];
  for (let t = 0; t < mesh.idx.length; t += 3) {
    const ia = mesh.idx[t], ib = mesh.idx[t + 1], ic = mesh.idx[t + 2];
    out.push([
      [mesh.pos[ia * 3], mesh.pos[ia * 3 + 1], mesh.pos[ia * 3 + 2]],
      [mesh.pos[ib * 3], mesh.pos[ib * 3 + 1], mesh.pos[ib * 3 + 2]],
      [mesh.pos[ic * 3], mesh.pos[ic * 3 + 1], mesh.pos[ic * 3 + 2]],
    ]);
  }
  return out;
}

export function faceNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

export function triangleArea(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

export function mat4Mul(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}

export function applyMat4(m, p) {
  const x = p[0], y = p[1], z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}
