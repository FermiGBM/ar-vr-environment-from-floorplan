#!/usr/bin/env python3
"""Parametric cartoon jail cell + corridor, reconstructed from a handful of views.

The references are flat-shaded, low-poly renders, so photogrammetry is the wrong
tool.  The closest match is a *parametric* rebuild: teal ashlar block walls, red
brick piers, a double-leaf barred gate, orange plank ceilings with real 3D beams,
tiled floors with blue accent tiles, dark-blue baseboards, a wooden bed with a red
mattress, a three-legged stool, a bucket, scattered straw and warm caged lamps.

It reuses the notebook's export / nav / camera / viewer code by executing the code
cells of ar_vr_environment_kaggle.ipynb in a namespace, then swaps in this custom
scene and an L-shaped walk grid.

    python jail_cell_builder.py --views ~/prison_views/shots --out ~/jail_world
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np
import trimesh
import trimesh.transformations as tf
from PIL import Image
from trimesh.visual.material import PBRMaterial
from trimesh.visual.texture import TextureVisuals

REPO = Path(__file__).resolve().parent
NOTEBOOK = REPO / "ar_vr_environment_kaggle.ipynb"


def exec_cells(ns, indices):
    nb = json.loads(NOTEBOOK.read_text())
    for idx in indices:
        src = "".join(nb["cells"][idx]["source"])
        exec(compile(src, f"notebook:cell{idx}", "exec"), ns)


# --------------------------------------------------------------------------
# procedural textures  (palette sampled from the reference frames)
# --------------------------------------------------------------------------
def _j(arr, rng, amp):
    return np.clip(arr + rng.normal(0.0, amp, arr.shape), 0, 255)


def tex_teal_block(size=512, seed=21):
    """Big sage/teal ashlar blocks with dark grout and bevel edges."""
    rng = np.random.default_rng(seed)
    base = np.array([150, 178, 168], float)
    grout = np.array([92, 116, 110], float)
    arr = np.tile(grout, (size, size, 1))
    bw, bh = 256, 128                     # 2 cols x 4 rows of big blocks
    for row, y in enumerate(range(0, size, bh)):
        off = (bw // 2) if row % 2 else 0
        for x in range(-bw, size + bw, bw):
            x0, y0 = x + off + 4, y + 4
            x1, y1 = x + off + bw - 4, y + bh - 4
            ax0, ay0, ax1, ay1 = max(0, x0), max(0, y0), min(size, x1), min(size, y1)
            if ax1 <= ax0 or ay1 <= ay0:
                continue
            col = base + rng.normal(0, 6, 3)
            arr[ay0:ay1, ax0:ax1] = col
            arr[ay0:ay1, ax0:ax0 + 3] = col * 1.12        # top/left bevel highlight
            arr[ay0:ay0 + 3, ax0:ax1] = col * 1.10
            arr[ay1 - 3:ay1, ax0:ax1] = col * 0.80        # bottom/right shade
            arr[ay0:ay1, ax1 - 3:ax1] = col * 0.82
    return _j(arr, rng, 4).astype(np.uint8)


def tex_brick(size=512, seed=22):
    """Bright orange-red brick with light mortar."""
    rng = np.random.default_rng(seed)
    base = np.array([196, 76, 46], float)
    mortar = np.array([186, 178, 168], float)
    arr = np.tile(mortar, (size, size, 1))
    bw, bh = 128, 64
    for row, y in enumerate(range(0, size, bh)):
        off = (bw // 2) if row % 2 else 0
        for x in range(-bw, size + bw, bw):
            ax0, ay0 = max(0, x + off + 3), max(0, y + 3)
            ax1, ay1 = min(size, x + off + bw - 3), min(size, y + bh - 3)
            if ax1 <= ax0 or ay1 <= ay0:
                continue
            col = base + rng.normal(0, 12, 3)
            arr[ay0:ay1, ax0:ax1] = col
            arr[ay0:ay1, ax0:ax0 + 2] = col * 1.15
            arr[ay1 - 2:ay1, ax0:ax1] = col * 0.78
    return _j(arr, rng, 5).astype(np.uint8)


def tex_planks(size=512, seed=23):
    """Warm orange ceiling planks with dark grooves."""
    rng = np.random.default_rng(seed)
    base = np.array([178, 96, 42], float)
    arr = np.empty((size, size, 3), float)
    plank = 128
    for x0 in range(0, size, plank):
        col = base * (1.0 + rng.uniform(-0.12, 0.12))
        arr[:, x0:x0 + plank] = col
        g = np.sin(np.linspace(0, rng.uniform(4, 8) * math.pi, size))[:, None, None]
        arr[:, x0:x0 + plank] += g * 8.0
        arr[:, x0:x0 + 4] = col * 0.45                    # groove
        arr[:, x0 + 4:x0 + 7] = col * 1.18                # lit edge
    return _j(arr, rng, 4).astype(np.uint8)


def tex_tile_corridor(size=512, seed=24):
    """Pink-tan corridor tiles, a few blue accent tiles."""
    rng = np.random.default_rng(seed)
    grout = np.array([148, 112, 106], float)
    base = np.array([196, 156, 146], float)
    accent = np.array([74, 92, 152], float)
    arr = np.tile(grout, (size, size, 1))
    t = 128
    for y in range(0, size, t):
        for x in range(0, size, t):
            c = (accent if rng.random() < 0.09 else base) + rng.normal(0, 7, 3)
            arr[y + 4:y + t - 4, x + 4:x + t - 4] = c
            arr[y + 4:y + t - 4, x + 4:x + 9] = c * 1.08
    return _j(arr, rng, 3).astype(np.uint8)


def tex_tile_cell(size=512, seed=25):
    """Blue-teal cell tiles."""
    rng = np.random.default_rng(seed)
    grout = np.array([52, 92, 104], float)
    base = np.array([104, 158, 172], float)
    arr = np.tile(grout, (size, size, 1))
    t = 128
    for y in range(0, size, t):
        for x in range(0, size, t):
            c = base + rng.normal(0, 7, 3)
            arr[y + 4:y + t - 4, x + 4:x + t - 4] = c
            arr[y + 4:y + t - 4, x + 4:x + 9] = c * 1.10
    return _j(arr, rng, 3).astype(np.uint8)


def tex_plaster(size=512, seed=26):
    """Muted olive plaster for the far corridor wall."""
    rng = np.random.default_rng(seed)
    base = np.array([150, 150, 122], float)
    arr = np.tile(base, (size, size, 1))
    for _ in range(220):
        cx, cy = rng.integers(0, size, 2)
        r = rng.integers(8, 40)
        arr[max(0, cy - r):cy + r, max(0, cx - r):cx + r] *= (1.0 + rng.normal(0, 0.05))
    return _j(arr, rng, 5).astype(np.uint8)


def tex_fabric_red(size=256, seed=27):
    rng = np.random.default_rng(seed)
    base = np.array([172, 46, 54], float)
    arr = np.tile(base, (size, size, 1)) + rng.normal(0, 6, (size, size, 3))
    for y in range(0, size, 5):
        arr[y:y + 1, :] *= 0.90
    return np.clip(arr, 0, 255).astype(np.uint8)


def _img(arr):
    return Image.fromarray(np.asarray(arr, np.uint8), "RGB")


def pbr(name, arr=None, rgb=None, rough=0.92, metal=0.0, emissive=None):
    kw = dict(name=name, metallicFactor=float(metal), roughnessFactor=float(rough))
    if arr is not None:
        kw["baseColorTexture"] = _img(arr)
        kw["baseColorFactor"] = [1.0, 1.0, 1.0, 1.0]
    else:
        kw["baseColorFactor"] = [float(rgb[0]), float(rgb[1]), float(rgb[2]), 1.0]
    if emissive is not None:
        kw["emissiveFactor"] = [float(emissive[0]), float(emissive[1]), float(emissive[2])]
    return PBRMaterial(**kw)


# --------------------------------------------------------------------------
# primitives
# --------------------------------------------------------------------------
def box(center, extents, mat, name="box", uv_scale=None, uv_axes=(0, 1)):
    m = trimesh.creation.box(extents=[float(v) for v in extents])
    m.apply_translation([float(v) for v in center])
    if uv_scale:
        v = m.vertices
        uv = np.column_stack([v[:, uv_axes[0]] / uv_scale, v[:, uv_axes[1]] / uv_scale])
        m.visual = TextureVisuals(uv=uv, material=mat)
    else:
        m.visual = TextureVisuals(material=mat)
    m.metadata["name"] = name
    return m


def cyl(center, radius, height, mat, axis="z", sections=16, name="cyl"):
    m = trimesh.creation.cylinder(radius=float(radius), height=float(height), sections=sections)
    if axis == "x":
        m.apply_transform(tf.rotation_matrix(math.pi / 2, [0, 1, 0]))
    elif axis == "y":
        m.apply_transform(tf.rotation_matrix(math.pi / 2, [1, 0, 0]))
    m.apply_translation([float(v) for v in center])
    m.visual = TextureVisuals(material=mat)
    m.metadata["name"] = name
    return m


# --------------------------------------------------------------------------
# room dimensions  (metres, Z up)
# --------------------------------------------------------------------------
T = 0.14
COR = {"x0": -7.0, "x1": 7.0, "y0": 0.0, "y1": 2.4, "z": 3.0}
CELL = {"x0": 0.60, "x1": 3.40, "y0": -3.20, "y1": 0.0, "z": 2.90}
GATE = {"x0": 0.95, "x1": 3.05, "z0": 0.06, "z1": 2.30}
NICHE_A = (-6.20, -4.40)
NICHE_B = (4.40, 6.20)
BEAM_EVERY = 0.90


def build_scene(g, views_dir):
    (g["OUT"] / "textures").mkdir(parents=True, exist_ok=True)

    m_teal = pbr("teal", tex_teal_block())
    m_brick = pbr("brick", tex_brick())
    m_plank = pbr("plank", tex_planks())
    m_tile_cor = pbr("tile_cor", tex_tile_corridor())
    m_tile_cell = pbr("tile_cell", tex_tile_cell())
    m_plaster = pbr("plaster", tex_plaster())
    m_fabric = pbr("fabric", tex_fabric_red(), rough=0.98)
    m_metal = pbr("metal", rgb=(0.075, 0.075, 0.09), rough=0.5, metal=0.6)
    m_dark = pbr("dark", rgb=(0.03, 0.035, 0.045), rough=0.95)
    m_base = pbr("baseboard", rgb=(0.16, 0.30, 0.50), rough=0.7)
    m_wood = pbr("wood", rgb=(0.44, 0.25, 0.11), rough=0.8)
    m_beam = pbr("beam", rgb=(0.20, 0.10, 0.05), rough=0.9)
    m_straw = pbr("straw", rgb=(0.66, 0.52, 0.22), rough=0.98)
    m_door = pbr("door", rgb=(0.20, 0.24, 0.22), rough=0.75)
    m_pipe = pbr("pipe", rgb=(0.34, 0.28, 0.24), rough=0.6, metal=0.3)
    m_bulb = pbr("bulb", rgb=(1.0, 0.87, 0.6), rough=0.35, emissive=(1.0, 0.82, 0.5))

    meshes = []
    add = meshes.append

    # ---------------------------------------------------------------- corridor
    add(("floor", 0, box(((COR["x0"] + COR["x1"]) / 2, (COR["y0"] + COR["y1"]) / 2, -T / 2),
                         (COR["x1"] - COR["x0"], COR["y1"] - COR["y0"], T), m_tile_cor,
                         "cor_floor", uv_scale=1.6, uv_axes=(0, 1))))
    add(("ceiling", 0, box(((COR["x0"] + COR["x1"]) / 2, (COR["y0"] + COR["y1"]) / 2, COR["z"] + T / 2),
                           (COR["x1"] - COR["x0"], COR["y1"] - COR["y0"], T), m_plank,
                           "cor_ceiling", uv_scale=2.0, uv_axes=(0, 1))))
    # real beams spanning the corridor width
    x = COR["x0"] + 0.5
    while x < COR["x1"] - 0.3:
        add(("beam", 0, box((x, (COR["y0"] + COR["y1"]) / 2, COR["z"] - 0.07),
                            (0.16, COR["y1"] - COR["y0"] - 0.02, 0.16), m_beam, "beam")))
        x += BEAM_EVERY

    # far corridor wall (y = y1): plaster, with brick opposite the target cell
    add(("wall", 0, box(((COR["x0"] + COR["x1"]) / 2, COR["y1"] + T / 2, COR["z"] / 2),
                        (COR["x1"] - COR["x0"], T, COR["z"]), m_plaster, "far_wall",
                        uv_scale=1.6, uv_axes=(0, 2))))
    add(("wall", 0, box((2.0, COR["y1"] + T / 2 - 0.01, 1.30), (2.6, 0.03, 2.4), m_brick,
                        "far_brick", uv_scale=1.0, uv_axes=(0, 2))))
    # wall ends
    for xe in (COR["x0"], COR["x1"]):
        add(("wall", 0, box((xe, (COR["y0"] + COR["y1"]) / 2, COR["z"] / 2),
                            (T, COR["y1"] - COR["y0"], COR["z"]), m_teal, "cor_end",
                            uv_scale=1.4, uv_axes=(1, 2))))
    # baseboard on the far wall
    add(("base", 0, box(((COR["x0"] + COR["x1"]) / 2, COR["y1"] - 0.02, 0.07),
                        (COR["x1"] - COR["x0"], 0.05, 0.14), m_base, "base")))

    # doors + frames on the far wall
    for dx in (-4.6, -1.3, 4.4, 6.2):
        add(("door", 0, box((dx, COR["y1"] - 0.02, 1.10), (0.96, 0.07, 2.15), m_door, "door")))
        add(("door", 0, box((dx, COR["y1"] - 0.05, 1.14), (1.10, 0.05, 2.26), m_wood, "door_frame")))
        add(("door", 0, cyl((dx + 0.36, COR["y1"] - 0.09, 1.05), 0.03, 0.12, m_metal, "x", 10, "knob")))
    # a utility box
    add(("box", 0, box((-2.6, COR["y1"] - 0.08, 1.5), (0.34, 0.16, 0.5), m_dark, "util")))

    # pipes along the ceiling on the far side, plus vertical runs
    for pz in (2.62, 2.42):
        add(("pipe", 0, cyl((0.0, COR["y1"] - 0.12, pz), 0.045, COR["x1"] - COR["x0"] - 0.6,
                            m_pipe, "x", 12, "pipe")))
    for px in (-4.6, 6.2):
        add(("pipe", 0, cyl((px, COR["y1"] - 0.12, 1.3), 0.045, 2.6, m_pipe, "z", 12, "pipe_v")))

    # ------------------------------------------------- cell-front wall + gates
    def teal_wall_seg(x0, x1, z0, z1):
        if x1 - x0 < 1e-4 or z1 - z0 < 1e-4:
            return
        add(("wall", 0, box(((x0 + x1) / 2, 0.0, (z0 + z1) / 2), (x1 - x0, T, z1 - z0),
                            m_teal, "front_wall", uv_scale=1.4, uv_axes=(0, 2))))

    def brick_pier(xc, w=0.5, z1=2.5):
        add(("pier", 0, box((xc, T / 2 + 0.015, z1 / 2), (w, T + 0.03, z1), m_brick,
                            "pier", uv_scale=1.0, uv_axes=(0, 2))))

    open_x = [NICHE_A, (GATE["x0"], GATE["x1"]), NICHE_B]
    opens_z = [(0.06, 2.14), (GATE["z0"], GATE["z1"]), (0.06, 2.14)]
    # full-height teal between openings
    edges = [COR["x0"]]
    for (a, b) in open_x:
        edges += [a, b]
    edges += [COR["x1"]]
    for i in range(0, len(edges), 2):
        teal_wall_seg(edges[i], edges[i + 1], 0.0, COR["z"])
    # teal above each opening + blue sill below
    for (a, b), (z0, z1) in zip(open_x, opens_z):
        teal_wall_seg(a, b, z1, COR["z"])
        add(("sill", 0, box(((a + b) / 2, 0.0, z0 / 2), (b - a, T + 0.02, z0), m_base, "sill")))
    # brick piers flanking the target gate and the row ends
    brick_pier(GATE["x0"] - 0.26)
    brick_pier(GATE["x1"] + 0.26)
    brick_pier(NICHE_A[0] - 0.26)
    brick_pier(NICHE_B[1] + 0.26)
    # baseboard along the corridor face of the cell-front wall
    for (a, b) in [(COR["x0"] + 0.1, NICHE_A[0] - 0.5), (NICHE_A[1] + 0.5, GATE["x0"] - 0.5),
                   (GATE["x1"] + 0.5, NICHE_B[0] - 0.5), (NICHE_B[1] + 0.5, COR["x1"] - 0.1)]:
        add(("base", 0, box(((a + b) / 2, T / 2 + 0.02, 0.07), (b - a, 0.05, 0.14), m_base, "base")))

    # neighbour cell niches (visual only) + their bars
    for (a, b) in (NICHE_A, NICHE_B):
        add(("niche", 0, box(((a + b) / 2, -1.0, 1.05), (b - a - 0.15, 2.0, 2.0), m_dark, "niche")))
        _bars(a + 0.08, b - 0.08, 0.08, 2.10, 0.0, m_metal, meshes, step=0.15)

    # ------------------------------------------------------------- the gate
    _gate(GATE["x0"], GATE["x1"], GATE["z0"], GATE["z1"], m_metal, meshes)

    # ------------------------------------------------------------- the cell
    add(("floor", 1, box(((CELL["x0"] + CELL["x1"]) / 2, (CELL["y0"] + CELL["y1"]) / 2, -T / 2),
                         (CELL["x1"] - CELL["x0"], CELL["y1"] - CELL["y0"], T), m_tile_cell,
                         "cell_floor", uv_scale=1.2, uv_axes=(0, 1))))
    add(("ceiling", 1, box(((CELL["x0"] + CELL["x1"]) / 2, (CELL["y0"] + CELL["y1"]) / 2, CELL["z"] + T / 2),
                           (CELL["x1"] - CELL["x0"], CELL["y1"] - CELL["y0"], T), m_plank,
                           "cell_ceiling", uv_scale=2.0, uv_axes=(0, 1))))
    y = CELL["y0"] + 0.5
    while y < CELL["y1"] - 0.3:
        add(("beam", 1, box(((CELL["x0"] + CELL["x1"]) / 2, y, CELL["z"] - 0.07),
                            (CELL["x1"] - CELL["x0"] - 0.02, 0.16, 0.16), m_beam, "beam")))
        y += 0.72
    # back / side walls
    add(("wall", 1, box(((CELL["x0"] + CELL["x1"]) / 2, CELL["y0"] - T / 2, CELL["z"] / 2),
                        (CELL["x1"] - CELL["x0"], T, CELL["z"]), m_teal, "cell_back",
                        uv_scale=1.4, uv_axes=(0, 2))))
    for xw in (CELL["x0"] - T / 2, CELL["x1"] + T / 2):
        add(("wall", 1, box((xw, (CELL["y0"] + CELL["y1"]) / 2, CELL["z"] / 2),
                            (T, CELL["y1"] - CELL["y0"], CELL["z"]), m_teal, "cell_side",
                            uv_scale=1.4, uv_axes=(1, 2))))
    # cell baseboards
    add(("base", 1, box(((CELL["x0"] + CELL["x1"]) / 2, CELL["y0"] + 0.02, 0.07),
                        (CELL["x1"] - CELL["x0"], 0.05, 0.14), m_base, "base")))
    for xw, s in ((CELL["x0"] + 0.02, 1), (CELL["x1"] - 0.02, -1)):
        add(("base", 1, box((xw, (CELL["y0"] + CELL["y1"]) / 2, 0.07),
                            (0.05, CELL["y1"] - CELL["y0"], 0.14), m_base, "base")))

    # bed along the right wall
    bx, by = 2.86, -2.05
    add(("bed", 1, box((bx, by, 0.44), (0.98, 1.94, 0.18), m_fabric, "mattress",
                       uv_scale=0.8, uv_axes=(0, 1))))
    add(("bed", 1, box((bx, by - 0.82, 0.62), (0.74, 0.34, 0.14), pbr("pillow", rgb=(0.86, 0.84, 0.78), rough=0.98), "pillow")))
    for dx in (-0.46, 0.46):
        for dy in (-0.94, 0.94):
            add(("bed", 1, cyl((bx + dx, by + dy, 0.24), 0.045, 0.6, m_wood, "z", 10, "post")))
    add(("bed", 1, box((bx, by - 0.94, 0.55), (0.98, 0.06, 0.38), m_wood, "headboard")))
    add(("bed", 1, box((bx, by + 0.94, 0.50), (0.98, 0.06, 0.28), m_wood, "footboard")))

    # straw scattered on the cell floor
    rng = np.random.default_rng(7)
    for _ in range(70):
        sx = rng.uniform(CELL["x0"] + 0.1, CELL["x1"] - 0.1)
        sy = rng.uniform(CELL["y0"] + 0.1, CELL["y1"] - 0.15)
        if bx - 0.55 <= sx <= bx + 0.55 and by - 1.0 <= sy <= by + 1.0:
            continue
        a = rng.uniform(0, math.pi)
        m = box((sx, sy, 0.012), (0.02, rng.uniform(0.09, 0.2), 0.012), m_straw, "straw")
        m.apply_transform(tf.rotation_matrix(a, [0, 0, 1], point=[sx, sy, 0]))
        add(("straw", 1, m))

    # stool + bucket in the corridor just outside the gate
    _stool(2.10, 0.85, m_wood, meshes)
    _bucket(1.05, 0.68, m_metal, m_wood, meshes)

    # caged lamps: cell centre + a row down the corridor
    _lamp(2.0, -1.6, CELL["z"] - 0.02, m_metal, m_bulb, meshes)
    for lx in (-5.4, -2.6, 0.0, 2.8, 5.4):
        _lamp(lx, COR["y1"] - 0.85, COR["z"] - 0.02, m_metal, m_bulb, meshes)

    # ------------------------------------------------------------------
    # manifest
    # ------------------------------------------------------------------
    rooms = [
        {"id": 0, "type": "corridor",
         "bounds": [COR["x0"] + 0.5, COR["y0"] + 0.4, COR["x1"] - 0.5, COR["y1"] - 0.4],
         "area": (COR["x1"] - COR["x0"] - 1.0) * (COR["y1"] - COR["y0"] - 0.8)},
        {"id": 1, "type": "cell",
         "bounds": [CELL["x0"] + 0.4, CELL["y0"] + 0.4, CELL["x1"] - 0.4, CELL["y1"] - 0.45],
         "area": (CELL["x1"] - CELL["x0"] - 0.8) * (CELL["y1"] - CELL["y0"] - 0.85)},
    ]
    furniture = [
        {"type": "bed", "room_id": 1, "size": [0.98, 1.94, 0.6], "position": [bx - 0.49, by - 0.97]},
        {"type": "stool", "room_id": 0, "size": [0.38, 0.38, 0.48], "position": [2.10 - 0.19, 0.85 - 0.19]},
        {"type": "bucket", "room_id": 0, "size": [0.34, 0.34, 0.36], "position": [1.05 - 0.17, 0.68 - 0.17]},
    ]
    zones = [
        {"name": "corridor", "position": [0.0, 1.30, 1.65]},
        {"name": "cell", "position": [2.0, -1.6, 1.65]},
    ]
    sb = {
        "kind": "cartoon",
        "plan": {"path": str(next(iter(sorted(Path(views_dir).glob("*.jpg"))), "jail_ref")),
                 "mpp": 0.01, "room": {"w": CELL["x1"] - CELL["x0"], "d": CELL["y1"] - CELL["y0"], "h": CELL["z"]}},
        "rooms": rooms,
        "furniture": furniture,
        "meshes": meshes,
        "spawn": {"position": [2.0, 1.55, 1.65], "yaw": 0.0},
        "zones": zones,
        "walk_bounds": [COR["x0"], CELL["y0"], COR["x1"], COR["y1"]],
        "walk_rects": [
            [COR["x0"] + 0.55, COR["y0"] + 0.40, COR["x1"] - 0.55, COR["y1"] - 0.40],
            [CELL["x0"] + 0.40, CELL["y0"] + 0.40, CELL["x1"] - 0.40, CELL["y1"] - 0.45],
            [GATE["x0"] + 0.10, -0.40, GATE["x1"] - 0.10, 0.40],
        ],
        "depth_method": "cartoon parametric (5 views)",
        "axis": "z-up",
    }
    return sb


# --------------------------------------------------------------------------
# sub-assemblies
# --------------------------------------------------------------------------
def _bars(x0, x1, z0, z1, y, mat, meshes, step=0.15, r=0.028):
    n = max(2, int(round((x1 - x0) / step)))
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n
        meshes.append(("bars", 0, cyl((x, y, (z0 + z1) / 2), r, z1 - z0, mat, "z", 10, "bar")))
    for z in (z0 + 0.06, (z0 + z1) / 2, z1 - 0.06):
        meshes.append(("bars", 0, box(((x0 + x1) / 2, y, z), (x1 - x0 + 0.1, 0.06, 0.06), mat, "rail")))


def _gate(x0, x1, z0, z1, mat, meshes):
    """Double-leaf barred gate with a central mullion, rails, brace and padlock."""
    _bars(x0 + 0.03, x1 - 0.03, z0 + 0.02, z1 - 0.02, 0.0, mat, meshes, step=0.14, r=0.03)
    xm = (x0 + x1) / 2
    meshes.append(("gate", 1, box((xm, 0.0, (z0 + z1) / 2), (0.07, 0.09, z1 - z0), mat, "mullion")))
    for zz in (z0 + 0.10, z1 - 0.10):
        meshes.append(("gate", 1, box((xm, 0.0, zz), (0.16, 0.11, 0.10), mat, "stile")))
    # diagonal brace on the lower half
    length = math.hypot(x1 - x0, 0.6)
    brace = trimesh.creation.box(extents=[length, 0.06, 0.06])
    brace.apply_transform(tf.rotation_matrix(math.atan2(0.6, x1 - x0), [0, 1, 0]))
    brace.apply_translation([xm, 0.0, z0 + 0.5])
    brace.visual = TextureVisuals(material=mat)
    meshes.append(("gate", 1, brace))
    # padlock + hinges
    meshes.append(("gate", 1, box((xm + 0.16, -0.06, 1.02), (0.20, 0.14, 0.24), mat, "lock")))
    meshes.append(("gate", 1, cyl((xm + 0.16, -0.06, 0.90), 0.035, 0.22, mat, "y", 10, "shackle")))
    for zz in (0.30, z1 - 0.30):
        meshes.append(("gate", 1, box((x0 - 0.02, 0.0, zz), (0.10, 0.09, 0.20), mat, "hinge")))


def _stool(x, y, mat, meshes):
    meshes.append(("stool", 0, cyl((x, y, 0.45), 0.19, 0.06, mat, "z", 20, "seat")))
    for a in (0, 2 * math.pi / 3, 4 * math.pi / 3):
        meshes.append(("stool", 0, cyl((x + 0.12 * math.cos(a), y + 0.12 * math.sin(a), 0.22),
                                       0.028, 0.44, mat, "z", 8, "leg")))


def _bucket(x, y, mat, wood, meshes):
    meshes.append(("bucket", 0, cyl((x, y, 0.17), 0.16, 0.34, wood, "z", 18, "bucket")))
    for zz in (0.30, 0.06):
        meshes.append(("bucket", 0, cyl((x, y, zz), 0.165, 0.03, mat, "z", 18, "band")))


def _lamp(x, y, z, metal, bulb, meshes):
    meshes.append(("lamp", 0, cyl((x, y, z - 0.20), 0.11, 0.30, metal, "z", 14, "cage")))
    meshes.append(("lamp", 0, cyl((x, y, z - 0.20), 0.06, 0.26, bulb, "z", 14, "bulb")))
    meshes.append(("lamp", 0, cyl((x, y, z - 0.03), 0.02, 0.10, metal, "z", 8, "wire")))


# --------------------------------------------------------------------------
# nav grid
# --------------------------------------------------------------------------
def custom_nav_grid(sb, res=168):
    minx, miny, maxx, maxy = [float(v) for v in sb["walk_bounds"]]
    minx -= 0.30; miny -= 0.30; maxx += 0.30; maxy += 0.30
    cell = (maxx - minx) / float(res - 1)
    rects = sb.get("walk_rects", [])
    feet = [(it["position"][0], it["position"][1], it["size"][0], it["size"][1])
            for it in sb["furniture"]]
    rows = []
    for j in range(res):
        y = miny + j * cell
        line = []
        for i in range(res):
            x = minx + i * cell
            free = any(r[0] <= x <= r[2] and r[1] <= y <= r[3] for r in rects)
            if free:
                for fx, fy, fw, fd in feet:
                    if fx - 0.12 <= x <= fx + fw + 0.12 and fy - 0.12 <= y <= fy + fd + 0.12:
                        free = False
                        break
            line.append("0" if free else "1")
        rows.append("".join(line))
    return {"min": [round(minx, 4), round(miny, 4)], "cell": round(cell, 5),
            "rows": res, "cols": res, "blocked": rows}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--views", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    out = Path(args.out).expanduser().resolve()
    for d in ("3d", "3d/gltf", "textures", "web", "visualizations", "input"):
        (out / d).mkdir(parents=True, exist_ok=True)

    ns = {"__name__": "__main__", "WORKDIR": out.parent, "OUT": out,
          "scene_builds": [], "exports": [], "plans": [],
          "USE_PLAN": False, "USE_PHOTO": False, "input_files": []}
    exec_cells(ns, [2, 8, 10, 12, 16])
    ns["nav_grid"] = custom_nav_grid

    sb = build_scene(ns, args.views)
    glb, meta = ns["export_scene"](sb, 1)
    ns["exports"] = [(glb, meta)]

    exec_cells(ns, [18])
    print("wrote", glb)
    print("manifest", out / "3d" / "scene_1.json")
    print("viewer", out / "web" / "viewer_1.html")


if __name__ == "__main__":
    main()
