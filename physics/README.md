# Destruction physics

Bakes a scripted demolition shot — gunshots, charges, implosion, debris and water —
into **plain baked data** that Three.js and Remotion can replay frame-exactly.

The point of baking rather than simulating live: Remotion renders frames out of
order and in parallel, so a physics engine running at render time would produce a
different film depending on how many workers you have. Rapier runs once, here, and
everything downstream is a lookup.

```
GLB asset ──► fracture ──► weld graph ──► Rapier bake ──► debris.glb + sim.json + motion.bin
                                                              │
                                            ┌─────────────────┴──────────────────┐
                                        browser preview                  Remotion render
```

## Quick start

```bash
cd physics
npm install

# build the procedural demo bridge + its two shot specs
node src/make_demo_bridge.mjs

# bake it (≈2 s) -> out/bridge/{debris.glb,sim.json,motion.bin,shot.json}
node src/bake.mjs --shot examples/bridge/shot.json --out out/bridge

# numbers instead of pictures
node tools/simstats.mjs out/bridge

# look at it
npm run serve      # then open http://127.0.0.1:8123/preview/?shot=../out/bridge/
```

The preview understands a few query parameters:

| parameter | meaning |
| --- | --- |
| `?shot=../out/bridge/` | folder holding `debris.glb` + `sim.json` |
| `&frame=120` | jump to a frame and pause (handy for screenshots) |
| `&hide=particles,rings,water` | isolate a layer while tuning |

## Writing a shot

A shot is JSON. Everything the simulator needs is in it, so a bake is
reproducible from the file alone (plus the GLB it names).

```jsonc
{
  "asset": "bridge.glb",
  "up": "y",                     // source model up-axis
  "fps": 30,
  "duration": 9,
  "seed": 20261126,
  "fracture": { "pieces": 300, "density": 2400, "siteShare": 0.6 },
  "joints": { "gap": 0.06, "breakDistance": 0.2, "breakSpeed": 6, "anchor": true },
  "targets": [                   // piece budget per class of mesh
    { "name": "deck", "match": "deck|asphalt|girder|brace", "pieces": 150 },
    { "name": "piers", "match": "pier|abutment", "pieces": 60 }
  ],
  "shots": [                     // gunfire: ray-cast wear decals + chips
    { "time": 0.12, "from": [-20, 3.2, 11], "to": [-9, 3.4, 3.55], "size": 0.1, "chips": 5 }
  ],
  "charges": [                   // explosives
    {
      "name": "cut-pier-a",
      "time": 0.5,
      "position": [-18, -1, 0],
      "radius": 9,
      "power": 2.0,
      "visible": true,           // false = invisible blast, damage only
      "implode": false,          // true = debris is sucked inward
      "release": { "lo": [-31, -1.45, -5.5], "hi": [31, 6, 5.5] }
    }
  ],
  "water": { "level": -7, "extent": [220, 220], "buoyancy": 1.5, "drag": 2.2 },
  "ground": { "level": -12.5, "extent": 240 },
  "killY": -40
}
```

`release` is the important one: it is the region that *loses its welds* when the
charge fires. Anything inside it becomes dynamic; joints crossing its boundary
are cut. Piers and abutments stay outside, so a bridge drops onto its own
foundations instead of evaporating.

Two specs ship with the demo:

* `examples/bridge/shot.json` — controlled demolition, visible blasts, gunfire.
* `examples/bridge/shot-implode.json` — one invisible imploding charge.

## What the bake produces

| file | contents |
| --- | --- |
| `debris.glb` | every Voronoi piece as a node `piece_000…`, original UVs/normals kept, two materials per source material: the surface and a `…__break` cut face |
| `sim.json` | bounds, materials, per-piece metadata (mass, volume, release frame, motion offset), plus decals / splashes / chips / dust / blast events |
| `motion.bin` | one `Float32Array` of `[x y z qx qy qz qw]` per frame per piece — the reason `sim.json` stays well under 100 kB |
| `shot.json` | the resolved shot (defaults filled in, seed, statistics) that produced the above |

### Why the debris keeps its material

