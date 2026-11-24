# AR/VR Environment from a 2D Floor Plan

Draft a **detailed, textured 3D environment** from a flat 2D floor-plan image and export it as a
single **GLB** (plus glTF + a JSON manifest + a working three.js viewer). Runs headless on Kaggle
with **no required input** — if there is no floor plan under `/kaggle/input`, it builds a synthetic
apartment plan so the whole notebook finishes.

## What it does

1. **Parse the plan** → room polygons + a wall network. Door gaps stay as real openings.
2. **Extrude geometry**: per-room floor slabs, walls to 2.8 m, baseboards, rugs and ceiling lights.
3. **Apply procedural textures** (wood, carpet, tile, plaster, fabric) with world-scale planar UVs —
   no external assets, written to `textures/*.png`.
4. **Place multi-part furniture** (a sofa is a base + back + arms + cushions + legs, not a box) with a
   deterministic settle + non-overlap solver.
5. **Export** `scene_*.glb` (PBR materials, embedded textures) + `scene_*.json` manifest + a
   three.js ESM viewer that actually loads the GLB.

## Files

- `ar_vr_environment_kaggle.ipynb` — the notebook. Start here.
- `ATLAS3D_INTEGRATION_ANALYSIS.md`, `ATLAS3D_COMPARISON.md`, `atlas3d_integration_example.py` —
  notes and an example on physically-constrained 3D generation (Atlas3D).
- `THREE_JS_REMOTION_EXPORT_GUIDE.md`, `three_js_remotion_example.py`,
  `three_js_remotion_exporter.py` — notes and helpers on exporting 3D scenes for three.js / Remotion.

## Run it

On Kaggle: open the notebook, attach a floor-plan image dataset (or let it build the synthetic
sample), then **Run All**. Outputs are written to `/kaggle/working/outputs/`.

Locally:

```bash
pip install trimesh shapely mapbox-earcut opencv-python-headless pillow matplotlib pandas
jupyter notebook ar_vr_environment_kaggle.ipynb
```

## Output

- `3d/scene_1.glb` — single-file binary glTF, PBR materials, embedded textures
- `3d/scene_1.json` — rooms, furniture, interaction points, lighting
- `textures/*.png` — the procedural textures used
- `web/viewer_1.html` — three.js viewer (serve it next to the matching `.glb`)

## Notes / limitations

- Geometry is drafted from the plan's ink; add a depth/segmentation model in the parse step to go further.
- Placement is a small deterministic constraint solver (grounding + overlap separation), not a full
  rigid-body simulator.
- Textures are procedural; swap `textures/` for scanned materials for more realism.
