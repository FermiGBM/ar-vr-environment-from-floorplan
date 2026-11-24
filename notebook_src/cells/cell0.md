# 🏗️ Scenario 3 — Explorable 3D World from a 2D Image · Kaggle edition

Turn a flat 2D image into a **walkable 3D world** exported as a single **GLB**, plus a JSON manifest,
a looping trailing-camera path for Remotion, and a three.js viewer with **Walk / Orbit / Cinematic**
modes (and a WebXR VR button). Runs headless on Kaggle with **no required input** — with no image it
builds a synthetic floor plan so the whole notebook finishes.

Two input paths, chosen automatically by looking at the image (or force one with `MODE`):

| Input looks like… | Path | Result |
|---|---|---|
| **A floor plan** — dark linework on a light background | **Plan** | discrete **rooms** + walls + door gaps + furniture |
| **Any other photo** — a room, a street, anything | **Photo** | a **room shell** (floor, walls, ceiling), the image as a depth-displaced backdrop and floor/ceiling bands, image-derived props, and a walkable nav grid |

**Plan path — how the detail is made**
1. Parse the plan → room polygons + a wall network (door gaps stay as real openings).
2. Extrude real geometry: per-room floor slabs, walls to height, **baseboards**, rugs, ceiling lights.
3. Apply **procedural textures** (wood, carpet, tile, plaster, fabric) with world-scale planar UVs.
4. Place **multi-part furniture** (a sofa is a base + back + arms + cushions + legs, not a box) with a
   deterministic settle + non-overlap solver.

**Photo path — how the world is made**
1. Estimate monocular depth (Depth-Anything V2 small via `transformers`; a classical fallback if no model).
2. Infer a room from the image: dimensions from the aspect/depth, floor/wall/ceiling tones sampled from the image.
3. Stand the image up as a **depth-displaced backdrop** on the far wall; continue it onto the floor and
   ceiling as thinner depth panels, so the source still reads from the spawn viewpoint while having real parallax.
4. Detect near blobs in the image → choose and place **multi-part props** with the same solver as the plan path.
5. Export a rasterised **navigation grid**, spawn point, zones, and a **subject + trailing-camera path**.

Both paths export one **GLB** with correct PBR materials/UVs, `scene_*.json` (spawn, zones, nav grid,
camera paths), `camera_path_*.json` (Remotion-ready), and `web/viewer_*.html`.

**Input:** drop your image into a Kaggle Dataset (it appears under `/kaggle/input/...`), or set `IMAGE_PATH`.
No image at all? It builds a synthetic floor plan so the whole notebook runs end-to-end.
**Output:** everything is written to `/kaggle/working/outputs/` (Kaggle collects `/kaggle/working` automatically).

> The photo path downloads a depth model from Hugging Face, so enable **Internet** in the Kaggle run
> settings; without it, the notebook falls back to a classical pseudo-depth and still builds a world.

> Coordinates in the GLB and manifests are **trimesh Z-up**. The viewer and the Remotion helper convert with
> `(x, y, z) → (x, z, -y)` (a −90° rotation about X) to get three.js Y-up.
