// Compose the road surface tile.
//
// The deck is covered by a single 12 m (along) x 16 m (across) tile that repeats
// every 12 m, and the deck's UVs are simply metres/12 (u) and (z + 8)/16 (v).
// Because the painted lane markings live in the material, they survive the
// fracture: a debris chunk keeps its slice of the tile.
//
// Layout: four 3.5 m lanes, solid edge lines, a dashed divider on each side of a
// concrete median, wheel-path wear, tar patches and hairline cracks, and an
// expansion joint that lands exactly on the tile seam so the repeat reads as a
// joint.  The base asphalt is picked for a flat large-scale response, so the
// 4 m repeat never announces itself.
import { blendPx, blit, create, fillEllipse, fillRect, resize, strokePath } from './texture.mjs';

const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Marking lines across the deck, in metres from the centreline (z = 0). */
export const LANES = [-7.5, -4, -0.5, 0.5, 4, 7.5];

const u8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

/** Rescale a cell so its mean luminance lands on `mean` with a little contrast. */
function grade(img, mean, contrast = 1.12) {
  let sum = 0, n = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    sum += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
    n++;
  }
  const cur = sum / n;
  for (let i = 0; i < img.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      img.data[i + c] = u8(mean + (img.data[i + c] - cur) * contrast);
    }
  }
  return img;
}

