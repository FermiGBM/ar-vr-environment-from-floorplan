import heapq

def nav_grid(sb, res=168):
    """Rasterised walkability in trimesh XY (Z is up). 1 = blocked, 0 = walkable."""
    if sb.get("walk_bounds"):
        minx, miny, maxx, maxy = [float(v) for v in sb["walk_bounds"]]
    elif sb["rooms"]:
        minx = min(r["bounds"][0] for r in sb["rooms"])
        miny = min(r["bounds"][1] for r in sb["rooms"])
        maxx = max(r["bounds"][2] for r in sb["rooms"])
        maxy = max(r["bounds"][3] for r in sb["rooms"])
    else:
        minx, miny, maxx, maxy = -5.0, -5.0, 5.0, 5.0
    minx -= 0.35; miny -= 0.35; maxx += 0.35; maxy += 0.35
    cell = (maxx - minx) / float(res - 1)
    plan = sb.get("plan", {})
    mask = plan.get("walls_mask")
    mpp = float(plan.get("mpp") or 0.0)
    H = int(plan.get("H") or 0)
    feet = [(it["position"][0], it["position"][1], it["size"][0], it["size"][1])
            for it in sb["furniture"]]
    rows = []
    for j in range(res):
        y = miny + j * cell
        line = []
        for i in range(res):
            x = minx + i * cell
            blocked = False
            if mask is not None and mpp > 0:
                px, py = int(round(x / mpp)), int(round(H - y / mpp))
                if not (0 <= px < mask.shape[1] and 0 <= py < mask.shape[0]) or mask[py, px] > 0:
                    blocked = True
            elif sb.get("walk_bounds"):
                wx0, wy0, wx1, wy1 = sb["walk_bounds"]
                if not (wx0 <= x <= wx1 and wy0 <= y <= wy1):
                    blocked = True
            if not blocked:
                for fx, fy, fw, fd in feet:
                    if fx - 0.12 <= x <= fx + fw + 0.12 and fy - 0.12 <= y <= fy + fd + 0.12:
                        blocked = True
                        break
            line.append("1" if blocked else "0")
        rows.append("".join(line))
    return {"min": [round(minx, 4), round(miny, 4)], "cell": round(cell, 5),
            "rows": res, "cols": res, "blocked": rows}


def free_spot(nav, wanted):
    """Nearest walkable point to a desired spawn, with a little clearance."""
    minx, miny = nav["min"]
    cell = nav["cell"]
    grid = nav["blocked"]
    cols, rows = nav["cols"], nav["rows"]

    def walkable(i, j):
        return (0 <= i < cols and 0 <= j < rows and grid[j][i] == "0")

    ci = int(round((wanted[0] - minx) / cell))
    cj = int(round((wanted[1] - miny) / cell))
    best = None
    for r in range(0, 22):
        for dj in range(-r, r + 1):
            for di in range(-r, r + 1):
                i, j = ci + di, cj + dj
                if not walkable(i, j):
                    continue
                if not all(walkable(i + a, j + b) for a, b in
                           [(-2, 0), (2, 0), (0, -2), (0, 2), (2, 2), (-2, -2)]):
                    continue
                p = [minx + i * cell, miny + j * cell]
                dist = (p[0] - wanted[0]) ** 2 + (p[1] - wanted[1]) ** 2
                if best is None or dist < best[0]:
                    best = (dist, p)
        if best is not None:
            break
    return best[1] if best else [float(wanted[0]), float(wanted[1])]


def _nav_cell(nav, x, y):
    return (int(round((x - nav["min"][0]) / nav["cell"])),
            int(round((y - nav["min"][1]) / nav["cell"])))


def _nav_free(nav, i, j):
    return (0 <= i < nav["cols"] and 0 <= j < nav["rows"] and nav["blocked"][j][i] == "0")


def _segment_free(nav, a, b):
    n = max(2, int(math.hypot(b[0]-a[0], b[1]-a[1]) / (nav["cell"] * 0.6)))
    for t in np.linspace(0, 1, n):
        i, j = _nav_cell(nav, a[0] + (b[0]-a[0]) * t, a[1] + (b[1]-a[1]) * t)
        if not _nav_free(nav, i, j):
            return False
    return True


