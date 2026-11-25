#!/usr/bin/env python3
"""Cheap software preview of a GLB: flat-shaded painter's-algorithm render from
a few fixed camera poses, so we can eyeball the layout without a GPU."""
import sys
from pathlib import Path

import numpy as np
import trimesh
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection


def gather(scene):
    verts, faces, cols = [], [], []
    off = 0
    items = []
    try:
        for node in scene.graph.nodes_geometry:
            T, gname = scene.graph[node]
            items.append((T, scene.geometry[gname]))
    except Exception:
        items = [(np.eye(4), g) for g in scene.geometry.values()]
    for T, geom in items:
        g = geom.copy()
        g.apply_transform(T)
        v = np.asarray(g.vertices, float)
        f = np.asarray(g.faces, np.int64)
        vis = g.visual
        mat = getattr(vis, "material", None)
        col = np.array([0.7, 0.7, 0.7])
        if mat is not None:
            tex = getattr(mat, "baseColorTexture", None)
            bcf = getattr(mat, "baseColorFactor", None)
            if tex is not None:
                a = np.asarray(tex.convert("RGB"), float) / 255.0
                col = a.reshape(-1, 3).mean(0)
            elif bcf is not None:
                col = np.asarray(bcf[:3], float)
                if col.max() > 1.0:
                    col = col / 255.0
        elif hasattr(vis, "main_color"):
            col = np.asarray(vis.main_color[:3], float) / 255.0
        verts.append(v)
        faces.append(f + off)
        cols.append(np.tile(col, (len(f), 1)))
        off += len(v)
    return (np.concatenate(verts), np.concatenate(faces), np.concatenate(cols))


def render(V, F, C, cam, look, out, fov=60, W=1100, H=720, fog=0.0):
    cam = np.asarray(cam, float)
    look = np.asarray(look, float)
    f = look - cam
    f /= np.linalg.norm(f)
    up0 = np.array([0.0, 0.0, 1.0])
    r = np.cross(f, up0)
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    d = V - cam
    x, y, z = d @ r, d @ u, d @ f
    aspect = W / H
    t = np.tan(np.radians(fov) / 2)
    px = (x / z / (t * aspect)) * 0.5 + 0.5
    py = 1 - ((y / z / t) * 0.5 + 0.5)

    tri_px = np.stack([px[F], py[F]], axis=-1)
    tri_z = z[F].mean(1)
    keep = (z[F] > 0.06).all(1)
    order = np.argsort(-tri_z)
    keep = keep[order]
    tri_px = tri_px[order]
    tri_z = tri_z[order]
    Cf = C[order]

    # flat shading from world-space normals
    v0, v1, v2 = V[F[order, 0]], V[F[order, 1]], V[F[order, 2]]
    n = np.cross(v1 - v0, v2 - v0)
    ln = np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
    n = n / ln
    light = np.array([0.35, -0.5, 0.8]); light /= np.linalg.norm(light)
    lam = np.abs(n @ light)
    shade = 0.42 + 0.58 * lam
    if fog > 0:
        shade *= np.clip(1.0 - (tri_z - 3.0) * fog, 0.25, 1.0)
    face_col = np.clip(Cf * shade[:, None], 0, 1)

    polys = tri_px[keep]
    fig = plt.figure(figsize=(W / 100, H / 100), dpi=100)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 1); ax.set_ylim(0, 1); ax.axis("off")
    ax.add_collection(PolyCollection(polys, facecolors=face_col[keep],
                                     edgecolors=face_col[keep] * 0.75, linewidths=0.15))
    fig.savefig(out)
    plt.close(fig)
    print("wrote", out, f"({keep.sum()} tris)")


def main():
    glb = sys.argv[1]
    outdir = Path(sys.argv[2]); outdir.mkdir(parents=True, exist_ok=True)
    scene = trimesh.load(glb)
    V, F, C = gather(scene)
    print("verts", len(V), "faces", len(F))
    views = {
        "1_corridor":     ((-6.0, 1.25, 1.7), (3.0, 1.25, 1.45)),
        "2_cell_gate":    ((2.0, -2.7, 1.55), (2.0, 0.2, 1.35)),
        "3_cell_ceiling": ((2.0, -1.4, 1.3), (1.4, -0.4, 2.95)),
        "4_corridor_gate":((3.7, 1.95, 1.5), (1.7, 0.0, 1.3)),
        "5_overview":     ((-4.5, 7.5, 6.5), (1.0, -0.5, 1.2)),
    }
    for name, (cam, look) in views.items():
        render(V, F, C, cam, look, str(outdir / f"{name}.png"), fog=0.02)


if __name__ == "__main__":
    main()
