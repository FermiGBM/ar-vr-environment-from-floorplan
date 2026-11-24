# Runs only when USE_PHOTO is true (the image is not a floor plan).
# The result is not a flat relief: we build a walkable room around the image,
# use its depth as a displaced backdrop, and furnish it with collision-ready props.
_MODEL_CACHE = {}

def estimate_depth(img_bgr):
    """Monocular depth. Tries Depth-Anything V2 (small) via transformers; falls back to a
    classical pseudo-depth when torch/transformers are unavailable (no internet, no GPU)."""
    rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    if HAS_TORCH:
        try:
            from transformers import pipeline
            from PIL import Image as _Image
            pipe = _MODEL_CACHE.get("depth")
            if pipe is None:
                pipe = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf")
                _MODEL_CACHE["depth"] = pipe
            out = pipe(_Image.fromarray(rgb))
            d = np.asarray(out["depth"], dtype=np.float32)
            d = (d - d.min()) / (float(np.ptp(d)) + 1e-6)      # 0..1, 1 = nearest
            return d, "depth-anything-v2-small"
        except Exception as e:
            print("  depth model unavailable:", type(e).__name__, "-> classical pseudo-depth")
    else:
        print("  torch not available -> classical pseudo-depth "
              "(enable Internet and install torch for a real depth model)")
    g = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    g = cv2.GaussianBlur(g, (0, 0), 3.0)
    d = 1.0 - g                                                # darker = nearer (a rough guess)
    d = (d - d.min()) / (float(np.ptp(d)) + 1e-6)
    return d, "pseudo-depth (luminance)"


def _panel_mesh(rgb, depth, width, height, plane="vertical", max_side=256, relief=0.22,
                name="photo_backdrop"):
    """A textured, depth-displaced image panel.
    vertical   : spans X x Z, depth pushes along Y (into the room when push=-1).
    horizontal : spans X x Y, depth pushes along Z (down when push=-1).
    The caller places the returned mesh by translation."""
    H0, W0 = depth.shape[:2]
    s = min(1.0, max_side / max(H0, W0))
    W, H = max(8, int(round(W0 * s))), max(8, int(round(H0 * s)))
    img = cv2.resize(rgb, (W, H), interpolation=cv2.INTER_AREA)
    d = cv2.resize(depth, (W, H), interpolation=cv2.INTER_LINEAR)
    d = cv2.GaussianBlur(d, (0, 0), 1.0)
    xs = np.linspace(-width / 2, width / 2, W)
    vs = np.linspace(-height / 2, height / 2, H)
    X, V = np.meshgrid(xs, vs)
    disp = (d - 0.5) * relief
    if plane == "vertical":
        verts = np.column_stack([X.ravel(), disp.ravel(), V.ravel()])
    else:
        verts = np.column_stack([X.ravel(), V.ravel(), disp.ravel()])
    idx = np.arange(H * W).reshape(H, W)
    a, b = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel()
    c, e = idx[1:, :-1].ravel(), idx[1:, 1:].ravel()
    faces = np.vstack([np.column_stack([a, b, e]), np.column_stack([a, e, c])])
    U, VV = np.meshgrid(np.linspace(0, 1, W), np.linspace(0, 1, H))
    mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
    mat = PBRMaterial(name=name, baseColorTexture=Image.fromarray(img),
                      baseColorFactor=[1.0, 1.0, 1.0, 1.0],
                      metallicFactor=0.0, roughnessFactor=0.92)
    mesh.visual = TextureVisuals(uv=np.column_stack([U.ravel(), VV.ravel()]), material=mat)
    return mesh


def _band_color(img_bgr, y0, y1):
    """Median RGB of a horizontal band of the source image."""
    h, w = img_bgr.shape[:2]
    crop = img_bgr[int(h * y0):max(int(h * y0) + 1, int(h * y1))]
    small = cv2.resize(crop, (32, 32), interpolation=cv2.INTER_AREA)
    return (np.median(small.reshape(-1, 3), axis=0)[::-1] / 255.0).tolist()