def _astar(nav, a, b):
    """Route between two points on the walkability grid (8-neighbour A*)."""
    start, goal = _nav_cell(nav, *a), _nav_cell(nav, *b)
    if start == goal:
        return [list(a), list(b)]
    heap = [(0.0, start)]
    came, cost = {}, {start: 0.0}
    dirs = [(1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)]
    while heap:
        _, cur = heapq.heappop(heap)
        if cur == goal:
            break
        for di, dj in dirs:
            nxt = (cur[0]+di, cur[1]+dj)
            if not _nav_free(nav, *nxt):
                continue
            if di and dj and not (_nav_free(nav, cur[0]+di, cur[1]) and
                                  _nav_free(nav, cur[0], cur[1]+dj)):
                continue                                   # no cutting corners
            step = math.hypot(di, dj)
            g = cost[cur] + step
            if g < cost.get(nxt, 1e18):
                cost[nxt], came[nxt] = g, cur
                heapq.heappush(heap, (g + math.hypot(goal[0]-nxt[0], goal[1]-nxt[1]), nxt))
    if goal not in came:
        return [list(a), list(b)]
    chain, cur = [goal], goal
    while cur != start:
        cur = came[cur]
        chain.append(cur)
    chain.reverse()
    pts = [[nav["min"][0] + i*nav["cell"], nav["min"][1] + j*nav["cell"]] for i, j in chain]
    return [list(a)] + pts[4:-4:4] + [list(b)]


def _simplify(nav, pts):
    """String-pull the A* route: keep only corners that are actually needed."""
    out = [pts[0]]
    i = 0
    while i < len(pts) - 1:
        j = len(pts) - 1
        while j > i + 1 and not _segment_free(nav, pts[i], pts[j]):
            j -= 1
        out.append(pts[j])
        i = j
    return out


