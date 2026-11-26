#!/usr/bin/env python3
"""Generate per-chunk Kaggle kernel dirs (worker.py + kernel-metadata.json).

  SHOT=overpass python3 gen.py validate titusomiles   # stills + a 1-frame render
  SHOT=overpass python3 gen.py chunks titusomiles     # every chunk
  SHOT=overpass python3 gen.py chunks titusomiles 1 4 # chunks 1..4 (1-based)

The frame range comes from the baked `sim.json` (240 frames -> 9 chunks of 27),
so switching shots needs no edit here.  Kernel metadata points at
<account>/physics-demo, so that private dataset must already contain the package
(see tools/kaggle/README.md).
"""
import json
import math
import os
import pathlib
import sys

here = pathlib.Path(__file__).resolve().parent
tpl = (here / 'worker_template.py').read_text()

shot = os.environ.get('SHOT', 'bridge')

# frame count from the bake, falling back to 270
frames = None
for cand in (here.parent.parent / 'out' / shot / 'sim.json',
             here.parent.parent / 'remotion' / 'public' / shot / 'sim.json'):
    if cand.exists():
        frames = int(json.load(open(cand)).get('frames', 0)) or None
        break
frames = frames or 270

STEP = 27
count = max(1, math.ceil(frames / STEP))
CHUNKS = [(i * STEP, min(frames - 1, (i + 1) * STEP - 1)) for i in range(count)]


def write(dirname, account, start, end, validate=False, out=None):
    d = here / 'kernels' / dirname
    d.mkdir(parents=True, exist_ok=True)
    out = out or ('%s-%04d-%04d' % (shot, start, end))
    src = (tpl.replace('__START__', str(start))
              .replace('__END__', str(end))
              .replace('__FRAMES__', str(frames))
              .replace('__OUT__', out)
              .replace('__SHOT__', shot)
              .replace('__VALIDATE__', 'True' if validate else 'False'))
    (d / 'worker.py').write_text(src)
    meta = {
        'id': '%s/%s' % (account, dirname),
        'title': dirname.replace('-', ' '),
        'code_file': 'worker.py',
        'language': 'python',
        'kernel_type': 'script',
        'is_private': True,
        'enable_gpu': False,
        'enable_tpu': False,
        'enable_internet': True,
        'keywords': [],
        'dataset_sources': ['%s/physics-demo' % account],
        'kernel_sources': [],
        'competition_sources': [],
        'model_sources': [],
    }
    (d / 'kernel-metadata.json').write_text(json.dumps(meta, indent=1) + '\n')
    print(d)


mode = sys.argv[1] if len(sys.argv) > 1 else 'chunks'
account = sys.argv[2] if len(sys.argv) > 2 else 'titusomiles'
print('shot %s, %d frames -> %d chunks' % (shot, frames, count))
if mode == 'validate':
    write('physics-validate', account, 0, 0, validate=True, out='validate')
else:
    lo = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    hi = int(sys.argv[4]) if len(sys.argv) > 4 else count
    for i in range(lo, hi + 1):
        s, e = CHUNKS[i - 1]
        write('physics-chunk-%d' % i, account, s, e)