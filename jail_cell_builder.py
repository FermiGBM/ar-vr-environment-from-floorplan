#!/usr/bin/env python3
"""Parametric cartoon jail cell + corridor, reconstructed from a handful of views.

v2 ("high-end"): materials are real CC0 PBR sets from Poly Haven -- albedo,
normal, and an ARM map (AO in R, roughness in G, metalness in B) wired into
trimesh's PBRMaterial and embedded in the GLB as compressed JPEG.  Falls back to
the procedural cartoon textures (v1) when --pbr is not supplied.

    python jail_cell_builder.py --views ~/prison_views/shots --out ~/jail_world_pbr \
        --pbr ~/arvr-test/pbr
"""
import argparse
import io
import json
import math
import shutil
import struct
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
# PBR material sets (Poly Haven)  ->  name: (tile metres, metallicFactor)
# --------------------------------------------------------------------------
PBR_INFO = {
    "stone":     (2.2, 0.0),
    "brick":     (1.6, 0.0),
    "wood":      (2.0, 0.0),
    "tile_cor":  (2.4, 0.0),
    "tile_cell": (2.0, 0.0),
    "metal":     (1.0, 1.0),
    "plaster":   (3.0, 0.0),
}

# Painted surfaces: keep the photo's luminance detail but recolor it to the
# palette sampled from the reference frames (teal block walls, pink corridor
# tiles, blue-teal cell tiles).  Average albedo then matches the frames while
# the block/grout relief still comes from the real texture.
PBR_PALETTE = {
    "stone":     (0.59, 0.70, 0.66),
    "tile_cor":  (0.77, 0.61, 0.57),
    "tile_cell": (0.41, 0.62, 0.67),
    "plaster":   (0.59, 0.59, 0.48),
}

# Bare materials keep their own colour, with a mild nudge toward the frames.
PBR_TINT = {
    "brick":     (1.00, 0.92, 0.88),
    "wood":      (1.00, 0.90, 0.78),
    "metal":     (1.00, 1.00, 1.00),
}


def _load_rgb(path, size):
    im = Image.open(path).convert("RGB")
    if size and max(im.size) > size:
        im = im.resize((size, size), Image.LANCZOS)
    return im


def pbr_set(name, pbr_dir, tint=None, metal_scale=None, tile_scale=1.0,
            colorize=None, palette=True):
    tile, metal = PBR_INFO[name]
    d = Path(pbr_dir) / name
    diff = _load_rgb(d / "diff.jpg", 1024)
    nor = _load_rgb(d / "nor.jpg", 1024)
    arm = _load_rgb(d / "arm.jpg", 512)
    if colorize is None:
        colorize = palette and name in PBR_PALETTE
    arr = np.asarray(diff, np.float32)
    if colorize:
        lum = arr @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        lum = lum / max(float(lum.mean()), 1e-6)
        target = np.asarray(PBR_PALETTE[name], np.float32) * 255.0
        arr = lum[:, :, None] * target[None, None, :]
    else:
        tint = np.asarray(tint if tint is not None else PBR_TINT.get(name, (1, 1, 1)), np.float32)
        arr = arr * tint
    if not np.allclose(arr, np.asarray(diff, np.float32)):
        diff = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")
    mat = PBRMaterial(
        name=name,
        baseColorTexture=diff, baseColorFactor=[1.0, 1.0, 1.0, 1.0],
        normalTexture=nor,
        occlusionTexture=arm,
        metallicRoughnessTexture=arm,
        metallicFactor=float(metal if metal_scale is None else metal_scale),
        roughnessFactor=1.0,
    )
    return mat, tile * tile_scale


# --------------------------------------------------------------------------
# procedural fallback textures (the v1 cartoon look)
# --------------------------------------------------------------------------
def _j(arr, rng, amp):
    return np.clip(arr + rng.normal(0.0, amp, arr.shape), 0, 255)


def _k(size):
    return size / 512.0


