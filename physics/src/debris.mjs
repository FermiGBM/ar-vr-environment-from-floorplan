// Runtime for a baked destruction shot.
//
//   const fx = await loadDestruction({ glb: 'debris.glb', sim: 'sim.json' });
//   scene.add(fx.group);
//   fx.update(frame);            // frame index at sim.fps
//
// All debris pieces are merged into one geometry per material and moved in the
// vertex shader from a transform texture, so a 300-piece collapse is a handful
// of draw calls instead of 300.  Water, splash rings, dust, chips, decals and
// blast flashes are derived from the baked event list, so playback is exactly
// repeatable frame by frame (Remotion-friendly).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const TAU = Math.PI * 2;

const srgb = (hex) => new THREE.Color(hex);

function fetchJson(url) {
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
    return r.json();
  });
}

/**
 * @param {object} opts
 * @param {string} opts.glb   debris.glb url
 * @param {string} opts.sim   sim.json url
 * @param {string} [opts.motion] motion.bin url (defaults to sim.motion next to sim)
 * @param {boolean} [opts.shadows]
 */
export async function loadDestruction(opts) {
  const sim = await fetchJson(opts.sim);
  const baseUrl = opts.sim.replace(/[^/]*$/, '');
  let motion = null;
  if (sim.motion) {
    const url = opts.motion ?? baseUrl + sim.motion;
    const buf = await fetch(url).then((r) => {
      if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
      return r.arrayBuffer();
    });
    motion = new Float32Array(buf);
  }

  const gltf = await new GLTFLoader().loadAsync(opts.glb);
  const merged = mergePieces(gltf.scene, sim, motion);

  const group = new THREE.Group();
  group.name = 'destruction';
  group.add(merged.mesh);

  const fx = {
    sim,
    motion,
    group,
    mesh: merged.mesh,
    pieces: merged.pieces,
    update,
    setTime: (seconds) => update(Math.round(seconds * sim.fps)),
    dispose,
  };

  // ---- transform texture ------------------------------------------------
  const n = sim.bodies.length;
  const texData = new Float32Array(n * 8);
  const tex = new THREE.DataTexture(texData, n * 2, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;

  const uniforms = { uPieces: { value: tex }, uPieceCount: { value: n } };
  for (const mat of merged.materials) patchMaterial(mat, uniforms);
  if (merged.mesh.customDepthMaterial) patchMaterial(merged.mesh.customDepthMaterial, uniforms);

  // ---- water / bed / events --------------------------------------------
  const water = sim.water ? makeWater(sim.water) : null;
  if (water) group.add(water);
  const bed = sim.ground ? makeBed(sim.ground) : null;
  if (bed) group.add(bed);

  const rings = makeSplashRings(sim);
  if (rings) group.add(rings);
  const particles = makeParticles(sim);
  if (particles) group.add(particles.points);
  const flashes = makeFlashes(sim);
  if (flashes) group.add(flashes);
  const decals = makeDecals(sim.decals, merged.pieceById);
  if (decals) group.add(decals.mesh);

  // named handles so previews / Remotion can toggle effects
  const parts = { water, bed, rings, particles: particles?.points, flashes, decals: decals?.mesh };
  fx.parts = parts;
  for (const [k, v] of Object.entries(parts)) if (v) v.name = `fx_${k}`;

  const tmpP = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpM = new THREE.Matrix4();
  const ONE = new THREE.Vector3(1, 1, 1);

  /** Write piece transforms for `frame` and update every effect. */
  function update(frame) {
    const f = Math.max(0, Math.min(sim.frames, Math.round(frame)));
    for (let i = 0; i < n; i++) {
      const b = sim.bodies[i];
      let px, py, pz, qx, qy, qz, qw;
      if (b.releaseFrame === null || f < b.releaseFrame || !b.motion || b.motion.count === 0) {
        [px, py, pz, qx, qy, qz, qw] = b.initial;
      } else {
        const k = Math.min(f - b.releaseFrame, b.motion.count - 1);
        const o = b.motion.offset + k * 7;
        px = motion[o]; py = motion[o + 1]; pz = motion[o + 2];
        qx = motion[o + 3]; qy = motion[o + 4]; qz = motion[o + 5]; qw = motion[o + 6];
      }
      const o = i * 8;
      texData[o] = px; texData[o + 1] = py; texData[o + 2] = pz; texData[o + 3] = 0;
      texData[o + 4] = qx; texData[o + 5] = qy; texData[o + 6] = qz; texData[o + 7] = qw;
    }
    tex.needsUpdate = true;

    const t = f / sim.fps;
    if (water) water.material.uniforms.uTime.value = t;
    if (rings) rings.material.uniforms.uTime.value = t;
    if (particles) particles.material.uniforms.uTime.value = t;
    if (flashes) flashes.material.uniforms.uTime.value = t;

    if (decals) {
      for (let i = 0; i < decals.items.length; i++) {
        const d = decals.items[i];
        const b = sim.bodies[d.piece];
        if (!b) continue;
        const o = d.piece * 8;
        tmpP.set(texData[o], texData[o + 1], texData[o + 2]);
        tmpQ.set(texData[o + 4], texData[o + 5], texData[o + 6], texData[o + 7]);
        tmpM.compose(tmpP, tmpQ, ONE);
        tmpM.multiply(d.local);
        decals.mesh.setMatrixAt(i, tmpM);
      }
      decals.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function dispose() {
    merged.mesh.geometry.dispose();
    for (const m of merged.materials) m.dispose();
    tex.dispose();
    if (water) { water.geometry.dispose(); water.material.dispose(); }
    if (bed) { bed.geometry.dispose(); bed.material.dispose(); }
    if (rings) { rings.geometry.dispose(); rings.material.dispose(); }
    if (particles) { particles.points.geometry.dispose(); particles.material.dispose(); }
    if (flashes) { flashes.geometry.dispose(); flashes.material.dispose(); }
    if (decals) { decals.mesh.geometry.dispose(); decals.mesh.material.dispose(); }
  }

  // initial pose
  update(0);
  return fx;
}

// ---------------------------------------------------------------------------
// geometry merge
// ---------------------------------------------------------------------------

function mergePieces(scene, sim, motion) {
  const byId = new Map();
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    let node = o;
    let id = null;
    while (node) {
      const m = /^piece_(\d+)$/.exec(node.name || '');
      if (m) { id = Number(m[1]); break; }
      node = node.parent;
    }
    if (id === null) return;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(o);
  });

  const ids = [...byId.keys()].sort((a, b) => a - b);
  const positions = [];
  const normals = [];
  const uvs = [];
  const pieceAttr = [];
  const matOrder = [];
  const matIndex = new Map();
  const matIndices = [];
  let vertexCount = 0;

  for (const id of ids) {
    const meshes = byId.get(id);
    for (const mesh of meshes) {
      const g = mesh.geometry;
      const p = g.attributes.position;
      if (!p) continue;
      const nor = g.attributes.normal;
      const uv = g.attributes.uv;
      const base = vertexCount;
      for (let i = 0; i < p.count; i++) {
        positions.push(p.getX(i), p.getY(i), p.getZ(i));
        if (nor) normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
        else normals.push(0, 0, 0);
        if (uv) uvs.push(uv.getX(i), uv.getY(i));
        else uvs.push(0, 0);
        pieceAttr.push(id);
      }
      const mat = mesh.material;
      if (!matIndex.has(mat)) { matIndex.set(mat, matOrder.length); matOrder.push(mat); matIndices.push([]); }
      const dst = matIndices[matIndex.get(mat)];
      if (g.index) {
        const a = g.index.array;
        for (let i = 0; i < a.length; i++) dst.push(base + a[i]);
      } else {
        for (let i = 0; i < p.count; i++) dst.push(base + i);
      }
      vertexCount += p.count;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aPiece', new THREE.Float32BufferAttribute(pieceAttr, 1));

  const indices = [];
  for (let m = 0; m < matOrder.length; m++) {
    const start = indices.length;
    const arr = matIndices[m];
    for (let i = 0; i < arr.length; i++) indices.push(arr[i]);
    geo.addGroup(start, arr.length, m);
  }
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();

  const mesh = new THREE.Mesh(geo, matOrder);
  mesh.name = 'debris';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });

  return { mesh, materials: matOrder, pieces: ids, pieceById: byId };
}

const PIECE_LOOKUP = /* glsl */ `
  vec3 piecePos = texture2D(uPieces, pieceUV(0.0)).xyz;
  vec4 pieceQuat = texture2D(uPieces, pieceUV(1.0));
`;

export function patchMaterial(mat, uniforms) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPieces = uniforms.uPieces;
    shader.uniforms.uPieceCount = uniforms.uPieceCount;
    shader.vertexShader = `
      uniform sampler2D uPieces;
      uniform float uPieceCount;
      attribute float aPiece;
      vec3 qrot(vec4 q, vec3 v) {
        return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
      }
      vec2 pieceUV(float k) {
        return vec2((aPiece * 2.0 + k + 0.5) / (uPieceCount * 2.0), 0.5);
      }
    ` + shader.vertexShader;

    // Declare the per-piece transform once, at the top of main().  The depth /
    // shadow shader only contains <beginnormal_vertex> inside
    // `#ifdef USE_DISPLACEMENTMAP`; anchoring the lookup there leaves it out of
    // the compiled program (no displacement map), so `transformed` would use
    // undeclared `pieceQuat` / `piecePos`.  Shaders without `void main() {`
    // fall back to declaring the lookup at the replacement sites.
    const atMain = shader.vertexShader.includes('void main() {');
    if (atMain) {
      shader.vertexShader = shader.vertexShader.replace(
        'void main() {',
        `void main() {\n${PIECE_LOOKUP}`,
      );
    }
    const lookup = atMain ? '' : PIECE_LOOKUP;

    if (shader.vertexShader.includes('#include <beginnormal_vertex>')) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        `${lookup}\n vec3 objectNormal = qrot(pieceQuat, normal);`,
      );
    }
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `${lookup}\n vec3 transformed = qrot(pieceQuat, position) + piecePos;`,
    );
  };
  // distinct program per material, but keep depth in sync
  mat.customProgramCacheKey = () => 'debris-pieces';
  mat.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// water