def _photo_prop_seeds(img_bgr, depth, k=5):
    """Find near / distinct blobs in the image: cheap stand-ins for semantic objects."""
    h, w = depth.shape[:2]
    d = cv2.resize(depth, (96, 96), interpolation=cv2.INTER_AREA)
    near = (d > np.percentile(d, 62)).astype(np.uint8) * 255
    near[:int(96 * 0.22), :] = 0        # ignore ceiling band
    near[int(96 * 0.94):, :] = 0
    near = cv2.morphologyEx(near, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    near = cv2.morphologyEx(near, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    n, lab, stats, cents = cv2.connectedComponentsWithStats(near, connectivity=8)
    seeds = []
    for i in range(1, n):
        area = int(stats[i, cv2.CC_STAT_AREA])
        if area < 70:
            continue
        u, v = float(cents[i][0]) / 96.0, float(cents[i][1]) / 96.0
        seeds.append({"u": u, "v": v, "area": area,
                      "bright": float(np.mean(cv2.resize(
                          cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY), (96, 96))[
                              int(v * 95), int(u * 95)])) / 255.0})
    seeds.sort(key=lambda s: -s["area"])
    return seeds[:k]


def build_photo_world(img_bgr, depth, method):
    """Turn one image + depth into an explorable room: shell, displaced photo walls,
    ceiling lights, image-derived props, spawn point and zones."""
    H0, W0 = img_bgr.shape[:2]
    room_w = float(np.clip(8.0 * (W0 / max(H0, 1)) ** 0.15, 6.5, 10.5))
    room_d = float(np.clip(6.5 + 2.0 * (0.5 - float(np.median(depth))), 5.5, 8.5))
    room_h = WALL_H
    rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    meshes = []

    def flat_box(extents, center, name, rgb_factor, rough=0.9):
        m = trimesh.creation.box(extents=extents)
        m.apply_translation(center)
        m.visual = TextureVisuals(material=PBRMaterial(
            name=name, baseColorFactor=[float(c) for c in rgb_factor] + [1.0],
            metallicFactor=0.0, roughnessFactor=rough))
        meshes.append((name, None, m))
        return m

    # --- walkable shell -------------------------------------------------------
    floor_rgb = _band_color(img_bgr, 0.72, 1.0)
    wall_rgb = _band_color(img_bgr, 0.25, 0.65)
    ceil_rgb = _band_color(img_bgr, 0.0, 0.20)
    flat_box([room_w, room_d, 0.12], [0, 0, -0.06], "photo_floor",
             [min(1, c * 1.05) for c in floor_rgb], 0.82)
    flat_box([room_w, room_d, 0.10], [0, 0, room_h + 0.05], "photo_ceiling",
             [min(1, c * 1.15 + 0.12) for c in ceil_rgb], 0.95)
    t = 0.12
    flat_box([room_w, t, room_h], [0, room_d / 2 - t / 2, room_h / 2],
             "wall_back", [min(1, c * 0.85 + 0.15) for c in wall_rgb])
    flat_box([room_w, t, room_h], [0, -room_d / 2 + t / 2, room_h / 2],
             "wall_front", [min(1, c * 0.85 + 0.15) for c in wall_rgb])
    flat_box([t, room_d, room_h], [-room_w / 2 + t / 2, 0, room_h / 2],
             "wall_left", [min(1, c * 0.85 + 0.15) for c in wall_rgb])
    flat_box([t, room_d, room_h], [room_w / 2 - t / 2, 0, room_h / 2],
             "wall_right", [min(1, c * 0.85 + 0.15) for c in wall_rgb])

    # --- the image itself, now geometry you can walk up to --------------------
    back = _panel_mesh(rgb, depth, room_w * 0.84, room_h * 0.88, "vertical",
                       name="photo_backdrop")
    back.apply_translation([0, room_d / 2 - 0.26, room_h / 2 + 0.02])
    meshes.append(("photo_backdrop", None, back))

    floor_band = rgb[int(H0 * 0.70):, :, :]
    depth_band = depth[int(H0 * 0.70):, :]
    fband = _panel_mesh(floor_band, depth_band, room_w * 0.84, 2.0, "horizontal",
                        relief=0.10, name="photo_floor_band")
    fband.apply_translation([0, room_d / 2 - 1.35, 0.075])
    meshes.append(("photo_floor_band", None, fband))

    ceil_band = rgb[:max(1, int(H0 * 0.18)), :, :]
    depth_ceil = depth[:max(1, int(H0 * 0.18)), :]
    cband = _panel_mesh(ceil_band, depth_ceil, room_w * 0.84, 1.6, "horizontal",
                        relief=0.08, name="photo_ceiling_band")
    cband.apply_translation([0, room_d / 2 - 1.15, room_h - 0.07])
    meshes.append(("photo_ceiling_band", None, cband))

    for i, lx in enumerate(np.linspace(-room_w / 3, room_w / 3, 3)):
        lamp = trimesh.creation.cylinder(radius=0.16, height=0.06, sections=24)
        lamp.apply_translation([float(lx), 0.0, room_h - 0.10])
        apply_flat(lamp, "white")
        meshes.append(("light", i, lamp))

    # --- props: image blobs become furniture, then the existing solver places it
    fbn = {name: fn for t in FURN.values() for name, _s, fn in t}
    sizes = {name: size for t in FURN.values() for name, size, _fn in t}
    seeds = _photo_prop_seeds(img_bgr, depth)
    prop_names = []
    for s in seeds:
        if s["bright"] > 0.72 and s["area"] < 300:
            name = "Shelf"
        elif s["area"] > 1400:
            name = "Sofa"
        elif s["bright"] < 0.35:
            name = "TvStand" if s["u"] > 0.5 else "Dresser"
        else:
            name = ["CoffeeTable", "Armchair", "Desk"][len(prop_names) % 3]
        prop_names.append(name)
        if len(prop_names) >= 5:
            break
    for name in ["Sofa", "CoffeeTable", "TvStand", "Armchair"]:
        if len(prop_names) >= 4:
            break
        prop_names.append(name)

    spawn = [0.0, -room_d / 2 + 1.0, 1.6]           # trimesh: X, Y, Z-up
    bounds = [-room_w / 2 + 0.35, -room_d / 2 + 0.9,
              room_w / 2 - 0.35, room_d / 2 - 0.7]
    pseudo_room = {"id": 0, "type": "living_room", "bounds": bounds}
    items = []
    for i, name in enumerate(prop_names):
        w, d, h = sizes.get(name, (1.0, 0.8, 0.8))
        seed = seeds[i] if i < len(seeds) else {"u": 0.5, "v": 0.6}
        px = (seed["u"] - 0.5) * room_w * 0.72
        py = room_d / 2 - 1.1 - seed["v"] * (room_d * 0.5)
        items.append({"type": name, "room_id": 0, "size": [w, d, h],
                      "position": [float(px - w / 2), float(py - d / 2)],
                      "_fn": fbn[name], "_room_type": "living_room"})
    items = solve_placement(items, [pseudo_room])
    for it in items:                                  # keep the spawn circle clear
        x, y = it["position"]
        w, d, _ = it["size"]
        if x - 0.45 < spawn[0] < x + w + 0.45 and y - 0.45 < spawn[1] < y + d + 0.45:
            maxy = bounds[3]
            it["position"][1] = min(maxy - d, spawn[1] + 1.3 + d)
    items = solve_placement(items, [pseudo_room])
    for it in items:
        for mesh, matname in it["_fn"](*it["size"]):
            x, y = it["position"]
            mesh.apply_translation([x + it["size"][0] / 2, y + it["size"][1] / 2, 0])
            if matname in TEX:
                apply_tex(mesh, matname, axis="xy")
            else:
                apply_flat(mesh, matname)
            meshes.append(("furniture", 0, mesh))

    zones = [
        {"name": "entry", "position": [0.0, -room_d / 2 + 1.2, 1.6]},
        {"name": "centre", "position": [0.0, 0.0, 1.6]},
        {"name": "feature wall", "position": [0.0, room_d / 2 - 2.0, 1.6]},
    ]
    print(f"  photo world: {room_w:.1f} x {room_d:.1f} x {room_h:.1f} m, "
          f"{len(items)} props, {len(meshes)} meshes ({method})")
    return {
        "kind": "photo", "plan": {"path": str(chosen), "mpp": 0.0,
                                  "room": {"w": room_w, "d": room_d, "h": room_h}},
        "rooms": [], "furniture": items, "meshes": meshes,
        "spawn": {"position": spawn, "yaw": 0.0}, "zones": zones,
        "walk_bounds": bounds, "depth_method": method,
        "depth": depth, "axis": "z-up",
    }

if USE_PHOTO:
    depth, method = estimate_depth(img0)
    cv2.imwrite(str(OUT / "visualizations" / "depth.png"), (depth * 255).astype(np.uint8))
    scene_builds.append(build_photo_world(img0, depth, method))
    print(f"  photo path: world built from {Path(chosen).name}")
else:
    print("(photo path skipped)")
