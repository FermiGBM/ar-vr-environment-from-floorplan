# 3D Environment from a 2D Image

Turn a flat 2D image into a **detailed, textured 3D environment** exported as a single **GLB** (plus
glTF + a JSON manifest + a three.js viewer). Runs headless on Kaggle with **no required input** — with
no image it builds a synthetic floor plan so the whole notebook finishes.

Two input paths, chosen automatically by looking at the image (or force one with `MODE`):

| Input looks like… | Path | Result |
|---|---|---|
| **A floor plan** — dark linework on a light background | **Plan** | discrete **rooms** + walls + door gaps + furniture |
| **Any other photo** — a room, a street, anything | **Photo** | a depth **relief mesh** textured with the image |

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
2. Build a textured relief mesh from the depth and drape the source image over it.

Both paths export one **GLB** with correct PBR materials/UVs + a JSON manifest + a three.js viewer.

## Files

- `ar_vr_environment_kaggle.ipynb` — the notebook. Start here.
- `ATLAS3D_INTEGRATION_ANALYSIS.md`, `ATLAS3D_COMPARISON.md`, `atlas3d_integration_example.py` —
  notes and an example on physically-constrained 3D generation (Atlas3D).
- `THREE_JS_REMOTION_EXPORT_GUIDE.md`, `three_js_remotion_example.py`,
  `three_js_remotion_exporter.py` — notes and helpers on exporting 3D scenes for three.js / Remotion.

## Run it

On Kaggle: open the notebook, attach an image dataset (or let it build the synthetic sample), then
**Run All**. Outputs are written to `/kaggle/working/outputs/`.

To use your own image, either drop it into a Kaggle Dataset (it appears under `/kaggle/input/...`) or
set `IMAGE_PATH` in cell 2. `MODE` is `"auto"` (detect), `"plan"`, or `"photo"`.

> The photo path downloads a depth model from Hugging Face, so enable **Internet** in the Kaggle run
> settings to get real depth; without it (or without torch) it falls back to a pseudo-depth and still
> finishes.

Locally:

```bash
pip install trimesh shapely mapbox-earcut opencv-python-headless pillow matplotlib pandas
# optional, for real depth in the photo path:
pip install torch transformers
jupyter notebook ar_vr_environment_kaggle.ipynb
```

## Output

- `3d/scene_1.glb` — single-file binary glTF, PBR materials, embedded textures
- `3d/scene_1.json` — manifest: `kind` (plan/photo), rooms, furniture, interaction points, lighting
- `textures/*.png` — the procedural textures (plan path)
- `web/viewer_1.html` — three.js viewer (serve it next to the matching `.glb`)

## Notes / limitations

- The plan path drafts geometry from the plan's ink; a perspective phone photo of a plan wants a
  "make it top-down" step first. Add a segmentation model in the parse step to go further.
- The photo path produces a relief surface, not discrete rooms — that is the nature of single-image
  depth. A stronger depth model or multi-view input raises quality.
- Placement is a small deterministic constraint solver (grounding + overlap separation), not a full
  rigid-body simulator.