export function buildRoadTile(src, opts = {}) {
  const W = opts.width ?? 1536;
  const H = opts.height ?? 2048;
  const worldU = opts.worldU ?? 12;
  const worldV = opts.worldV ?? 16;
  const halfV = worldV / 2;
  const cell = opts.cell ?? 4;
  const mean = opts.mean ?? 64;
  const ux = W / worldU;
  const vz = H / worldV;
  const repsU = Math.max(1, Math.round(worldU / cell));
  const repsV = Math.max(1, Math.round(worldV / cell));
  const cw = Math.round(W / repsU);
  const ch = Math.round(H / repsV);
  const rand = rng(opts.seed ?? 7);

  const albedo = create(W, H, [26, 27, 29, 255]);
  const normal = create(W, H, [128, 128, 255, 255]);
  const rough = create(W, H, [200, 200, 200, 255]);

  const aT = grade(resize(src.albedo, cw, ch), mean);
  const nT = src.normal ? resize(src.normal, cw, ch) : null;
  const rT = src.rough ? resize(src.rough, cw, ch) : null;
  for (let ry = 0; ry < repsV; ry++) {
    for (let rx = 0; rx < repsU; rx++) {
      const x = rx * cw, y = ry * ch;
      blit(albedo, aT, x, y, cw, ch);
      if (nT) blit(normal, nT, x, y, cw, ch);
      if (rT) blit(rough, rT, x, y, cw, ch);
    }
  }

  const px = (m) => m * ux;
  const pz = (z) => (z + halfV) * vz;
  const WHITE = [236, 236, 228, 255];
  const FLAT = [128, 128, 255, 255];

  // paint every layer at once: albedo white, normal flattened, roughness lower
  const paint = (x, y, w, h, alpha) => {
    fillRect(albedo, x, y, w, h, WHITE, alpha);
    fillRect(normal, x, y, w, h, FLAT, alpha * 0.7);
    fillRect(rough, x, y, w, h, [168, 168, 168, 255], alpha * 0.9);
  };
  const WIDTH = 0.16;
  const solidLine = (z, alpha = 0.88) => paint(0, pz(z) - (WIDTH * vz) / 2, W, WIDTH * vz, alpha);
  const dashedLine = (z, alpha = 0.84) => paint(0, pz(z) - (WIDTH * vz) / 2, px(3), WIDTH * vz, alpha);

  solidLine(LANES[0]);
  dashedLine(LANES[1]);
  solidLine(LANES[2]);
  solidLine(LANES[3]);
  dashedLine(LANES[4]);
  solidLine(LANES[5]);

  // worn paint: speckle dark asphalt back through the lines
  for (const z of LANES) {
    const row = pz(z);
    for (let i = 0; i < 60; i++) {
      const x = rand() * W;
      const y = row + (rand() - 0.5) * 0.2 * vz;
      fillRect(albedo, x, y, 2 + rand() * 8, 1 + rand() * 3, [30, 31, 33, 255], 0.25 + rand() * 0.4);
    }
  }

  // hairline cracks: wandering dark polylines that never repeat on a grid
  for (let i = 0; i < 4; i++) {
    const pts = [];
    let x = rand() * W * 0.6;
    let z = -halfV + rand() * worldV;
    for (let s = 0; s < 14; s++) {
      pts.push([px(x % worldU), pz(z)]);
      x += 0.6 + rand() * 1.4;
      z += (rand() - 0.5) * 2.4;
      if (z < -halfV + 0.4 || z > halfV - 0.4) z = Math.max(-halfV + 0.4, Math.min(halfV - 0.4, z));
      if (x > worldU) break;
    }
    strokePath(albedo, pts, 1.6 + rand() * 1.6, [17, 18, 20, 255], 0.55);
    strokePath(normal, pts.map(([x2, y2]) => [x2, y2]), 1.4 + rand(), [110, 128, 255, 255], 0.5);
  }

  // wheel-path wear (darker, polished) and a few oil drips per lane
  const centres = [];
  for (let i = 0; i + 1 < LANES.length; i++) centres.push((LANES[i] + LANES[i + 1]) / 2);
  // stacked bands fake a soft vertical gradient, so the wear has no hard edges
  const band = (img, zc, widthM, rgba, peak, layers = 5) => {
    for (let k = 0; k < layers; k++) {
      const f = 1 - k / layers;
      fillRect(img, 0, pz(zc - widthM * f), W, 2 * widthM * f * vz, rgba, peak / layers);
    }
  };
  for (const c of centres) {
    for (const s of [-0.95, 0.95]) {
      band(albedo, c + s, 0.34, [15, 16, 18, 255], 0.16);
      band(rough, c + s, 0.34, [180, 180, 180, 255], 0.4);
    }
    for (let i = 0; i < 3; i++) {
      const cx = rand() * W;
      const cy = pz(c) + (rand() - 0.5) * 1.4 * vz;
      fillEllipse(albedo, cx, cy, 0.16 * ux, 0.13 * vz, [9, 9, 11, 255], 0.34, 0.7);
      fillEllipse(rough, cx, cy, 0.18 * ux, 0.15 * vz, [152, 152, 152, 255], 0.3, 0.7);
    }
  }

  // tar-sealed patches: tight dark seams, not soft blobs
  for (let i = 0; i < 3; i++) {
    const cx = 0.2 * W + rand() * 0.6 * W;
    const cy = 0.1 * H + rand() * 0.8 * H;
    const rx = (0.3 + rand() * 0.4) * ux;
    const ry = (0.22 + rand() * 0.35) * vz;
    fillEllipse(albedo, cx, cy, rx, ry, [22, 23, 25, 255], 0.34, 0.7);
    fillEllipse(rough, cx, cy, rx, ry, [168, 168, 168, 255], 0.35, 0.7);
    // a lighter sealed-edge highlight
    strokePath(albedo, [
      [cx - rx, cy], [cx - rx * 0.3, cy - ry * 0.8], [cx + rx * 0.4, cy - ry * 0.5], [cx + rx, cy + ry * 0.2],
    ], 1.4, [58, 60, 62, 255], 0.4);
  }

  // expansion joint exactly on the seam, and a groove in the normal map
  const jw = Math.max(2, Math.round(0.05 * ux));
  for (const x of [0, W - jw]) {
    fillRect(albedo, x, 0, jw, H, [12, 12, 13, 255], 0.9);
    fillRect(rough, x, 0, jw, H, [238, 238, 238, 255], 0.8);
  }
  fillRect(normal, 0, 0, jw, H, [108, 128, 255, 255], 0.6);
  fillRect(normal, W - jw, 0, jw, H, [148, 128, 255, 255], 0.6);

  // metallic-roughness: R = AO (none), G = roughness, B = metalness (0)
  const mr = create(W, H, [255, 200, 0, 255]);
  for (let i = 0; i < mr.data.length; i += 4) {
    mr.data[i] = 255;
    mr.data[i + 1] = rough.data[i + 1];
    mr.data[i + 2] = 0;
    mr.data[i + 3] = 255;
  }

  return { albedo, normal, mr, meta: { W, H, worldU, worldV, ux, vz, lanes: LANES } };
}
