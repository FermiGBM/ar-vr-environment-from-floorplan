// Road-tile checks: the painted lane markings must land at the right metre
// positions, the dashes must be 3 m on / 9 m off, and the metallic-roughness
// texture must be packed the way glTF wants it (G = roughness, B = 0).
//
//   node test/roadtile.test.mjs
import { buildRoadTile, LANES } from '../src/roadtile.mjs';
import { create } from '../src/texture.mjs';

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures++;
};

const W = 1536, H = 2048;
const tile = buildRoadTile(
  {
    albedo: create(64, 64, [40, 40, 42, 255]),
    normal: create(64, 64, [128, 128, 255, 255]),
    rough: create(64, 64, [200, 200, 200, 255]),
  },
  { width: W, height: H },
);

check(tile.albedo.w === W && tile.albedo.h === H, `tile is ${W}x${H}`);
check(tile.mr.w === W && tile.mr.h === H, 'metallic-roughness tile matches');

const ux = W / 12;
const vz = H / 16;
const at = (img, x, y) => {
  const o = (y * img.w + x) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
};
const lum = (p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
// fraction of the line that reads as painted, sampled over a band, so a random
// tar patch cannot make the check flaky
const painted = (z, x0, x1) => {
  const row = Math.round((z + 8) * vz);
  let bright = 0, total = 0;
  for (let x = Math.round(x0 * ux); x < Math.round(x1 * ux); x += 3) {
    let m = 0;
    for (let y = row - 10; y <= row + 10; y++) m = Math.max(m, lum(at(tile.albedo, x, y)));
    if (m > 180) bright++;
    total++;
  }
  return bright / total;
};

check(painted(-7.5, 1, 11) > 0.6, `solid edge line at z=-7.5 (${(painted(-7.5, 1, 11) * 100).toFixed(0)}% painted)`);
check(painted(7.5, 1, 11) > 0.6, `solid edge line at z=+7.5 (${(painted(7.5, 1, 11) * 100).toFixed(0)}% painted)`);
check(painted(-0.5, 1, 11) > 0.6, 'solid median line at z=-0.5');
check(painted(0.5, 1, 11) > 0.6, 'solid median line at z=+0.5');

// dashed divider at z = -4: painted for the first 3 m, clear from 4 m on
check(painted(LANES[1], 0, 3) > 0.6, `dash painted in the first 3 m (${(painted(LANES[1], 0, 3) * 100).toFixed(0)}%)`);
check(painted(LANES[1], 4, 12) < 0.1, `no dash past 4 m — 3 m dash / 9 m gap (${(painted(LANES[1], 4, 12) * 100).toFixed(0)}%)`);
check(painted(LANES[4], 0, 3) > 0.6, 'dash painted on the far divider');

// bare asphalt stays dark
let sum = 0, n = 0;
for (let y = 200; y < 260; y++) for (let x = 600; x < 660; x++) { sum += lum(at(tile.albedo, x, y)); n++; }
check(sum / n < 120, `unpainted asphalt is dark (mean ${(sum / n).toFixed(0)})`);

// expansion joint sits on the seam and is dark
check(lum(at(tile.albedo, 0, 400)) < 60 && lum(at(tile.albedo, W - 1, 400)) < 60, 'seam is an expansion joint');
check(at(tile.normal, 0, 400)[0] < 128, 'joint is a groove in the normal map');

// MR packing: R = AO (255), B = metalness (0)
let bad = 0;
for (let i = 0; i < tile.mr.data.length; i += 4) {
  if (tile.mr.data[i] !== 255 || tile.mr.data[i + 2] !== 0) bad++;
}
check(bad === 0, `metallic-roughness packed (R=255, B=0 for all ${tile.mr.data.length / 4} texels)`);

console.log(failures ? `\n${failures} failure(s)` : '\nall road-tile tests passed');
process.exit(failures ? 1 : 0);
