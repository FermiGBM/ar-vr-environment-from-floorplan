#!/usr/bin/env python3
"""Download CC0 PBR sets (1K JPEG) from Poly Haven for the jail-cell rebuild.

Each material gets three maps:
  diff.jpg  albedo / base color
  nor.jpg   normal (OpenGL, +Y up -> glTF)
  arm.jpg   AO(R) + Roughness(G) + Metalness(B)  -> serves both occlusionTexture
            and metallicRoughnessTexture
"""
import json
import os
import urllib.request

UA = {'User-Agent': 'Mozilla/5.0'}
OUT = os.path.expanduser('~/arvr-test/pbr')

SETS = {
    'stone':     'medieval_blocks_02',   # big ashlar blocks (walls)
    'brick':     'castle_brick_02_red',  # red brick (piers / far wall patch)
    'wood':      'plank_flooring',       # planks (ceiling, bed, doors)
    'tile_cor':  'brown_floor_tiles',    # warm corridor tiles
    'tile_cell': 'blue_floor_tiles_01',  # bluish cell tiles
    'metal':     'metal_plate',          # scratched steel (bars, hardware)
    'plaster':   'grey_plaster',         # far corridor wall
}


def get(u):
    return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=180).read()


def main():
    d = json.loads(get('https://api.polyhaven.com/assets?t=textures'))
    os.makedirs(OUT, exist_ok=True)
    for name, slug in SETS.items():
        if slug not in d:
            print('MISSING', name, slug)
            continue
        f = json.loads(get(f'https://api.polyhaven.com/files/{slug}'))
        dst = os.path.join(OUT, name)
        os.makedirs(dst, exist_ok=True)
        got = []
        for mm, short in (('Diffuse', 'diff'), ('nor_gl', 'nor'), ('arm', 'arm')):
            try:
                url = f[mm]['1k']['jpg']['url']
            except Exception:
                print('  no map', mm, 'for', name)
                continue
            raw = get(url)
            with open(os.path.join(dst, short + '.jpg'), 'wb') as fh:
                fh.write(raw)
            got.append((short, len(raw)))
        print(name, slug, got)


if __name__ == '__main__':
    main()