def tex_teal_block(size=512, seed=21):
    rng = np.random.default_rng(seed)
    k = _k(size)
    base = np.array([150, 178, 168], float)
    grout = np.array([92, 116, 110], float)
    arr = np.tile(grout, (size, size, 1))
    bw, bh = size // 2, size // 4
    m = max(2, int(round(4 * k)))
    for row, y in enumerate(range(0, size, bh)):
        off = (bw // 2) if row % 2 else 0
        for x in range(-bw, size + bw, bw):
            x0, y0 = x + off + m, y + m
            x1, y1 = x + off + bw - m, y + bh - m
            ax0, ay0, ax1, ay1 = max(0, x0), max(0, y0), min(size, x1), min(size, y1)
            if ax1 <= ax0 or ay1 <= ay0:
                continue
            col = base + rng.normal(0, 6, 3)
            arr[ay0:ay1, ax0:ax1] = col
            arr[ay0:ay1, ax0:ax0 + m] = col * 1.12
            arr[ay0:ay0 + m, ax0:ax1] = col * 1.10
            arr[ay1 - m:ay1, ax0:ax1] = col * 0.80
            arr[ay0:ay1, ax1 - m:ax1] = col * 0.82
    return _j(arr, rng, 4).astype(np.uint8)


def tex_brick(size=512, seed=22):
    rng = np.random.default_rng(seed)
    k = _k(size)
    base = np.array([196, 76, 46], float)
    mortar = np.array([186, 178, 168], float)
    arr = np.tile(mortar, (size, size, 1))
    bw, bh = size // 4, size // 8
    m = max(1, int(round(3 * k)))
    e = max(1, int(round(2 * k)))
    for row, y in enumerate(range(0, size, bh)):
        off = (bw // 2) if row % 2 else 0
        for x in range(-bw, size + bw, bw):
            ax0, ay0 = max(0, x + off + m), max(0, y + m)
            ax1, ay1 = min(size, x + off + bw - m), min(size, y + bh - m)
            if ax1 <= ax0 or ay1 <= ay0:
                continue
            col = base + rng.normal(0, 12, 3)
            arr[ay0:ay1, ax0:ax1] = col
            arr[ay0:ay1, ax0:ax0 + e] = col * 1.15
            arr[ay1 - e:ay1, ax0:ax1] = col * 0.78
    return _j(arr, rng, 5).astype(np.uint8)


def tex_planks(size=512, seed=23):
    rng = np.random.default_rng(seed)
    k = _k(size)
    base = np.array([178, 96, 42], float)
    arr = np.empty((size, size, 3), float)
    plank = size // 4
    g1 = max(2, int(round(4 * k)))
    g2 = max(1, int(round(3 * k)))
    for x0 in range(0, size, plank):
        col = base * (1.0 + rng.uniform(-0.12, 0.12))
        arr[:, x0:x0 + plank] = col
        g = np.sin(np.linspace(0, rng.uniform(4, 8) * math.pi, size))[:, None, None]
        arr[:, x0:x0 + plank] += g * 8.0
        arr[:, x0:x0 + g1] = col * 0.45
        arr[:, x0 + g1:x0 + g1 + g2] = col * 1.18
    return _j(arr, rng, 4).astype(np.uint8)


def tex_tile_corridor(size=512, seed=24):
    rng = np.random.default_rng(seed)
    k = _k(size)
    grout = np.array([148, 112, 106], float)
    base = np.array([196, 156, 146], float)
    accent = np.array([74, 92, 152], float)
    arr = np.tile(grout, (size, size, 1))
    t = size // 4
    m = max(2, int(round(4 * k)))
    b = max(2, int(round(5 * k)))
    for y in range(0, size, t):
        for x in range(0, size, t):
            c = (accent if rng.random() < 0.09 else base) + rng.normal(0, 7, 3)
            arr[y + m:y + t - m, x + m:x + t - m] = c
            arr[y + m:y + t - m, x + m:x + m + b] = c * 1.08
    return _j(arr, rng, 3).astype(np.uint8)


def tex_tile_cell(size=512, seed=25):
    rng = np.random.default_rng(seed)
    k = _k(size)
    grout = np.array([52, 92, 104], float)
    base = np.array([104, 158, 172], float)
    arr = np.tile(grout, (size, size, 1))
    t = size // 4
    m = max(2, int(round(4 * k)))
    b = max(2, int(round(5 * k)))
    for y in range(0, size, t):
        for x in range(0, size, t):
            c = base + rng.normal(0, 7, 3)
            arr[y + m:y + t - m, x + m:x + t - m] = c
            arr[y + m:y + t - m, x + m:x + m + b] = c * 1.10
    return _j(arr, rng, 3).astype(np.uint8)


def tex_plaster(size=512, seed=26):
    rng = np.random.default_rng(seed)
    k = _k(size)
    base = np.array([150, 150, 122], float)
    arr = np.tile(base, (size, size, 1))
    for _ in range(220):
        cx, cy = rng.integers(0, size, 2)
        r = int(rng.integers(max(2, int(8 * k)), max(3, int(40 * k))))
        arr[max(0, cy - r):cy + r, max(0, cx - r):cx + r] *= (1.0 + rng.normal(0, 0.05))
    return _j(arr, rng, 5).astype(np.uint8)


def tex_fabric_red(size=256, seed=27):
    rng = np.random.default_rng(seed)
    k = _k(size)
    base = np.array([172, 46, 54], float)
    arr = np.tile(base, (size, size, 1)) + rng.normal(0, 6, (size, size, 3))
    step = max(2, int(round(5 * k)))
    for y in range(0, size, step):
        arr[y:y + 1, :] *= 0.90
    return np.clip(arr, 0, 255).astype(np.uint8)


def _img(arr):
    a = np.clip(np.asarray(arr, np.float32), 0, 255).astype(np.uint8)
    return Image.fromarray(a, "RGB")


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
# strategy 1: keep the original palette, add real surface relief
# --------------------------------------------------------------------------
def _box_blur(a, r):
    if r < 1:
        return a
    k = 2 * r + 1
    p = np.pad(a, ((r, r), (r, r)), mode="edge")
    c = np.cumsum(p, axis=0)
    c = np.vstack([np.zeros((1, c.shape[1])), c])
    a = (c[k:] - c[:-k]) / k
    c = np.cumsum(a, axis=1)
    c = np.hstack([np.zeros((c.shape[0], 1)), c])
    return (c[:, k:] - c[:, :-k]) / k


def detail_maps(arr, strength=2.0, rough=0.80, ao=0.55):
    """Derive a tangent-space normal map and an ARM map (AO / roughness /
    metalness=0) from the relief already present in a procedural texture.

    The sign of the gradients was checked against Poly Haven's disp + nor_gl
    pair (corr 0.78 on both axes), so these maps follow the same OpenGL
    convention their PBR sets use.
    """
    a = np.asarray(arr, np.float32)
    s = a.shape[0]
    k = s / 512.0
    lum = (a @ np.array([0.2126, 0.7152, 0.0722], np.float32)) / 255.0
    h = _box_blur(lum, max(1, int(round(2 * k))))
    h = (h - h.min()) / max(float(h.max() - h.min()), 1e-6)

    gy, gx = np.gradient(h)
    nx = -gx * strength * k
    ny = -gy * strength * k
    nz = np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nrm = np.stack([nx / ln, ny / ln, nz / ln], -1) * 0.5 + 0.5

    occl = np.clip(1.0 - ao * (1.0 - h), 0.0, 1.0)
    occl = _box_blur(occl, max(1, int(round(3 * k))))
    rough_m = np.clip(rough + (0.97 - rough) * (1.0 - h), 0.0, 1.0)
    arm = np.stack([occl, rough_m, np.zeros_like(h)], -1)
    return _img(nrm * 255), _img(arm * 255)


def detail_pbr(name, arr, rough=0.80, metal=0.0, strength=2.0, ao=0.55):
    """Palette albedo + generated normal/roughness/AO (strategy 1)."""
    nor, arm = detail_maps(arr, strength=strength, rough=rough, ao=ao)
    if arm.size[0] > 512:
        arm = arm.resize((512, 512), Image.LANCZOS)
    return PBRMaterial(
        name=name, baseColorTexture=_img(arr), baseColorFactor=[1.0, 1.0, 1.0, 1.0],
        normalTexture=nor, occlusionTexture=arm, metallicRoughnessTexture=arm,
        metallicFactor=float(metal), roughnessFactor=1.0,
    )


# --------------------------------------------------------------------------
# primitives (UVs are always generated; flat materials simply ignore them)
# --------------------------------------------------------------------------
# six faces: outward normal, U axis, V axis  (U x V == N, so winding is CCW)
_BOX_AXES = (
    ((1, 0, 0), (0, 1, 0), (0, 0, 1)),
    ((-1, 0, 0), (0, 0, 1), (0, 1, 0)),
    ((0, 1, 0), (0, 0, 1), (1, 0, 0)),
    ((0, -1, 0), (1, 0, 0), (0, 0, 1)),
    ((0, 0, 1), (1, 0, 0), (0, 1, 0)),
    ((0, 0, -1), (0, 1, 0), (1, 0, 0)),
)


def box(center, extents, mat, name="box", uv_scale=None, uv_axes=None, tile=2.0):
    """Box with split per-face vertices, real face normals and planar UVs.

    Splitting vertices gives hard edges (the cartoon look) and each face gets
    a proper metre-scaled projection, so brick/stone/plank textures tile
    correctly on every side instead of smearing along one axis.
    """
    s = float(uv_scale or tile)
    half = np.asarray(extents, dtype=np.float64) * 0.5
    verts, uvs, faces = [], [], []
    for n, u, v in _BOX_AXES:
        n = np.asarray(n, np.float64)
        u = np.asarray(u, np.float64)
        v = np.asarray(v, np.float64)
        c = n * float(abs(n @ half))
        hu = float(abs(u @ half))
        hv = float(abs(v @ half))
        quad = [c - u * hu - v * hv, c + u * hu - v * hv,
                c + u * hu + v * hv, c - u * hu + v * hv]
        base = len(verts)
        for p in quad:
            verts.append(p)
            uvs.append((float(p @ u) / s, float(p @ v) / s))
        faces += [[base, base + 1, base + 2], [base, base + 2, base + 3]]

    m = trimesh.Trimesh(vertices=np.asarray(verts, np.float64),
                        faces=np.asarray(faces, np.int64), process=False)
    m.apply_translation([float(c) for c in center])
    m.visual = TextureVisuals(uv=np.asarray(uvs, np.float64), material=mat)
    m.metadata["name"] = name
    return m


def cyl(center, radius, height, mat, axis="z", sections=16, name="cyl", tile=1.0):
    m = trimesh.creation.cylinder(radius=float(radius), height=float(height), sections=sections)
    v = m.vertices
    theta = np.arctan2(v[:, 1], v[:, 0])
    u = theta / (2 * np.pi) * (2 * np.pi * radius) / tile
    w = v[:, 2] / tile
    uv = np.column_stack([u, w])
    if axis == "x":
        m.apply_transform(tf.rotation_matrix(math.pi / 2, [0, 1, 0]))
    elif axis == "y":
        m.apply_transform(tf.rotation_matrix(math.pi / 2, [1, 0, 0]))
    m.apply_translation([float(c) for c in center])
    m.visual = TextureVisuals(uv=uv, material=mat)
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


def build_scene(g, views_dir, pbr_dir=None, palette=True, look="photoreal"):
    (g["OUT"] / "textures").mkdir(parents=True, exist_ok=True)

    use_pbr = bool(pbr_dir) and (Path(pbr_dir) / "stone" / "diff.jpg").exists()
    hybrid = use_pbr and look == "hybrid"
    if hybrid:
        print("  materials: hybrid -- palette architecture + generated PBR detail, photoreal props")
        m_teal = detail_pbr("teal_wall", tex_teal_block(1024), rough=0.72, strength=3.0)
        m_stone = m_teal
        t_stone = 1.4
        m_brick = detail_pbr("brick", tex_brick(1024), rough=0.86, strength=2.6)
        t_brick = 1.0
        m_plank = detail_pbr("plank_ceiling", tex_planks(1024), rough=0.82, strength=1.6)
        m_tile_cor = detail_pbr("tile_cor", tex_tile_corridor(1024), rough=0.55, strength=2.2)
        t_tcor = 1.6
        m_tile_cell = detail_pbr("tile_cell", tex_tile_cell(1024), rough=0.55, strength=2.2)
        t_tcell = 1.2
        m_plaster = detail_pbr("plaster", tex_plaster(1024), rough=0.92, strength=1.2)
        t_plaster = 1.6
        # props keep the full photoreal treatment
        m_wood, t_wood = pbr_set("wood", pbr_dir, colorize=False)
        m_metal, t_metal = pbr_set("metal", pbr_dir, colorize=False)
        m_pipe, t_pipe = pbr_set("metal", pbr_dir, tint=(0.82, 0.60, 0.46),
                                 metal_scale=0.55, colorize=False)
        m_iron = pbr("iron", rgb=(0.045, 0.048, 0.055), rough=0.38, metal=0.85)
        m_door = pbr_set("wood", pbr_dir, tint=(0.50, 0.58, 0.50), colorize=False)[0]
        m_fabric = detail_pbr("fabric", tex_fabric_red(512), rough=0.95,
                              strength=0.6, ao=0.3)
    elif use_pbr:
        print("  materials: photoreal PBR from", pbr_dir)
        M = {}
        for nm in PBR_INFO:
            M[nm] = pbr_set(nm, pbr_dir, palette=palette)
        m_stone, t_stone = M["stone"]
        m_brick, t_brick = M["brick"]
        m_wood, t_wood = M["wood"]
        m_tile_cor, t_tcor = M["tile_cor"]
        m_tile_cell, t_tcell = M["tile_cell"]
        m_metal, t_metal = M["metal"]
        m_plaster, t_plaster = M["plaster"]
        m_plank = m_wood
        m_teal = m_stone
        # rusty corridor pipes: same plate maps, warmed and only half metallic
        m_pipe, t_pipe = pbr_set("metal", pbr_dir, tint=(0.82, 0.60, 0.46),
                                 metal_scale=0.55, colorize=False)
        # black painted iron for bars / gate / hardware
        m_iron = pbr("iron", rgb=(0.045, 0.048, 0.055), rough=0.38, metal=0.85)
        m_fabric = pbr("fabric", tex_fabric_red(), rough=0.98)
        m_door = pbr("door", rgb=(0.20, 0.24, 0.22), rough=0.75)
    else:
        print("  materials: procedural (cartoon)")
        m_stone = m_teal = pbr("teal", tex_teal_block()); t_stone = 1.4
        m_brick = pbr("brick", tex_brick()); t_brick = 1.0
        m_wood = m_plank = pbr("plank", tex_planks()); t_wood = 2.0
        m_tile_cor = pbr("tile_cor", tex_tile_corridor()); t_tcor = 1.6
        m_tile_cell = pbr("tile_cell", tex_tile_cell()); t_tcell = 1.2
        m_plaster = pbr("plaster", tex_plaster()); t_plaster = 1.6
        m_metal = pbr("metal", rgb=(0.075, 0.075, 0.09), rough=0.5, metal=0.6); t_metal = 1.0
        m_pipe = pbr("pipe", rgb=(0.34, 0.28, 0.24), rough=0.6, metal=0.3); t_pipe = 1.0
        m_iron = m_metal
        m_fabric = pbr("fabric", tex_fabric_red(), rough=0.98)
        m_door = pbr("door", rgb=(0.20, 0.24, 0.22), rough=0.75)

    m_dark = pbr("dark", rgb=(0.03, 0.035, 0.045), rough=0.95)
    m_base = pbr("baseboard", rgb=(0.16, 0.30, 0.50), rough=0.7)
    m_beam = pbr("beam", rgb=(0.20, 0.10, 0.05), rough=0.9)
    m_straw = pbr("straw", rgb=(0.66, 0.52, 0.22), rough=0.98)
    m_bulb = pbr("bulb", rgb=(1.0, 0.87, 0.6), rough=0.35, emissive=(1.0, 0.82, 0.5))

    meshes = []
    add = meshes.append

    # ---------------------------------------------------------------- corridor
    add(("floor", 0, box(((COR["x0"] + COR["x1"]) / 2, (COR["y0"] + COR["y1"]) / 2, -T / 2),
                         (COR["x1"] - COR["x0"], COR["y1"] - COR["y0"], T), m_tile_cor,
                         "cor_floor", uv_scale=t_tcor, uv_axes=(0, 1))))
    add(("ceiling", 0, box(((COR["x0"] + COR["x1"]) / 2, (COR["y0"] + COR["y1"]) / 2, COR["z"] + T / 2),
                           (COR["x1"] - COR["x0"], COR["y1"] - COR["y0"], T), m_plank,
                           "cor_ceiling", uv_scale=t_wood, uv_axes=(0, 1))))
    x = COR["x0"] + 0.5
    while x < COR["x1"] - 0.3:
        add(("beam", 0, box((x, (COR["y0"] + COR["y1"]) / 2, COR["z"] - 0.07),
                            (0.16, COR["y1"] - COR["y0"] - 0.02, 0.16), m_beam, "beam")))
        x += BEAM_EVERY

    add(("wall", 0, box(((COR["x0"] + COR["x1"]) / 2, COR["y1"] + T / 2, COR["z"] / 2),
                        (COR["x1"] - COR["x0"], T, COR["z"]), m_plaster, "far_wall",
                        uv_scale=t_plaster, uv_axes=(0, 2))))
    add(("wall", 0, box((2.0, COR["y1"] + T / 2 - 0.01, 1.30), (2.6, 0.03, 2.4), m_brick,
                        "far_brick", uv_scale=t_brick, uv_axes=(0, 2))))
    for xe in (COR["x0"], COR["x1"]):
        add(("wall", 0, box((xe, (COR["y0"] + COR["y1"]) / 2, COR["z"] / 2),
                            (T, COR["y1"] - COR["y0"], COR["z"]), m_teal, "cor_end",
                            uv_scale=t_stone, uv_axes=(1, 2))))
    add(("base", 0, box(((COR["x0"] + COR["x1"]) / 2, COR["y1"] - 0.02, 0.07),
                        (COR["x1"] - COR["x0"], 0.05, 0.14), m_base, "base")))

    for dx in (-4.6, -1.3, 4.4, 6.2):
        add(("door", 0, box((dx, COR["y1"] - 0.02, 1.10), (0.96, 0.07, 2.15), m_door,
                            "door", uv_scale=t_wood, uv_axes=(0, 2))))
        add(("door", 0, box((dx, COR["y1"] - 0.05, 1.14), (1.10, 0.05, 2.26), m_wood,
                            "door_frame", uv_scale=t_wood, uv_axes=(0, 2))))
        add(("door", 0, cyl((dx + 0.36, COR["y1"] - 0.09, 1.05), 0.03, 0.12, m_iron, "x", 10, "knob")))
    add(("box", 0, box((-2.6, COR["y1"] - 0.08, 1.5), (0.34, 0.16, 0.5), m_dark, "util")))

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
                            m_teal, "front_wall", uv_scale=t_stone, uv_axes=(0, 2))))

    def brick_pier(xc, w=0.5, z1=2.5):
        add(("pier", 0, box((xc, T / 2 + 0.015, z1 / 2), (w, T + 0.03, z1), m_brick,
                            "pier", uv_scale=t_brick, uv_axes=(0, 2))))

    open_x = [NICHE_A, (GATE["x0"], GATE["x1"]), NICHE_B]
    opens_z = [(0.06, 2.14), (GATE["z0"], GATE["z1"]), (0.06, 2.14)]
    edges = [COR["x0"]]
    for (a, b) in open_x:
        edges += [a, b]
    edges += [COR["x1"]]
    for i in range(0, len(edges), 2):
        teal_wall_seg(edges[i], edges[i + 1], 0.0, COR["z"])
    for (a, b), (z0, z1) in zip(open_x, opens_z):
        teal_wall_seg(a, b, z1, COR["z"])
        add(("sill", 0, box(((a + b) / 2, 0.0, z0 / 2), (b - a, T + 0.02, z0), m_base, "sill")))
    brick_pier(GATE["x0"] - 0.26)
    brick_pier(GATE["x1"] + 0.26)
    brick_pier(NICHE_A[0] - 0.26)
    brick_pier(NICHE_B[1] + 0.26)
    for (a, b) in [(COR["x0"] + 0.1, NICHE_A[0] - 0.5), (NICHE_A[1] + 0.5, GATE["x0"] - 0.5),
                   (GATE["x1"] + 0.5, NICHE_B[0] - 0.5), (NICHE_B[1] + 0.5, COR["x1"] - 0.1)]:
        add(("base", 0, box(((a + b) / 2, T / 2 + 0.02, 0.07), (b - a, 0.05, 0.14), m_base, "base")))

    for (a, b) in (NICHE_A, NICHE_B):
        add(("niche", 0, box(((a + b) / 2, -1.0, 1.05), (b - a - 0.15, 2.0, 2.0), m_dark, "niche")))
        _bars(a + 0.08, b - 0.08, 0.08, 2.10, 0.0, m_iron, meshes, step=0.15)

    _gate(GATE["x0"], GATE["x1"], GATE["z0"], GATE["z1"], m_iron, meshes)

    # ------------------------------------------------------------- the cell
    add(("floor", 1, box(((CELL["x0"] + CELL["x1"]) / 2, (CELL["y0"] + CELL["y1"]) / 2, -T / 2),
                         (CELL["x1"] - CELL["x0"], CELL["y1"] - CELL["y0"], T), m_tile_cell,
                         "cell_floor", uv_scale=t_tcell, uv_axes=(0, 1))))
    add(("ceiling", 1, box(((CELL["x0"] + CELL["x1"]) / 2, (CELL["y0"] + CELL["y1"]) / 2, CELL["z"] + T / 2),
                           (CELL["x1"] - CELL["x0"], CELL["y1"] - CELL["y0"], T), m_plank,
                           "cell_ceiling", uv_scale=t_wood, uv_axes=(0, 1))))
    y = CELL["y0"] + 0.5
    while y < CELL["y1"] - 0.3:
        add(("beam", 1, box(((CELL["x0"] + CELL["x1"]) / 2, y, CELL["z"] - 0.07),
                            (CELL["x1"] - CELL["x0"] - 0.02, 0.16, 0.16), m_beam, "beam")))
        y += 0.72
    add(("wall", 1, box(((CELL["x0"] + CELL["x1"]) / 2, CELL["y0"] - T / 2, CELL["z"] / 2),
                        (CELL["x1"] - CELL["x0"], T, CELL["z"]), m_teal, "cell_back",
                        uv_scale=t_stone, uv_axes=(0, 2))))
    for xw in (CELL["x0"] - T / 2, CELL["x1"] + T / 2):
        add(("wall", 1, box((xw, (CELL["y0"] + CELL["y1"]) / 2, CELL["z"] / 2),
                            (T, CELL["y1"] - CELL["y0"], CELL["z"]), m_teal, "cell_side",
                            uv_scale=t_stone, uv_axes=(1, 2))))
    add(("base", 1, box(((CELL["x0"] + CELL["x1"]) / 2, CELL["y0"] + 0.02, 0.07),
                        (CELL["x1"] - CELL["x0"], 0.05, 0.14), m_base, "base")))
    for xw, s in ((CELL["x0"] + 0.02, 1), (CELL["x1"] - 0.02, -1)):
        add(("base", 1, box((xw, (CELL["y0"] + CELL["y1"]) / 2, 0.07),
                            (0.05, CELL["y1"] - CELL["y0"], 0.14), m_base, "base")))

    bx, by = 2.86, -2.05
    add(("bed", 1, box((bx, by, 0.44), (0.98, 1.94, 0.18), m_fabric, "mattress",
                       uv_scale=0.8, uv_axes=(0, 1))))
    add(("bed", 1, box((bx, by - 0.82, 0.62), (0.74, 0.34, 0.14), pbr("pillow", rgb=(0.86, 0.84, 0.78), rough=0.98), "pillow")))
    for dx in (-0.46, 0.46):
        for dy in (-0.94, 0.94):
            add(("bed", 1, cyl((bx + dx, by + dy, 0.24), 0.045, 0.6, m_wood, "z", 10, "post", tile=t_wood)))
    add(("bed", 1, box((bx, by - 0.94, 0.55), (0.98, 0.06, 0.38), m_wood, "headboard",
                       uv_scale=t_wood, uv_axes=(0, 2))))
    add(("bed", 1, box((bx, by + 0.94, 0.50), (0.98, 0.06, 0.28), m_wood, "footboard",
                       uv_scale=t_wood, uv_axes=(0, 2))))

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

    _stool(2.10, 0.85, m_wood, t_wood, meshes)
    _bucket(1.05, 0.68, m_iron, m_wood, t_wood, meshes)

    _lamp(2.0, -1.6, CELL["z"] - 0.02, m_iron, m_bulb, meshes)
    for lx in (-5.4, -2.6, 0.0, 2.8, 5.4):
        _lamp(lx, COR["y1"] - 0.85, COR["z"] - 0.02, m_iron, m_bulb, meshes)

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
        "depth_method": ("hybrid palette + PBR detail" if hybrid else
                         "photoreal PBR (Poly Haven CC0)" if use_pbr else
                         "cartoon parametric (5 views)"),
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
    _bars(x0 + 0.03, x1 - 0.03, z0 + 0.02, z1 - 0.02, 0.0, mat, meshes, step=0.14, r=0.03)
    xm = (x0 + x1) / 2
    meshes.append(("gate", 1, box((xm, 0.0, (z0 + z1) / 2), (0.07, 0.09, z1 - z0), mat, "mullion")))
    for zz in (z0 + 0.10, z1 - 0.10):
        meshes.append(("gate", 1, box((xm, 0.0, zz), (0.16, 0.11, 0.10), mat, "stile")))
    length = math.hypot(x1 - x0, 0.6)
    brace = trimesh.creation.box(extents=[length, 0.06, 0.06])
    vb = brace.vertices
    uvb = np.column_stack([vb[:, 0] / 1.0, vb[:, 2] / 1.0])
    brace.apply_transform(tf.rotation_matrix(math.atan2(0.6, x1 - x0), [0, 1, 0]))
    brace.apply_translation([xm, 0.0, z0 + 0.5])
    brace.visual = TextureVisuals(uv=uvb, material=mat)
    meshes.append(("gate", 1, brace))
    meshes.append(("gate", 1, box((xm + 0.16, -0.06, 1.02), (0.20, 0.14, 0.24), mat, "lock")))
    meshes.append(("gate", 1, cyl((xm + 0.16, -0.06, 0.90), 0.035, 0.22, mat, "y", 10, "shackle")))
    for zz in (0.30, z1 - 0.30):
        meshes.append(("gate", 1, box((x0 - 0.02, 0.0, zz), (0.10, 0.09, 0.20), mat, "hinge")))


