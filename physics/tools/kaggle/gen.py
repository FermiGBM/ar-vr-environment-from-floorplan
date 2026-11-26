#!/usr/bin/env python3
"""Generate per-chunk Kaggle kernel dirs (worker.py + kernel-metadata.json).

  python3 gen.py validate fermipro            # stills + a 1-frame render
  python3 gen.py chunks fermipro               # all 10 chunks on one account
  python3 gen.py chunks fermipro 1 4           # chunks 1..4 (1-based)

Kernel metadata points at <account>/physics-demo, so that private dataset must
already contain the package (see tools/kaggle/README.md).
"""
import json
import pathlib
import sys

here = pathlib.Path(__file__).resolve().parent
tpl = (here / 'worker_template.py').read_text()

# 270 frames split into 10 contiguous, non-overlapping slices
CHUNKS = [(0, 26), (27, 53), (54, 80), (81, 107), (108, 134),
          (135, 161), (162, 188), (189, 215), (216, 242), (243, 269)]


def write(dirname, account, start, end, validate=False, out=None):
    d = here / 'kernels' / dirname
    d.mkdir(parents=True, exist_ok=True)
    out = out or ('bridge-%04d-%04d' % (start, end))
    src = (tpl.replace('__START__', str(start))
              .replace('__END__', str(end))
              .replace('__OUT__', out)
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
account = sys.argv[2] if len(sys.argv) > 2 else 'fermipro'
if mode == 'validate':
    write('physics-validate', account, 0, 0, validate=True, out='validate')
else:
    lo = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    hi = int(sys.argv[4]) if len(sys.argv) > 4 else len(CHUNKS)
    for i in range(lo, hi + 1):
        s, e = CHUNKS[i - 1]
        write('physics-chunk-%d' % i, account, s, e)