// ---------------------------------------------------------------------------

function makeWater(cfg) {
  const [w, h] = cfg.extent ?? [200, 200];
  const geo = new THREE.PlaneGeometry(w, h, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uSun: { value: new THREE.Vector3(0.45, 0.75, 0.3).normalize() },
      uDeep: { value: srgb('#123c48') },
      uShallow: { value: srgb('#2d7d86') },
      uSky: { value: srgb('#a9cfe0') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSun, uDeep, uShallow, uSky;
      varying vec3 vWorld;
      float wave(vec2 p, float t) {
        return sin(p.x * 0.34 + t * 1.15) * 0.5
             + sin(p.y * 0.27 - t * 0.92) * 0.5
             + sin((p.x + p.y) * 0.13 + t * 0.55) * 0.7;
      }
      vec3 normalAt(vec2 p, float t) {
        float e = 0.7;
        float dx = (wave(p + vec2(e, 0.0), t) - wave(p - vec2(e, 0.0), t)) / (2.0 * e);
        float dz = (wave(p + vec2(0.0, e), t) - wave(p - vec2(0.0, e), t)) / (2.0 * e);
        return normalize(vec3(-dx * 0.22, 1.0, -dz * 0.22));
      }
      void main() {
        vec3 n = normalAt(vWorld.xz, uTime);
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
        vec3 col = mix(uDeep, uShallow, clamp(0.45 + 0.35 * n.y, 0.0, 1.0));
        col = mix(col, uSky, fres * 0.75);
        vec3 H = normalize(uSun + V);
        float spec = pow(max(dot(n, H), 0.0), 140.0);
        col += vec3(1.0, 0.94, 0.82) * spec * 1.6;
        float d = length(cameraPosition - vWorld);
        float a = mix(0.86, 0.62, fres) * (1.0 - smoothstep(40.0, 260.0, d));
        gl_FragColor = vec4(col, a);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = cfg.level;
  mesh.renderOrder = 3;
  return mesh;
}

function makeBed(cfg) {
  const [w, h] = cfg.extent ? [cfg.extent * 2, cfg.extent * 2] : [400, 400];
  const geo = new THREE.PlaneGeometry(w, h, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: srgb('#1a1a16'), roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = cfg.level;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// splash rings
// ---------------------------------------------------------------------------

function makeSplashRings(sim) {
  const splashes = sim.splashes;
  if (!splashes?.length) return null;
  const fps = sim.fps ?? 30;
  const base = new THREE.PlaneGeometry(1, 1);
  base.rotateX(-Math.PI / 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.attributes.position = base.attributes.position;
  geo.attributes.uv = base.attributes.uv;
  const n = splashes.length;
  const center = new Float32Array(n * 3);
  const spawn = new Float32Array(n);
  const strength = new Float32Array(n);
  const radius = new Float32Array(n);
  splashes.forEach((s, i) => {
    center[i * 3] = s.position[0];
    center[i * 3 + 1] = s.position[1] + 0.03;
    center[i * 3 + 2] = s.position[2];
    spawn[i] = s.frame / fps;
    strength[i] = s.strength;
    radius[i] = s.radius;
  });
  geo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(center, 3));
  geo.setAttribute('aSpawn', new THREE.InstancedBufferAttribute(spawn, 1));
  geo.setAttribute('aStrength', new THREE.InstancedBufferAttribute(strength, 1));
  geo.setAttribute('aRadius', new THREE.InstancedBufferAttribute(radius, 1));
  geo.instanceCount = n;

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uFps: { value: fps } },
    vertexShader: /* glsl */ `
      attribute vec3 aCenter;
      attribute float aSpawn, aStrength, aRadius;
      uniform float uTime;
      varying vec2 vUv;
      varying float vFade;
      void main() {
        float life = 1.5;
        float t = uTime - aSpawn;
        float k = clamp(t / life, 0.0, 1.0);
        float s = (0.5 + k * 3.4) * aRadius * (0.6 + aStrength);
        vFade = (t < 0.0 || t > life) ? 0.0 : pow(1.0 - k, 1.4);
        vUv = uv;
        vec3 p = aCenter + vec3(position.x, 0.0, position.z) * s;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying float vFade;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float band = smoothstep(0.55, 0.78, r) * (1.0 - smoothstep(0.9, 1.0, r));
        float foam = smoothstep(0.35, 0.95, r) * 0.35;
        float a = (band + foam) * vFade * 0.85;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vec3(0.92, 0.97, 1.0), a);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return mesh;
}

// ---------------------------------------------------------------------------
// dust / chips / droplets
// ---------------------------------------------------------------------------

function makeParticles(sim) {
  const pos = [];
  const vel = [];
  const spawn = [];
  const life = [];
  const size = [];
  const color = [];
  const grow = [];
  const rng = mulberry32(sim.seed ?? 7);
  const push = (p, v, t, l, s, c, g) => {
    pos.push(p[0], p[1], p[2]);
    vel.push(v[0], v[1], v[2]);
    spawn.push(t);
    life.push(l);
    size.push(s);
    color.push(c[0], c[1], c[2]);
    grow.push(g);
  };

  for (const d of sim.dust ?? []) {
    const t = d.frame / sim.fps;
    for (let i = 0; i < d.count; i++) {
      const dir = [rng() * 2 - 1, rng() * 0.8, rng() * 2 - 1];
      const l = Math.hypot(...dir) || 1;
      const sp = 1.6 + rng() * 4.2;
      const p = [
        d.position[0] + (rng() - 0.5) * d.radius * 0.5,
        d.position[1] + (rng() - 0.4) * d.radius * 0.4,
        d.position[2] + (rng() - 0.5) * d.radius * 0.5,
      ];
      // one scalar per puff: per-channel variation would tint the smoke
      const bright = 0.82 + rng() * 0.3;
      push(p, [(dir[0] / l) * sp, Math.abs(dir[1] / l) * sp * 0.62 + 0.9, (dir[2] / l) * sp],
        t + rng() * 0.18, d.life * (0.7 + rng() * 0.6), 0.45 + rng() * 0.85,
        [d.color[0] * bright, d.color[1] * bright, d.color[2] * bright],
        0.5 + rng() * 0.45);
    }
  }

  for (const c of sim.chips ?? []) {
    const t = c.frame / sim.fps;
    push(c.position, c.velocity, t, c.life, c.size, c.color ?? [0.55, 0.52, 0.47], 0);
  }

  for (const s of sim.splashes ?? []) {
    const t = s.frame / sim.fps;
    const count = 8 + Math.round(s.strength * 8);
    for (let i = 0; i < count; i++) {
      const a = rng() * TAU;
      const r = 0.25 + rng() * 0.75;
      const up = 1.6 + rng() * 3.6 * s.strength;
      push(
        [s.position[0] + Math.cos(a) * s.radius * r * 0.5, s.position[1], s.position[2] + Math.sin(a) * s.radius * r * 0.5],
        [Math.cos(a) * (0.5 + rng() * 1.8) * s.strength, up, Math.sin(a) * (0.5 + rng() * 1.8) * s.strength],
        t, 0.6 + rng() * 0.7, 0.05 + rng() * 0.1, [0.85, 0.93, 1.0], 0,
      );
    }
  }

  if (!pos.length) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aVel', new THREE.Float32BufferAttribute(vel, 3));
  geo.setAttribute('aSpawn', new THREE.Float32BufferAttribute(spawn, 1));
  geo.setAttribute('aLife', new THREE.Float32BufferAttribute(life, 1));
  geo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
  geo.setAttribute('aTint', new THREE.Float32BufferAttribute(color, 3));
  geo.setAttribute('aGrow', new THREE.Float32BufferAttribute(grow, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uScale: { value: 700 } },
    vertexShader: /* glsl */ `
      attribute vec3 aVel;
      attribute vec3 aTint;
      attribute float aSpawn;
      attribute float aLife;
      attribute float aSize;
      attribute float aGrow;
      uniform float uTime, uScale;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float t = uTime - aSpawn;
        if (t < 0.0 || t > aLife) {
          gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
          gl_PointSize = 0.0;
          return;
        }
        vec3 p = position + aVel * t + vec3(0.0, -4.905 * t * t, 0.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float s = aSize * (1.0 + aGrow * t);
        gl_PointSize = clamp(s * uScale / max(0.5, -mv.z), 1.0, 180.0);
        float k = t / aLife;
        vAlpha = smoothstep(0.0, 0.12, k) * pow(1.0 - k, 1.6);
        vColor = aTint;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = dot(d, d);
        if (r > 0.25) discard;
        float a = (1.0 - smoothstep(0.02, 0.25, r)) * vAlpha;
        gl_FragColor = vec4(vColor, a);
      }
    `,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  return { points, material: mat };
}

// ---------------------------------------------------------------------------
// blast flashes
// ---------------------------------------------------------------------------

function makeFlashes(sim) {
  const list = (sim.explosions ?? []).filter((e) => e.visible);
  const fps = sim.fps ?? 30;
  if (!list.length) return null;
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.attributes.position = base.attributes.position;
  geo.attributes.uv = base.attributes.uv;
  const n = list.length;
  const center = new Float32Array(n * 3);
  const spawn = new Float32Array(n);
  const radius = new Float32Array(n);
  const implode = new Float32Array(n);
  list.forEach((e, i) => {
    center[i * 3] = e.position[0];
    center[i * 3 + 1] = e.position[1];
    center[i * 3 + 2] = e.position[2];
    spawn[i] = e.frame / fps;
    radius[i] = e.radius;
    implode[i] = e.kind === 'implode' ? 1 : 0;
  });
  geo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(center, 3));
  geo.setAttribute('aSpawn', new THREE.InstancedBufferAttribute(spawn, 1));
  geo.setAttribute('aRadius', new THREE.InstancedBufferAttribute(radius, 1));
  geo.setAttribute('aImplode', new THREE.InstancedBufferAttribute(implode, 1));
  geo.instanceCount = n;

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aCenter;
      attribute float aSpawn, aRadius, aImplode;
      uniform float uTime;
      varying vec2 vUv;
      varying float vFade;
      void main() {
        float life = aImplode > 0.5 ? 0.55 : 0.8;
        float t = uTime - aSpawn;
        float k = clamp(t / life, 0.0, 1.0);
        float s = aImplode > 0.5
          ? aRadius * (1.0 - k) * 0.9
          : aRadius * (0.25 + k * 1.25);
        vFade = (t < 0.0 || t > life) ? 0.0 : pow(1.0 - k, 2.0);
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
        mv.xy += position.xy * s;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying float vFade;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float core = 1.0 - smoothstep(0.0, 0.65, r);
        vec3 col = mix(vec3(1.0, 0.42, 0.08), vec3(1.0, 0.95, 0.8), core);
        gl_FragColor = vec4(col, core * vFade * 0.9);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  return mesh;
}

// ---------------------------------------------------------------------------
// bullet decals
// ---------------------------------------------------------------------------

function makeDecals(decals, pieceById) {
  if (!decals?.length) return null;
  const tex = impactTexture();
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, decals.length);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  const items = [];
  const Z = new THREE.Vector3(0, 0, 1);
  const ONE = new THREE.Vector3(1, 1, 1);
  for (const d of decals) {
    const n = new THREE.Vector3(...(d.localNormal ?? [0, 1, 0])).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(Z, n);
    const p = new THREE.Vector3(...d.local).addScaledVector(n, 0.008);
    const s = d.size ?? 0.16;
    const local = new THREE.Matrix4().compose(p, q, new THREE.Vector3(s, s, 1));
    items.push({ ...d, local });
  }
  // place once so nothing flashes at the origin before the first update
  const I = new THREE.Matrix4();
  for (let i = 0; i < decals.length; i++) mesh.setMatrixAt(i, I);
  return { mesh, items };
}

function impactTexture() {
  if (typeof document === 'undefined') {
    const data = new Uint8Array([255, 255, 255, 255]);
    const t = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    t.needsUpdate = true;
    return t;
  }
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.clearRect(0, 0, s, s);
  const cx = s / 2;
  // scorch
  const grd = g.createRadialGradient(cx, cx, 4, cx, cx, s * 0.46);
  grd.addColorStop(0, 'rgba(8,6,4,0.96)');
  grd.addColorStop(0.18, 'rgba(22,16,11,0.88)');
  grd.addColorStop(0.45, 'rgba(48,36,26,0.42)');
  grd.addColorStop(1, 'rgba(40,32,26,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  // cracks
  g.strokeStyle = 'rgba(14,10,8,0.75)';
  g.lineCap = 'round';
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + rnd() * 0.4;
    let r = s * 0.1;
    let x = cx, y = cx;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      r += s * (0.03 + rnd() * 0.06);
      x = cx + Math.cos(a + (rnd() - 0.5) * 0.35) * r;
      y = cx + Math.sin(a + (rnd() - 0.5) * 0.35) * r;
      g.lineTo(x, y);
    }
    g.lineWidth = 1 + rnd() * 2.4;
    g.stroke();
  }
  // dust rim
  g.strokeStyle = 'rgba(190,180,168,0.35)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(cx, cx, s * 0.2, 0, TAU);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Frame the camera on the scene bounds. */
export function frameCamera(camera, sim, opts = {}) {
  const b = sim.bounds;
  const center = new THREE.Vector3(
    (b.lo[0] + b.hi[0]) / 2,
    (b.lo[1] + b.hi[1]) / 2,
    (b.lo[2] + b.hi[2]) / 2,
  );
  const radius = 0.5 * Math.hypot(b.size[0], b.size[1], b.size[2]);
  const dist = radius * (opts.zoom ?? 1.35);
  const dir = new THREE.Vector3(opts.dir?.[0] ?? 0.75, opts.dir?.[1] ?? 0.42, opts.dir?.[2] ?? 0.85).normalize();
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.lookAt(center);
  camera.near = Math.max(0.1, radius * 0.005);
  camera.far = dist * 8 + radius * 4;
  camera.updateProjectionMatrix();
  return { center, radius };
}
