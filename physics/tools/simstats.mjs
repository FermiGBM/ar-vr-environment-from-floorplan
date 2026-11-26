#!/usr/bin/env node
// Quick numeric read-out of a baked shot: how far things fall, how much water
// they hit, and whether anything is still moving at the end.
//
//   node tools/simstats.mjs out/bridge
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function loadShot(dir) {
  const sim = JSON.parse(await readFile(path.join(dir, 'sim.json'), 'utf8'));
  let motion = null;
  if (sim.motion) {
    const buf = await readFile(path.join(dir, sim.motion));
    motion = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  }
  const at = (body, frame) => {
    if (body.releaseFrame === null || !body.motion || body.motion.count === 0) {
      const [x, y, z, qx, qy, qz, qw] = body.initial;
      return { x, y, z, qx, qy, qz, qw };
    }
    const k = Math.max(0, Math.min(frame - body.releaseFrame, body.motion.count - 1));
    const o = body.motion.offset + k * 7;
    return {
      x: motion[o], y: motion[o + 1], z: motion[o + 2],
      qx: motion[o + 3], qy: motion[o + 4], qz: motion[o + 5], qw: motion[o + 6],
    };
  };
  return { sim, motion, at };
}

export async function stats(dir) {
  const { sim, at } = await loadShot(dir);
  const rows = [];
  for (let f = 0; f <= sim.frames; f += Math.max(1, Math.round(sim.frames / 9))) {
    const ys = [];
    let above = 0;
    let speed = 0;
    for (const b of sim.bodies) {
      const p = at(b, f);
      ys.push(p.y);
      if (p.y > 1) above++;
      if (f > 0) {
        const q = at(b, f - 1);
        speed = Math.max(speed, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) * sim.fps);
      }
    }
    const settled = sim.bodies.every((b) => b.sleepFrame !== null && b.sleepFrame <= f);
    rows.push({
      frame: f,
      time: +(f / sim.fps).toFixed(2),
      yMin: +Math.min(...ys).toFixed(2),
      yMax: +Math.max(...ys).toFixed(2),
      above1m: above,
      maxSpeed: +speed.toFixed(1),
      settled,
    });
  }
  const moved = sim.bodies.filter((b) => b.releaseFrame !== null).length;
  return {
    frames: sim.frames,
    fps: sim.fps,
    pieces: sim.bodies.length,
    released: moved,
    splashes: sim.splashes?.length ?? 0,
    decals: sim.decals?.length ?? 0,
    chips: sim.chips?.length ?? 0,
    explosions: sim.explosions?.length ?? 0,
    rows,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? 'out/bridge';
  const s = await stats(dir);
  console.log(
    `${dir}: ${s.pieces} pieces (${s.released} released), ${s.frames} frames @ ${s.fps}fps`,
  );
  console.log(
    `  ${s.splashes} splashes, ${s.decals} decals, ${s.chips} chips, ${s.explosions} blasts`,
  );
  console.log('  frame  time   yMin    yMax   >1m  maxSpeed  settled');
  for (const r of s.rows) {
    console.log(
      `  ${String(r.frame).padStart(5)}  ${String(r.time).padStart(5)}  ` +
        `${String(r.yMin).padStart(6)}  ${String(r.yMax).padStart(6)}  ` +
        `${String(r.above1m).padStart(4)}  ${String(r.maxSpeed).padStart(8)}  ${r.settled}`,
    );
  }
}