def _stool(x, y, mat, tile, meshes):
    meshes.append(("stool", 0, cyl((x, y, 0.45), 0.19, 0.06, mat, "z", 20, "seat", tile=tile)))
    for a in (0, 2 * math.pi / 3, 4 * math.pi / 3):
        meshes.append(("stool", 0, cyl((x + 0.12 * math.cos(a), y + 0.12 * math.sin(a), 0.22),
                                       0.028, 0.44, mat, "z", 8, "leg", tile=tile)))


def _bucket(x, y, mat, wood, tile, meshes):
    meshes.append(("bucket", 0, cyl((x, y, 0.17), 0.16, 0.34, wood, "z", 18, "bucket", tile=tile)))
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


# --------------------------------------------------------------------------
# GLB post-process: JPEG images + missing NORMAL accessors
# --------------------------------------------------------------------------
_CT = {5120: ("i1", 1), 5121: ("u1", 1), 5122: ("i2", 2),
       5123: ("u2", 2), 5125: ("u4", 4), 5126: ("f4", 4)}
_NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def _read_accessor(j, bin_, index):
    acc = j["accessors"][index]
    bv = j["bufferViews"][acc["bufferView"]]
    code, size = _CT[acc["componentType"]]
    n = _NC[acc["type"]]
    dt = np.dtype("<" + code)
    start = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = bv.get("byteStride") or size * n
    count = acc["count"]
    if stride == size * n:
        return np.frombuffer(bin_, dtype=dt, count=count * n, offset=start).reshape(count, n)
    out = np.empty((count, n), dt)
    for k in range(count):
        out[k] = np.frombuffer(bin_, dtype=dt, count=n, offset=start + k * stride)
    return out


