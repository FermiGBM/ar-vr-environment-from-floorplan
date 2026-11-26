#!/usr/bin/env node
// Copy a rendered shot into ../docs/physics so GitHub Pages can serve it next to
// the interactive preview.
//
//   node tools/publish_video.mjs \
//     --video /tmp/opencode/kout/bridge.mp4 \
//     --stills /tmp/opencode/kout \
//     --poster frame-150.png
//
// Everything is optional: pass only what you have.  Existing files are replaced.
import { access, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const site = path.resolve(root, '..', 'docs', 'physics');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const video = arg('video', path.join(root, 'out', 'bridge.mp4'));
const stills = arg('stills', null);
const poster = arg('poster', 'frame-150.png');
const exists = (p) => access(p).then(() => true, () => false);

await mkdir(path.join(site, 'media'), { recursive: true });
const copied = [];
const missing = [];

const put = async (from, to) => {
  const dst = path.join(site, to);
  await mkdir(path.dirname(dst), { recursive: true });
  await copyFile(from, dst);
  copied.push(path.relative(path.resolve(root, '..'), dst));
};

if (await exists(video)) {
  await put(video, 'media/bridge.mp4');
  if (stills && (await exists(path.join(stills, poster)))) {
    const ext = path.extname(poster) || '.png';
    await put(path.join(stills, poster), `media/bridge-poster${ext}`);
  } else {
    missing.push(`poster ${poster} (video still copied)`);
  }
} else {
  missing.push(video);
}

for (const f of copied) console.log(`  ${f}`);
if (missing.length) {
  console.log('\nskipped:');
  for (const m of missing) console.log(`  ${m}`);
}
console.log(`\npublished ${copied.length} file(s) to ${path.relative(path.resolve(root, '..'), site)}`);