def _catmull(p0, p1, p2, p3, t):
    return 0.5 * ((2 * p1) + (-p0 + p2) * t +
                  (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
                  (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)


def build_camera_paths(sb, spawn_xy, nav=None, frames=360, per_leg=8):
    """A looping subject path plus a camera that trails it. Coordinates are trimesh
    (X, Y, Z-up); the viewer / Remotion convert with (x, y, z) -> (x, z, -y)."""
    if sb["rooms"]:
        way = sorted(sb["rooms"], key=lambda r: -r["area"])
        pts = [[(r["bounds"][0] + r["bounds"][2]) / 2,
                (r["bounds"][1] + r["bounds"][3]) / 2] for r in way[:6]]
    else:
        pts = [[z["position"][0], z["position"][1]] for z in sb["zones"]]
        pts += [[-2.2, 0.0], [2.2, 0.0]]
    if len(pts) < 3:
        cx, cy = spawn_xy
        r = 2.0
        pts = [[cx + r * math.cos(a), cy + r * math.sin(a)]
               for a in np.linspace(0, 2 * math.pi, 8, endpoint=False)]
    if nav is not None:                       # route through doorways, never through walls
        safe = [free_spot(nav, p) for p in pts]
        routed = []
        for k in range(len(safe)):
            seg = _astar(nav, safe[k], safe[(k + 1) % len(safe)])
            routed += _simplify(nav, seg)[:-1]
        if len(routed) >= 3:
            pts = routed
    loop = []
    n = len(pts)
    for i in range(n):
        p0, p1 = np.array(pts[(i - 1) % n], float), np.array(pts[i], float)
        p2, p3 = np.array(pts[(i + 1) % n], float), np.array(pts[(i + 2) % n], float)
        for s in range(per_leg):
            t = s / float(per_leg)
            loop.append([float(_catmull(p0[k], p1[k], p2[k], p3[k], t)) for k in (0, 1)])
    m = len(loop)
    subject, camera = [], []
    for i, (x, y) in enumerate(loop):
        nxt = np.array(loop[(i + 1) % m], float)
        prv = np.array(loop[(i - 1) % m], float)
        tan = nxt - prv
        ln = float(np.linalg.norm(tan)) + 1e-6
        tan /= ln
        lag = loop[(i - max(1, m // 40)) % m]
        sx, sy = x, y
        if nav is not None and not _nav_free(nav, *_nav_cell(nav, sx, sy)):
            sx, sy = free_spot(nav, (sx, sy))    # smooth curve may clip a corner
        subject.append({"frame": int(round(i * frames / m)) % frames,
                        "position": [round(sx, 3), round(sy, 3), 0.35],
                        "look_at": [round(x + tan[0], 3), round(y + tan[1], 3), 0.6]})
        cx, cy = sx - tan[0] * 2.3 - tan[1] * 0.6, sy - tan[1] * 2.3 + tan[0] * 0.6
        if nav is not None and not _nav_free(nav, *_nav_cell(nav, cx, cy)):
            for back, side in [(1.7, 0.4), (1.1, 0.3), (0.5, 0.0), (0.0, 0.0)]:
                tx = sx - tan[0] * back - tan[1] * side
                ty = sy - tan[1] * back + tan[0] * side
                if _nav_free(nav, *_nav_cell(nav, tx, ty)):
                    cx, cy = tx, ty
                    break
        camera.append({"frame": int(round(i * frames / m)) % frames,
                       "position": [round(cx, 3), round(cy, 3), 1.65],
                       "look_at": [round(lag[0], 3), round(lag[1], 3), 0.95]})
    return {"subject": subject, "camera": camera, "frames": frames}


def export_scene(sb, scene_id):
    scene = trimesh.Scene()
    for kind, room_id, m in sb["meshes"]:
        base = f"{kind}_{room_id}" if room_id is not None else kind
        scene.add_geometry(m, node_name=f"{base}_{len(scene.geometry)}")
    scene.metadata["axis"] = "z-up"          # glTF is Y-up; viewer/Remotion rotate -90deg X
    glb = OUT / "3d" / f"scene_{scene_id}.glb"
    scene.export(str(glb))
    try:
        gdir = OUT / "3d" / "gltf"               # keep the multi-buffer glTF tidy in a subdir
        gdir.mkdir(parents=True, exist_ok=True)
        scene.export(str(gdir / f"scene_{scene_id}.gltf"))
    except Exception as e:
        print("  (gltf export skipped:", e, ")")

    nav = nav_grid(sb)
    wanted = sb.get("spawn", {}).get("position")
    if wanted is None and sb["rooms"]:
        r = max(sb["rooms"], key=lambda r: r["area"])
        wanted = [(r["bounds"][0] + r["bounds"][2]) / 2,
                  (r["bounds"][1] + r["bounds"][3]) / 2]
    elif wanted is None:
        wanted = [0.0, 0.0]
    sx, sy = free_spot(nav, wanted[:2])
    spawn = {"position": [round(sx, 3), round(sy, 3), 1.65], "yaw": float(sb.get("spawn", {}).get("yaw", 0.0))}

    if sb.get("zones"):
        zones = [{"name": z["name"], "position": [round(v, 3) for v in z["position"]]}
                 for z in sb["zones"]]
    else:
        zones = [{"name": r["type"] + "_" + str(r["id"]),
                  "position": [round((r["bounds"][0] + r["bounds"][2]) / 2, 3),
                               round((r["bounds"][1] + r["bounds"][3]) / 2, 3), 1.65]}
                 for r in sb["rooms"]]

    paths = build_camera_paths(sb, (sx, sy), nav=nav)
    bounds = scene.bounds.tolist() if scene.bounds is not None else [[0, 0, 0], [0, 0, 0]]
    meta = {
        "scene_id": scene_id,
        "kind": sb.get("kind", "plan"),
        "source": Path(sb["plan"]["path"]).name,
        "scale_m_per_px": sb["plan"]["mpp"],
        "axis": "z-up",
        "axis_note": "trimesh coordinates; convert to three.js with (x, y, z) -> (x, z, -y)",
        "bounds_m": bounds,
        "textures": sorted(TEX.keys()) if sb.get("kind", "plan") == "plan" else ["photo (embedded)"],
        "depth_method": sb.get("depth_method"),
        "detail": {"wall_height_m": WALL_H, "floor_thickness_m": FLOOR_T,
                   "baseboards": True, "multi_part_furniture": True,
                   "walkable": True, "explorable": True},
        "rooms": [{"id": r["id"], "type": r["type"], "area_m2": round(r["area"], 2),
                   "bounds": [round(x, 3) for x in r["bounds"]]} for r in sb["rooms"]],
        "furniture": [{"type": it["type"], "room_id": it["room_id"], "size": it["size"],
                       "position": [round(v, 3) for v in it["position"]]} for it in sb["furniture"]],
        "spawn": spawn,
        "zones": zones,
        "nav_grid": nav,
        "interaction_points": [{"id": "zone_" + z["name"].replace(" ", "_"), "type": "zone",
                                "position": z["position"], "actions": ["enter", "teleport"]}
                               for z in zones],
        "camera_paths": {"subject": paths["subject"], "camera": paths["camera"]},
        "camera_settings": {"fps": 30, "frames": paths["frames"], "loop": True,
                            "interpolation": "catmull-rom",
                            "trailing": {"position_lag_m": 2.3, "look_at_lag_frames": 9,
                                         "smoothing": 0.14}},
        "lighting": {"ambient": 0.6, "directional": 1.4, "shadows": True},
        "physics": {"gravity": [0, 0, -9.81], "collision": "nav-grid + aabb",
                    "solver": "settle-and-separate", "iterations": 80,
                    "eye_height_m": 1.65, "radius_m": 0.28},
    }
    (OUT / "3d" / f"scene_{scene_id}.json").write_text(json.dumps(meta, indent=2))
    path_file = OUT / "3d" / f"camera_path_{scene_id}.json"
    path_file.write_text(json.dumps({
        "version": 1, "axis": "z-up", "fps": 30, "frames": paths["frames"], "loop": True,
        "interpolation": "catmull-rom", "settings": meta["camera_settings"]["trailing"],
        "subject_path": paths["subject"], "camera_path": paths["camera"]}, indent=2))
    return glb, meta

exports = [export_scene(sb, i + 1) for i, sb in enumerate(scene_builds)]
for glb, meta in exports:
    print(f"  exported {glb.name}  ({glb.stat().st_size/1024:.0f} KB)  "
          f"{len(meta['rooms'])} rooms, {len(meta['furniture'])} items, "
          f"{len(meta['camera_paths']['camera'])} camera keys")