def _vertex_normals(pos, idx):
    pos = np.asarray(pos, np.float64)
    tri = pos[idx.reshape(-1, 3)].reshape(-1, 3, 3)
    fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    vn = np.zeros_like(pos)
    ids = idx.reshape(-1, 3)
    for c in range(3):
        np.add.at(vn, ids[:, c], fn)
    ln = np.linalg.norm(vn, axis=1)
    ok = ln > 1e-12
    vn[ok] /= ln[ok, None]
    vn[~ok] = (0.0, 0.0, 1.0)
    return vn


def polish_glb(path, quality=88):
    """Re-encode embedded PNGs as JPEG and add missing NORMAL accessors.

    trimesh only writes NORMAL when the normals happen to be cached, so the
    GLB would otherwise load with a constant normal: PBR normal/roughness maps
    and metal reflections need real per-vertex normals to light correctly.
    Boxes are built with split per-face vertices, so these smooth normals come
    out flat on boxes and smooth on cylinders.
    """
    data = Path(path).read_bytes()
    if data[:4] != b"glTF":
        return 0, 0
    off, chunks = 12, []
    while off < len(data):
        clen, ctype = struct.unpack("<II", data[off:off + 8])
        chunks.append((ctype, data[off + 8:off + 8 + clen]))
        off += 8 + clen
    jchunk = next(c[1] for c in chunks if c[0] == 0x4E4F534A)
    bchunk = next((c[1] for c in chunks if c[0] == 0x004E4942), b"")
    j = json.loads(jchunk.decode("utf-8").rstrip("\x00 "))
    bvs = j.setdefault("bufferViews", [])
    blobs = [bytes(bchunk[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv.get("byteLength", 0)])
             for bv in bvs]

    # 1. embedded images -> JPEG (keeps the 1K PBR maps mobile-friendly)
    n_img = 0
    for img in j.get("images", []):
        i = img.get("bufferView")
        if i is None:
            continue
        try:
            im = Image.open(io.BytesIO(blobs[i])).convert("RGB")
        except Exception:
            continue
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
        blobs[i] = buf.getvalue()
        img["mimeType"] = "image/jpeg"
        n_img += 1

    # 2. NORMAL for every primitive that is missing it
    added_bv, added_acc = [], []
    n_norm = 0
    for mesh in j.get("meshes", []):
        for prim in mesh.get("primitives", []):
            attrs = prim.setdefault("attributes", {})
            if "NORMAL" in attrs or "POSITION" not in attrs:
                continue
            pos = _read_accessor(j, bchunk, attrs["POSITION"])
            if "indices" in prim:
                idx = _read_accessor(j, bchunk, prim["indices"]).ravel().astype(np.int64)
            else:
                idx = np.arange(len(pos), dtype=np.int64)
            if len(idx) < 3:
                continue
            vn = _vertex_normals(pos, idx)
            added_bv.append(vn.astype("<f4").tobytes())
            added_acc.append({"bufferView": len(bvs) + len(added_bv) - 1,
                              "byteOffset": 0, "componentType": 5126,
                              "count": int(len(pos)), "type": "VEC3"})
            attrs["NORMAL"] = len(j.setdefault("accessors", [])) + len(added_acc) - 1
            n_norm += 1

    j["accessors"].extend(added_acc)
    for blob in added_bv:
        bvs.append({"buffer": 0, "byteLength": len(blob)})

    # 3. rebuild the binary chunk with 4-byte aligned bufferViews
    new = bytearray()
    for bv, blob in zip(bvs, blobs + added_bv):
        while len(new) % 4:
            new.append(0)
        bv["byteOffset"] = len(new)
        bv["byteLength"] = len(blob)
        new += blob
    while len(new) % 4:
        new.append(0)
    if j.get("buffers"):
        j["buffers"][0]["byteLength"] = len(new)

    js = json.dumps(j, separators=(",", ":")).encode("utf-8")
    while len(js) % 4:
        js += b" "
    bb = bytes(new)
    out = b"glTF" + struct.pack("<II", 2, 12 + 8 + len(js) + 8 + len(bb))
    out += struct.pack("<II", len(js), 0x4E4F534A) + js
    out += struct.pack("<II", len(bb), 0x004E4942) + bb
    Path(path).write_bytes(out)
    return n_img, n_norm



