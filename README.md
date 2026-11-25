# Explorable 3D World from a 2D Image

**Live demo (jail-block reconstruction, three material treatments):**
https://fermigbm.github.io/ar-vr-environment-from-floorplan/

Turn a flat 2D image into a **walkable 3D world**, exported as one **GLB** plus a JSON manifest, a
looping **trailing-camera path** for Remotion, and a three.js viewer with **Walk / Orbit / Cinematic**
modes and a WebXR VR button. Runs headless on Kaggle with **no required input** — with no image it
builds a synthetic floor plan so the whole notebook finishes.

Two input paths, chosen automatically by looking at the image (or force one with `MODE`):

| Input looks like… | Path | Result |
|---|---|---|
| **A floor plan** — dark linework on a light background | **Plan** | discrete **rooms** + walls + door gaps + furniture |
| **Any other photo** — a room, a street, anything | **Photo** | a **walkable room shell** (floor, walls, ceiling), the image as a depth-displaced backdrop + floor/ceiling bands, image-derived props, and a nav grid |

## What it does

**Plan path**
1. Parse the plan → room polygons + a wall network. Door gaps stay as real openings.
2. Extrude geometry: per-room floor slabs, walls to 2.8 m, baseboards, rugs, ceiling lights.
3. Apply procedural textures (wood, carpet, tile, plaster, fabric) with world-scale planar UVs.
4. Place multi-part furniture (a sofa is a base + back + arms + cushions + legs, not a box) with a
   deterministic settle + non-overlap solver.

**Photo path**
1. Estimate monocular depth — **Depth-Anything V2 (small)** via `transformers`; a classical
   pseudo-depth fallback if there is no torch / no internet.
2. Infer a room from image aspect + depth; sample floor/wall/ceiling colours from the image bands.
3. Stand the image up as a **depth-displaced backdrop** on the far wall and continue it onto the
   floor and ceiling as thinner depth panels, so it reads like the source from spawn but has parallax.
4. Detect near blobs → choose and place multi-part props with the same solver as the plan path.

Both paths export one **GLB** with correct PBR materials/UVs, a manifest with **spawn, zones, nav
grid and camera paths**, a Remotion-ready `camera_path_*.json`, and the viewer.

## Files

- `ar_vr_environment_kaggle.ipynb` — the notebook. Start here.
- `THREE_JS_REMOTION_EXPORT_GUIDE.md`, `remotion_trailing_camera.tsx`, `three_js_remotion_example.py`,
  `three_js_remotion_exporter.py` — notes and helpers for three.js / Remotion, including a deterministic
  trailing-camera component that consumes `camera_path_1.json`.
- `ATLAS3D_INTEGRATION_ANALYSIS.md`, `ATLAS3D_COMPARISON.md`, `atlas3d_integration_example.py` —
  notes and an example on physically-constrained 3D generation (Atlas3D).

## Run it

On Kaggle: open the notebook, attach an image dataset (or let it build the synthetic sample), then
**Run All**. Outputs are written to `/kaggle/working/outputs/`.

To use your own image, drop it into a Kaggle Dataset (it appears under `/kaggle/input/...`) or set
`IMAGE_PATH` in cell 2. `MODE` is `"auto"` (detect), `"plan"`, or `"photo"`.

> The photo path downloads a depth model from Hugging Face, so enable **Internet** in the Kaggle run
> settings to get real depth; without it (or without torch) it falls back to a pseudo-depth and still
> builds a world.

Locally:

```bash
pip install trimesh shapely mapbox-earcut opencv-python-headless pillow matplotlib pandas
# optional, for real depth in the photo path:
pip install torch transformers
jupyter notebook ar_vr_environment_kaggle.ipynb
```

## Output

- `3d/scene_1.glb` — single-file binary glTF, PBR materials, embedded textures
- `3d/scene_1.json` — manifest: `kind`, rooms/zones, furniture, spawn, nav grid, interaction points,
  lighting, physics, camera settings
- `3d/camera_path_1.json` — looping `subject_path` + `camera_path` keyframes (fps 30, 360 frames)
- `3d/gltf/` — JSON glTF + external buffers (interchange)
- `textures/*.png` — the procedural textures (plan path)
- `visualizations/*.png` — plan + 3D previews (photo path: source + depth)
- `web/viewer_1.html` — walkable three.js viewer; serve `outputs/` over HTTP and open it

Viewer controls: **1** walk (click to lock mouse, WASD, Shift run, Space jump, Esc release),
**2** orbit (drag / wheel / right-drag), **3** cinematic trailing camera, plus a WebXR button.

Coordinates in the GLB and JSON are **trimesh Z-up**; convert to three.js with
`(x, y, z) → (x, z, -y)` (a −90° rotation about X). The viewer and the Remotion helper do this.

## Look presets (jail cell reconstruction)

`jail_cell_builder.py` can emit the same layout in three material treatments:

| `--look` | Walls / floors / ceiling | Props (bars, gate, bed, pipes) | GLB |
|---|---|---|---|
| `cartoon` | flat procedural palette, no maps | flat palette | ~3 MB |
| `hybrid` | original palette albedo + generated normal / roughness / AO from the block & tile relief | full CC0 PBR | ~2.3 MB |
| `photoreal` | full Poly Haven CC0 PBR, recoloured to the frame palette (`--tint palette`) or untouched (`--tint natural`) | full CC0 PBR | ~4 MB |

Published names on the demo site: `hybrid` → **Material Upgrade**, `photoreal` →
**Wall Material Replacement (Rough Stone)**, `cartoon` → **Original 2d to 3d Assimilation**.

```bash
python fetch_pbr.py                     # once: 7 CC0 sets into ~/arvr-test/pbr
python jail_cell_builder.py --views ~/prison_views/shots --out ~/jail_world_hybrid \
    --pbr ~/arvr-test/pbr --look hybrid
```

`polish_glb` is the GLB post-step: it re-encodes embedded maps as JPEG and writes real
vertex normals, which trimesh omits whenever a texture visual is attached. Boxes are built
with split per-face vertices, so normals stay hard-edged while cylinders stay smooth.

## Notes / limitations

- The plan path drafts geometry from the plan's ink; a perspective phone photo of a plan wants a
  "make it top-down" step first. Add a segmentation model in the parse step to go further.
- The photo path invents the room shell and prop types from image heuristics; a single view cannot
  reveal what is behind the camera. A stronger depth model / segmentation or multi-view input helps.
- Navigation uses a rasterised grid + prop footprints, not a full physics engine; the camera is
  eye-height with simple gravity and sliding collision.
- Camera paths are deterministic Catmull–Rom loops, so Remotion can render frames in any order.
