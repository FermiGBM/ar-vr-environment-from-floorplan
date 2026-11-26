// Deterministic destruction bake on Rapier.
//
// The visual debris never comes from Rapier: colliders are convex hulls, the
// rendered geometry is the clipped source mesh (UVs, normals and material
// preserved).
//
// Collapse model (this is what keeps it from looking like confetti):
//   1. every piece starts as a Fixed body, welded to its neighbours by joints
//   2. a charge releases only the pieces inside its radius and cuts the joints
//      there, so the rest of the structure keeps standing
//   3. gravity does the work; joints break when their anchors separate
//   4. water adds buoyancy + drag and emits splash events
import RAPIER from '@dimforge/rapier3d-compat';
import { mulberry32 } from './geom.mjs';

let ready = null;
export function initRapier() {
  if (!ready) ready = RAPIER.init();
  return ready;
}

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function rot(q, v) {
  const { x, y, z, w } = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

function rotInv(q, v) {
  return rot({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);
}

/**
 * @param pieces  [{pos, idxAll, centroid, volume, mass, bounds, material}]
 * @param joints  [[i, j], ...] adjacency
 * @param cfg     shot.json (see examples/bridge/shot.json)
 */
export async function simulate(pieces, joints, cfg) {
  await initRapier();
  const rng = mulberry32(cfg.seed ?? 20261126);
  const fps = cfg.fps ?? 30;
  const frames = Math.max(1, Math.round((cfg.duration ?? 6) * fps));
  const sub = cfg.substeps ?? 2;
  const dt = 1 / (fps * sub);
  const world = new RAPIER.World({ x: 0, y: cfg.gravity?.[1] ?? -9.81, z: 0 });
  world.timestep = dt;
  if (cfg.solverIterations) world.numSolverIterations = cfg.solverIterations;

  const dyn = cfg.dynamics ?? {};
  const friction = dyn.friction ?? 0.85;
  const restitution = dyn.restitution ?? 0.04;
  const linDamp = dyn.linearDamping ?? 0.04;
  const angDamp = dyn.angularDamping ?? 0.12;
  const density = cfg.fracture?.density ?? 2400;

  const bodies = [];
  const colliderMap = new Map();
  const jointsList = [];
  const jointsByPiece = [];
  const breakDist = cfg.joints?.breakDistance ?? 0.12;
  const breakSpeed = cfg.joints?.breakSpeed ?? 4.0;
  const anchored = cfg.joints?.anchor ?? true;

  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const c = p.centroid;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(c[0], c[1], c[2])
        .setLinearDamping(linDamp)
        .setAngularDamping(angDamp)
        .setCcdEnabled(dyn.ccd ?? true),
    );

    const shrink = 1 - (dyn.colliderShrink ?? 0.01);
    const pts = new Float32Array(p.pos.length);
    for (let k = 0; k < p.pos.length; k += 3) {
      pts[k] = (p.pos[k] - c[0]) * shrink;
      pts[k + 1] = (p.pos[k + 1] - c[1]) * shrink;
      pts[k + 2] = (p.pos[k + 2] - c[2]) * shrink;
    }
    let desc = RAPIER.ColliderDesc.convexHull(pts);
    if (!desc) {
      const b = p.bounds;
      desc = RAPIER.ColliderDesc.cuboid(
        Math.max(0.02, (b.hi[0] - b.lo[0]) / 2),
        Math.max(0.02, (b.hi[1] - b.lo[1]) / 2),
        Math.max(0.02, (b.hi[2] - b.lo[2]) / 2),
      );
    }
    desc.setFriction(friction).setRestitution(restitution).setDensity(density);
    const collider = world.createCollider(desc, body);

    const rec = {
      id: i,
      body,
      collider,
      piece: p,
      released: false,
      releaseFrame: null,
      asleep: false,
      sleepFrame: null,
      frames: [],
      joints: [],
      splashedAt: null,
    };
    colliderMap.set(collider.handle, rec);
    bodies.push(rec);
    jointsByPiece.push([]);
  }

  // Joints are created lazily: only when both sides have been released.  A
  // joint that spans fixed -> dynamic bodies is over-constrained (one side has
  // infinite mass) and was the source of solver blow-ups.
  if (anchored) {
    for (const [i, j] of joints) {
      const a = bodies[i], b = bodies[j];
      const mid = [
        (a.piece.centroid[0] + b.piece.centroid[0]) / 2,
        (a.piece.centroid[1] + b.piece.centroid[1]) / 2,
        (a.piece.centroid[2] + b.piece.centroid[2]) / 2,
      ];
      const rec = {
        a, b,
        anchorA: [mid[0] - a.piece.centroid[0], mid[1] - a.piece.centroid[1], mid[2] - a.piece.centroid[2]],
        anchorB: [mid[0] - b.piece.centroid[0], mid[1] - b.piece.centroid[1], mid[2] - b.piece.centroid[2]],
        joint: null,
        alive: true,
        cut: false,
      };
      const idx = jointsList.length;
      jointsList.push(rec);
      jointsByPiece[i].push(idx);
      jointsByPiece[j].push(idx);
    }
  }

  // static riverbed / ground so debris settles instead of falling forever
  if (cfg.ground) {
    const level = cfg.ground.level ?? -10;
    const half = cfg.ground.extent ?? 300;
    const gb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, level - 1, 0));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(half, 1, half)
        .setFriction(cfg.ground.friction ?? 0.95)
        .setRestitution(0.02),
      gb,
    );
  }

  const charges = (cfg.charges ?? [])
    .map((c) => ({ ...c, frame: Math.round((c.time ?? 0) * fps), fired: false, pending: null }))
    .sort((a, b) => a.frame - b.frame);

  const shots = (cfg.shots ?? []).map((s) => ({ ...s, frame: Math.round((s.time ?? 0) * fps), fired: false }));
  const water = cfg.water
    ? {
        level: cfg.water.level ?? 0,
        extent: cfg.water.extent ?? [80, 80],
        buoyancy: cfg.water.buoyancy ?? 1.6,
        drag: cfg.water.drag ?? 1.8,
        splashSpeed: cfg.water.splashSpeed ?? 2.0,
      }
    : null;

  const events = { explosions: [], decals: [], splashes: [], chips: [], dust: [] };
  const killY = cfg.killY ?? -40;

  const makeJoint = (rec) => {
    if (rec.joint || rec.cut || !rec.a.released || !rec.b.released) return;
    const q0 = { x: 0, y: 0, z: 0, w: 1 };
    // Rapier reads .x/.y/.z; arrays would silently become NaN anchors.
    const a1 = { x: rec.anchorA[0], y: rec.anchorA[1], z: rec.anchorA[2] };
    const a2 = { x: rec.anchorB[0], y: rec.anchorB[1], z: rec.anchorB[2] };
    rec.joint = world.createImpulseJoint(
      RAPIER.JointData.fixed(a1, q0, a2, q0),
      rec.a.body,
      rec.b.body,
      true,
    );
    // welded neighbours are rigidly attached: their own contact is redundant
    if (cfg.joints?.contacts !== true && rec.joint.setContactsEnabled) {
      rec.joint.setContactsEnabled(false);
    }
  };

  const release = (rec, frame) => {
    if (rec.released) return;
    rec.released = true;
    rec.releaseFrame = frame;
    rec.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    for (const idx of jointsByPiece[rec.id]) makeJoint(jointsList[idx]);
  };

  const cutJoint = (rec) => {
    if (rec.cut) return;
    rec.cut = true;
    rec.alive = false;
    if (rec.joint) {
      world.removeImpulseJoint(rec.joint, true);
      rec.joint = null;
    }
  };

  const cutJointsAcross = (region) => {
    if (!region || !region.lo) return;
    for (const rec of jointsList) {
      if (rec.cut) continue;
      const a = inside(rec.a.piece.centroid, region);
      const b = inside(rec.b.piece.centroid, region);
      if (a !== b) cutJoint(rec);
    }
  };

  const cutJointsNear = (point, radius) => {
    for (const rec of jointsList) {
      if (rec.cut) continue;
      const a = rec.a.piece.centroid, b = rec.b.piece.centroid;
      const da = Math.hypot(a[0] - point[0], a[1] - point[1], a[2] - point[2]);
      const db = Math.hypot(b[0] - point[0], b[1] - point[1], b[2] - point[2]);
      if (Math.min(da, db) <= radius) cutJoint(rec);
    }
  };

  const inside = (p, b) =>
    !b ||
    (p[0] >= b.lo[0] && p[0] <= b.hi[0] &&
      p[1] >= b.lo[1] && p[1] <= b.hi[1] &&
      p[2] >= b.lo[2] && p[2] <= b.hi[2]);

  const fireCharge = (c, frame) => {
    const pos = c.position ?? [0, 0, 0];
    const radius = c.radius ?? 6;
    const power = c.power ?? 6;
    const up = c.upBias ?? 0.22;
    const implode = !!c.implode;
    const bounds = c.bounds ?? null;
    const releaseRegion = c.release ?? null;
    // cut first, so no joint is ever created across the new break
    cutJointsNear(pos, radius);
    if (releaseRegion) cutJointsAcross(releaseRegion);
    const released = [];
    for (const rec of bodies) {
      const p = rec.piece.centroid;
      const d = Math.hypot(p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]);
      if (releaseRegion && releaseRegion.lo) {
        if (!inside(p, releaseRegion)) continue;
      } else if (releaseRegion) {
        const rr = typeof releaseRegion === 'number' ? releaseRegion : radius;
        if (d > rr) continue;
      } else if (d > radius) continue;
      if (!inside(p, bounds)) continue;
      release(rec, frame);
      released.push(rec);
    }
    if (cfg.releaseAll) for (const rec of bodies) release(rec, frame);

    for (const rec of released) {
      const p = rec.piece.centroid;
      const d = Math.max(0.05, Math.hypot(p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]));
      const fall = Math.pow(clamp(1 - d / radius, 0, 1), 1.5);
      let dir = [p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]];
      const l = Math.hypot(...dir) || 1;
      dir = dir.map((v) => v / l);
      if (implode) dir = dir.map((v) => -v);
      dir[1] += up;
      const mag = power * fall * rec.piece.mass;
      rec.body.applyImpulse({ x: dir[0] * mag, y: dir[1] * mag, z: dir[2] * mag }, true);
      rec.body.applyTorqueImpulse(
        {
          x: (rng() - 0.5) * mag * 0.06,
          y: (rng() - 0.5) * mag * 0.06,
          z: (rng() - 0.5) * mag * 0.06,
        },
        true,
      );
    }
    events.explosions.push({
      frame,
      position: pos,
      radius,
      visible: c.visible !== false,
      kind: implode ? 'implode' : 'explode',
    });
    events.dust.push({
      frame,
      position: pos,
      radius: radius * (implode ? 0.9 : 1.15),
      count: c.dust ?? 26,
      life: c.dustLife ?? 2.2,
      color: c.dustColor ?? [0.62, 0.6, 0.56],
    });
    if (implode) {
      c.pending = { frame: frame + (c.implodeFrames ?? 6), pos, radius, power, up };
    }
  };

  const fireShot = (s, frame) => {
    const from = s.from ?? [0, 0, 0];
    const to = s.to ?? [from[0], from[1], from[2] - 1];
    const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const len = Math.hypot(...d) || 1;
    const dir = { x: d[0] / len, y: d[1] / len, z: d[2] / len };
    const ray = new RAPIER.Ray({ x: from[0], y: from[1], z: from[2] }, dir);
    // a few cm of slack: the aim point usually sits exactly on the surface
    const hit = world.castRayAndGetNormal(ray, len + 0.25, true);
    if (!hit) return;
    const toi = Math.min(len, hit.timeOfImpact ?? hit.toi ?? 0);
    const point = [from[0] + dir.x * toi, from[1] + dir.y * toi, from[2] + dir.z * toi];
    const collider = hit.collider;
    const rec = collider ? colliderMap.get(collider.handle) : null;
    const hn = hit.normal;
    const normal = hn ? [hn.x, hn.y, hn.z] : [0, 1, 0];
    if (rec) {
      const body = rec.body;
      const t = body.translation();
      const q = body.rotation();
      const local = rotInv(q, [point[0] - t.x, point[1] - t.y, point[2] - t.z]);
      const localNormal = rotInv(q, normal);
      const imp = (s.impulse ?? 1.2) * (s.massScale ?? 1);
      body.applyImpulseAtPoint(
        { x: dir.x * imp, y: dir.y * imp, z: dir.z * imp },
        { x: point[0], y: point[1], z: point[2] },
        true,
      );
      events.decals.push({
        frame,
        piece: rec.id,
        local: local.map(r4),
        localNormal: localNormal.map(r4),
        position: point.map(r4),
        normal,
        size: s.size ?? 0.16,
        kind: s.kind ?? 'bullet',
        depth: s.depth ?? 0.02,
      });
    }
    const nChips = s.chips ?? 4;
    for (let i = 0; i < nChips; i++) {
      const spread = s.spread ?? 0.9;
      events.chips.push({
        frame,
        position: point.map(r4),
        velocity: [
          r4(dir.x * (1.5 + rng() * 2.5) + (rng() - 0.5) * spread),
          r4(dir.y * (1.5 + rng() * 2.5) + rng() * spread),
          r4(dir.z * (1.5 + rng() * 2.5) + (rng() - 0.5) * spread),
        ],
        size: r4(0.012 + rng() * 0.035),
        life: r4(0.7 + rng() * 0.9),
        color: s.chipColor ?? null,
      });
    }
  };

  for (let f = 0; f <= frames; f++) {
    for (const c of charges) {
      if (!c.fired && f >= c.frame) {
        c.fired = true;
        fireCharge(c, f);
      }
      if (c.pending && f >= c.pending.frame) {
        for (const rec of bodies) {
          if (!rec.released) continue;
          const p = rec.piece.centroid;
          const d = Math.hypot(p[0] - c.pending.pos[0], p[1] - c.pending.pos[1], p[2] - c.pending.pos[2]);
          if (d > c.pending.radius) continue;
          const dir = [p[0] - c.pending.pos[0], p[1] - c.pending.pos[1], p[2] - c.pending.pos[2]];
          const l = Math.hypot(...dir) || 1;
          const mag = c.pending.power * rec.piece.mass * 1.6;
          rec.body.applyImpulse(
            {
              x: (dir[0] / l) * mag,
              y: (dir[1] / l) * mag + mag * 0.2,
              z: (dir[2] / l) * mag,
            },
            true,
          );
        }
        c.pending = null;
      }
    }
    for (const s of shots) {
      if (!s.fired && f >= s.frame) {
        s.fired = true;
        fireShot(s, f);
      }
    }

    for (let k = 0; k < sub; k++) {
      if (water) {
        const g = Math.abs(cfg.gravity?.[1] ?? 9.81);
        for (const rec of bodies) {
          if (!rec.released) continue;
          const t = rec.body.translation();
          const b = rec.piece.bounds;
          const h = Math.max(0.05, b.hi[1] - b.lo[1]);
          const frac = clamp((water.level - (t.y - h / 2)) / h, 0, 1);
          if (frac <= 0) continue;
          // Rapier keeps addForce() accumulators until reset, so integrate
          // buoyancy/drag as impulses (force * dt) instead.
          const m = rec.piece.mass;
          rec.body.applyImpulse({ x: 0, y: m * g * water.buoyancy * frac * dt, z: 0 }, true);
          const v = rec.body.linvel();
          const k = m * water.drag * frac * dt;
          rec.body.applyImpulse({ x: -v.x * k, y: -v.y * k, z: -v.z * k }, true);
        }
      }
      world.step();
      if (!Number.isFinite(bodies[0].body.translation().x)) {
        const b0 = bodies.find((b) => !Number.isFinite(b.body.translation().x));
        throw new Error(`simulation diverged at frame ${f} (piece ${b0?.id}): non-finite transform`);
      }
    }

    // joint strain check
    for (const rec of jointsList) {
      if (!rec.joint) continue;
      const ta = rec.a.body.translation(), tb = rec.b.body.translation();
      const qa = rec.a.body.rotation(), qb = rec.b.body.rotation();
      const wa = rot(qa, rec.anchorA), wb = rot(qb, rec.anchorB);
      const sep = Math.hypot(
        ta.x + wa[0] - (tb.x + wb[0]),
        ta.y + wa[1] - (tb.y + wb[1]),
        ta.z + wa[2] - (tb.z + wb[2]),
      );
      const va = rec.a.body.linvel(), vb = rec.b.body.linvel();
      const rel = Math.hypot(va.x - vb.x, va.y - vb.y, va.z - vb.z);
      if (sep > breakDist || rel > breakSpeed) cutJoint(rec);
    }

    // splashes + record
    for (const rec of bodies) {
      if (!rec.released || rec.asleep) continue;
      const t = rec.body.translation();
      if (water && t.y < water.level && t.y > water.level - 2.0) {
        const v = rec.body.linvel();
        if (v.y < -water.splashSpeed && rec.splashedAt === null) {
          rec.splashedAt = f;
          events.splashes.push({
            frame: f,
            position: [r4(t.x), water.level, r4(t.z)],
            strength: r4(clamp(Math.abs(v.y) / 8, 0.25, 1.6)),
            radius: r4(clamp(rec.piece.volume ** (1 / 3) * 1.6, 0.3, 2.2)),
            mass: r4(rec.piece.mass),
          });
        }
      }
      if (rec.body.isSleeping()) {
        rec.asleep = true;
        rec.sleepFrame = f;
        continue;
      }
      const q = rec.body.rotation();
      rec.frames.push([f, r4(t.x), r4(t.y), r4(t.z), r4(q.x), r4(q.y), r4(q.z), r4(q.w)]);
      if (t.y < killY) {
        rec.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
        rec.asleep = true;
        rec.sleepFrame = f;
      }
    }
  }

  const outBodies = bodies.map((rec) => {
    const c = rec.piece.centroid;
    return {
      id: rec.id,
      name: `piece_${String(rec.id).padStart(3, '0')}`,
      material: rec.piece.material ?? 0,
      mass: r4(rec.piece.mass),
      volume: r4(rec.piece.volume),
      initial: [r4(c[0]), r4(c[1]), r4(c[2]), 0, 0, 0, 1],
      releaseFrame: rec.releaseFrame,
      sleepFrame: rec.sleepFrame,
      frames: rec.frames,
    };
  });

  return {
    version: 1,
    fps,
    frames,
    duration: frames / fps,
    gravity: cfg.gravity ?? [0, -9.81, 0],
    bodies: outBodies,
    explosions: events.explosions,
    decals: events.decals,
    splashes: events.splashes,
    chips: events.chips,
    dust: events.dust,
    water: water ? { level: water.level, extent: water.extent } : null,
    ground: cfg.ground ? { level: cfg.ground.level ?? -10, extent: cfg.ground.extent ?? 300 } : null,
    killY,
  };
}