def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--views", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--pbr", default=None, help="folder with <name>/{diff,nor,arm}.jpg")
    ap.add_argument("--look", choices=("cartoon", "hybrid", "photoreal"), default="photoreal",
                    help="cartoon: flat palette; hybrid: palette walls + generated "
                         "normal/rough/AO with photoreal props; photoreal: full CC0 PBR")
    ap.add_argument("--tint", choices=("palette", "natural"), default="palette",
                    help="palette: recolor painted maps to the reference frames; "
                         "natural: leave the CC0 albedo untouched")
    ap.add_argument("--quality", type=int, default=88)
    args = ap.parse_args()

    out = Path(args.out).expanduser().resolve()
    for d in ("3d", "3d/gltf", "textures", "web", "visualizations", "input"):
        (out / d).mkdir(parents=True, exist_ok=True)

    ns = {"__name__": "__main__", "WORKDIR": out.parent, "OUT": out,
          "scene_builds": [], "exports": [], "plans": [],
          "USE_PLAN": False, "USE_PHOTO": False, "input_files": []}
    exec_cells(ns, [2, 8, 10, 12, 16])
    ns["nav_grid"] = custom_nav_grid

    sb = build_scene(ns, args.views, args.pbr, palette=(args.tint == "palette"),
                     look=args.look)
    glb, meta = ns["export_scene"](sb, 1)
    before = Path(glb).stat().st_size
    n_img, n_norm = polish_glb(glb, quality=args.quality)
    after = Path(glb).stat().st_size
    # the multi-buffer .gltf duplicate is ~28 MB of PNG maps nobody loads
    shutil.rmtree(out / "3d" / "gltf", ignore_errors=True)
    ns["exports"] = [(glb, meta)]

    exec_cells(ns, [18])
    print(f"wrote {glb}")
    print(f"glb: {before/1e6:.2f} MB -> {after/1e6:.2f} MB "
          f"({n_img} images -> jpeg, {n_norm} primitives got normals)")
    print("manifest", out / "3d" / "scene_1.json")
    print("viewer", out / "web" / "viewer_1.html")


if __name__ == "__main__":
    main()
