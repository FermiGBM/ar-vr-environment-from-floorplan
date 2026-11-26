// A tiny image toolkit: decode JPEG/PNG, area-average resize, bilinear blit and
// a few alpha-blended primitives.  Just enough to compose the road tile, with
// no graphics dependency beyond the jpeg/png codecs the GLB path already uses.
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const u8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

/** Decode JPEG or PNG bytes into {w, h, data(RGBA)}. */
export function decode(bytes, mime = '') {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (/png/i.test(mime) || (b[0] === 0x89 && b[1] === 0x50)) {
    const p = PNG.sync.read(b);
    return { w: p.width, h: p.height, data: p.data };
  }
  const img = jpeg.decode(b, { useTArray: true, maxMemoryUsageInMB: 1024 });
  return { w: img.width, h: img.height, data: img.data };
}

export function encodeJPEG(img, quality = 86) {
  const data = Buffer.isBuffer(img.data) ? img.data : Buffer.from(img.data);
  return Buffer.from(jpeg.encode({ data, width: img.w, height: img.h }, quality).data);
}

export function create(w, h, [r, g, b, a] = [0, 0, 0, 255]) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
  }
  return { w, h, data };
}

/**
 * Weighted area-average resize.  Each destination texel averages exactly its
 * source footprint, with fractional edge coverage, so a non-integer scale does
 * not produce banding.
 */
export function resize(src, w, h) {
  const out = create(w, h);
  const sx = src.w / w, sy = src.h / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * sy, y1 = y0 + sy;
    const iy0 = Math.floor(y0), iy1 = Math.min(src.h, Math.ceil(y1));
    for (let x = 0; x < w; x++) {
      const x0 = x * sx, x1 = x0 + sx;
      const ix0 = Math.floor(x0), ix1 = Math.min(src.w, Math.ceil(x1));
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let yy = iy0; yy < iy1; yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        if (wy <= 0) continue;
        for (let xx = ix0; xx < ix1; xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
          if (wx <= 0) continue;
          const wt = wx * wy;
          const i = (yy * src.w + xx) * 4;
          r += src.data[i] * wt; g += src.data[i + 1] * wt;
          b += src.data[i + 2] * wt; a += src.data[i + 3] * wt;
          wsum += wt;
        }
      }
      const o = (y * w + x) * 4;
      out.data[o] = u8(r / wsum); out.data[o + 1] = u8(g / wsum);
      out.data[o + 2] = u8(b / wsum); out.data[o + 3] = u8(a / wsum);
    }
  }
  return out;
}

/** Bilinear blit of `src` stretched to fill the rect at (x0, y0). */
export function blit(dst, src, x0, y0, w, h) {
  for (let y = 0; y < h; y++) {
    const dy = y0 + y;
    if (dy < 0 || dy >= dst.h) continue;
    const v = h <= 1 ? 0 : (y / (h - 1)) * (src.h - 1);
    const y1 = Math.floor(v), y2 = Math.min(src.h - 1, y1 + 1), fy = v - y1;
    for (let x = 0; x < w; x++) {
      const dx = x0 + x;
      if (dx < 0 || dx >= dst.w) continue;
      const u = w <= 1 ? 0 : (x / (w - 1)) * (src.w - 1);
      const x1 = Math.floor(u), x2 = Math.min(src.w - 1, x1 + 1), fx = u - x1;
      const i11 = (y1 * src.w + x1) * 4, i21 = (y1 * src.w + x2) * 4;
      const i12 = (y2 * src.w + x1) * 4, i22 = (y2 * src.w + x2) * 4;
      const o = (dy * dst.w + dx) * 4;
      for (let c = 0; c < 4; c++) {
        const top = src.data[i11 + c] * (1 - fx) + src.data[i21 + c] * fx;
        const bot = src.data[i12 + c] * (1 - fx) + src.data[i22 + c] * fx;
        dst.data[o + c] = u8(top * (1 - fy) + bot * fy);
      }
    }
  }
}

export function blendPx(img, x, y, rgba, alpha) {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const a = alpha * ((rgba[3] ?? 255) / 255);
  if (a <= 0) return;
  const o = (y * img.w + x) * 4, d = img.data;
  d[o] = u8(d[o] * (1 - a) + rgba[0] * a);
  d[o + 1] = u8(d[o + 1] * (1 - a) + rgba[1] * a);
  d[o + 2] = u8(d[o + 2] * (1 - a) + rgba[2] * a);
  d[o + 3] = 255;
}

export function fillRect(img, x0, y0, w, h, rgba, alpha = 1) {
  const X0 = Math.max(0, Math.round(x0)), Y0 = Math.max(0, Math.round(y0));
  const X1 = Math.min(img.w, Math.round(x0 + w)), Y1 = Math.min(img.h, Math.round(y0 + h));
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) blendPx(img, x, y, rgba, alpha);
}

/** Soft-edged ellipse; `soft` is the fraction of the radius that fades out. */
export function fillEllipse(img, cx, cy, rx, ry, rgba, alpha = 1, soft = 0.4) {
  const X0 = Math.max(0, Math.floor(cx - rx)), X1 = Math.min(img.w - 1, Math.ceil(cx + rx));
  const Y0 = Math.max(0, Math.floor(cy - ry)), Y1 = Math.min(img.h - 1, Math.ceil(cy + ry));
  for (let y = Y0; y <= Y1; y++) {
    for (let x = X0; x <= X1; x++) {
      const r = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (r >= 1) continue;
      const edge = (1 - r) / Math.max(soft, 1e-3);
      blendPx(img, x, y, rgba, alpha * Math.min(1, edge));
    }
  }
}

/** Stroke a polyline of [x, y] points with a round-capped, soft brush. */
export function strokePath(img, pts, width, rgba, alpha = 1) {
  const r = width / 2;
  for (let s = 0; s + 1 < pts.length; s++) {
    const [ax, ay] = pts[s], [bx, by] = pts[s + 1];
    const X0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1));
    const X1 = Math.min(img.w - 1, Math.ceil(Math.max(ax, bx) + r + 1));
    const Y0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 1));
    const Y1 = Math.min(img.h - 1, Math.ceil(Math.max(ay, by) + r + 1));
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    for (let y = Y0; y <= Y1; y++) {
      for (let x = X0; x <= X1; x++) {
        let t = ((x - ax) * dx + (y - ay) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
        if (d > r) continue;
        blendPx(img, x, y, rgba, alpha * Math.min(1, (r - d) / Math.max(1, r * 0.6)));
      }
    }
  }
}