Fractured geometry gets new surface from the *inside* of the solid, which has no
UVs. Rather than leaving cut faces untextured, each source material is paired
with a `__break` material carrying the same average albedo (decoded from the
base-colour texture) at roughness 0.96 and metallic 0. The caps also get planar
metre-scaled UVs, so a tiled texture would still line up.

## Using your own model

```bash
cp your_model.glb examples/mything/
$EDITOR examples/mything/shot.json      # set "asset", targets, charges, water
node src/bake.mjs --shot examples/mything/shot.json --out out/mything
npm run serve                            # ?shot=../out/mything/
```

Notes that save time:

* Axis: the reader assumes Y-up by default; pass `"up": "z"` for Blender/Z-up exports.
* Names matter: `targets[].match` is a regex over node names; unmatched meshes get a share of the global budget.
* Piece budget scales with bounding-box volume, so a long deck gets more pieces than a railing.
* Water is detected by node name (`water|ocean|sea|river|lake`) and replaced with an analytic surface — see below.
* A bake of a few hundred pieces takes seconds. If it is slow, the source has a lot of triangles: fracture cost is O(seeds × triangles).

## How the simulation works

1. **Fracture** (`src/fracture.mjs`) — Voronoi cells clipped against the mesh,
   with interior seeds placed by ray-probing the solid's thickness. Cut faces
   keep normals and get planar UVs. Volume is preserved to within 0.01 %.
2. **Welding** (`weldSet` in `src/bake.mjs`) — pieces that touch within `joints.gap`
   are linked. Only a *spanning forest* plus a few redundant edges is kept:
   fixed joints are rigid constraints, and a graph full of loops is
   over-constrained and blows up.
3. **Bake** (`src/sim.mjs`) — pieces start `Fixed`. A charge cuts the joints it
   crosses, flips the region to `Dynamic`, and applies mass-scaled impulses plus
   seeded torque. Joints are created lazily (only once *both* ends are dynamic —
   a joint across a fixed→dynamic pair has infinite mass on one side and is what
   made the solver explode), and then broken by strain. Buoyancy and drag are
   applied as impulses when a piece is below the water line, splash events are
   emitted from the entry velocity, and pieces past `killY` are frozen.
4. **Everything is seeded** (`mulberry32`), so the same shot file gives the same
   film on any machine.

## The runtime

`src/debris.mjs` is framework-agnostic Three.js and drives both hosts:

```js
const fx = await loadDestruction({ glb: 'debris.glb', sim: 'sim.json' });
scene.add(fx.group);
fx.update(120);            // frame index at sim.fps — a pure function of the frame
```

All pieces are merged into one geometry per material with a per-vertex `aPiece`
attribute. The piece transform lives in a `DataTexture` patched into
`MeshStandardMaterial` (and the shadow depth material), so a 316-piece collapse
costs a handful of draw calls instead of 316 — which is what keeps it usable on a
phone. Water, splash rings, spray, dust, chips, blast flashes and bullet decals
are all derived from the baked event lists, so replay needs no state.

## Remotion

`remotion/src/` renders the same shot as video. The composition reads `sim.json`
in `calculateMetadata`, so its length and frame rate follow the bake; the frame
index is mapped through `useCurrentFrame()` into `fx.update()`.

```bash
node remotion/scripts/prepare.mjs          # copy out/bridge -> remotion/public/bridge
npx remotion studio                        # scrub it live
npx remotion render DestructionBridge out/bridge.mp4
npx remotion still DestructionBridge out/bridge.png --frame=90
```

Rendering needs a machine with more than ~2 GB of RAM (esbuild bundling plus a
headless browser); on a small laptop do the bake locally and the render on Cloud
Shell or CI.

## Tests

```bash
npm test          # fracture regression + end-to-end bake
npm run typecheck # the Remotion/TS side
```

`test/bake.test.mjs` rebuilds the demo, bakes it, and asserts the things a
renderer relies on: volume preserved through fracture, one `__break` material per
source material, finite transforms, the superstructure actually coming down,
water impacts landing on the water line, and gunshot decals existing.
