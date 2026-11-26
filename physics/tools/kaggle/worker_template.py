# Bridge/overpass demolition chunk render worker (Kaggle CPU).
# Render frames __START__-__END__ of the __SHOT__ shot to /kaggle/working/__OUT__.mp4
# with ANGLE-EGL and a SwiftShader fallback.  __VALIDATE__ renders diagnostic
# stills across the whole clip first.
import glob, json, os, shutil, subprocess, time

START, END = __START__, __END__
OUT = "__OUT__"
SHOT = "__SHOT__"
FRAMES = __FRAMES__
VALIDATE = __VALIDATE__
PROPS = '--props=' + json.dumps(json.dumps({'shot': SHOT}))
PUB = 'remotion/public/%s' % SHOT


def sh(cmd, check=False, cwd=None):
    print('$', cmd[:190], flush=True)
    r = subprocess.run(cmd, shell=True, cwd=cwd)
    if check and r.returncode:
        raise SystemExit('failed (%d): %s' % (r.returncode, cmd))
    return r


print('=== env ===', flush=True)
sh('nproc; free -g | head -2; (nvidia-smi -L 2>/dev/null || echo no-gpu); '
   'ls /usr/lib/x86_64-linux-gnu/libEGL.so.1 2>/dev/null || echo no-libEGL')

print('=== system libs ===', flush=True)
sh('apt-get -qq update')
LIBS = [
    'libegl1 libgbm1 libnss3 libasound2t64 libxdamage1 libxrandr2 libatk1.0-0 '
    'libatk-bridge2.0-0 libcups2 libpango-1.0-0 libxkbcommon0 libxcomposite1 '
    'libxfixes3 libdrm2 fontconfig ffmpeg',
    'libegl1 libgbm1 libnss3 libasound2 libxdamage1 libxrandr2 libatk1.0-0 '
    'libatk-bridge2.0-0 libcups2 libpango-1.0-0 libxkbcommon0 libxcomposite1 '
    'libxfixes3 libdrm2 fontconfig ffmpeg',
]
for g in LIBS:
    if sh('apt-get -qq install -y ' + g + ' > /dev/null 2>&1').returncode == 0:
        break

print('=== node ===', flush=True)
sh('node -v || (curl -fsSL https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.xz '
   '-o /tmp/node.tar.xz && mkdir -p /opt/node && tar -xJf /tmp/node.tar.xz -C /opt/node '
   '--strip-components=1 && ln -sf /opt/node/bin/node /usr/local/bin/node && '
   'ln -sf /opt/node/bin/npm /usr/local/bin/npm && ln -sf /opt/node/bin/npx /usr/local/bin/npx)')

print('=== project ===', flush=True)
cands = sorted(glob.glob('/kaggle/input/**/package.json', recursive=True), key=lambda p: p.count('/'))
ENG = None
for p in cands:
    try:
        j = json.load(open(p))
    except Exception:
        continue
    if 'remotion' in json.dumps(j) and os.path.isdir(os.path.join(os.path.dirname(p), 'remotion', 'public')):
        ENG = os.path.dirname(p)
        break
if ENG is None:
    raise SystemExit('no remotion package.json under /kaggle/input')
WORK = '/kaggle/working/eng'
shutil.rmtree(WORK, ignore_errors=True)
os.makedirs(WORK, exist_ok=True)
sh('cp -a "%s/." "%s/"' % (ENG, WORK), check=True)
ENG = WORK
print('project:', ENG, flush=True)
sh('ls -la %s' % PUB, cwd=ENG)
ASSETS = ('debris.glb', 'sim.json', 'motion.bin')
sizes = {f: os.path.getsize(os.path.join(ENG, PUB, f)) for f in ASSETS}
if sizes['debris.glb'] < 1_000_000:
    raise SystemExit('broken dataset payload: %r' % sizes)

print('=== npm install ===', flush=True)
sh('npm install --no-audit --no-fund', cwd=ENG, check=True)
sh('npx remotion browser ensure', cwd=ENG, check=True)

print('=== patch software webgl ===', flush=True)
PATCH = r'''
import glob, re
files = glob.glob('/kaggle/working/eng/node_modules/@remotion/renderer/dist/open-browser.js')
if not files:
    print('open-browser.js not found'); raise SystemExit(0)
f = files[0]; src = open(f).read(); FLAG = '--enable-unsafe-swiftshader'
if FLAG in src:
    print('already patched'); raise SystemExit(0)
new = re.sub(r"(\['--use-gl=angle',\s*'--use-angle=swiftshader')(\s*\])", r"\1, '" + FLAG + r"'\2", src)
if new == src:
    print('WARNING: swangle branch not found')
else:
    open(f, 'w').write(new); print('patched swangle branch')
'''
open('/tmp/patch.py', 'w').write(PATCH)
sh('python3 /tmp/patch.py', cwd=ENG)

print('=== dependency check ===', flush=True)
sh("node -e \"console.log('three', require('three/package.json').version)\"", cwd=ENG)
sh("node --input-type=module -e \"import * as THREE from 'three';"
   "const p=THREE.ShaderLib.physical.vertexShader, d=THREE.ShaderLib.depth.vertexShader;"
   "console.log('REV',THREE.REVISION);"
   "console.log('physical', p.includes('#include <begin_vertex>'), p.includes('#include <beginnormal_vertex>'));"
   "console.log('depth', d.includes('#include <begin_vertex>'), d.includes('#include <beginnormal_vertex>'));\"",
   cwd=ENG)

if VALIDATE:
    print('=== diagnostic stills ===', flush=True)
    for fr in (0, FRAMES // 2, FRAMES - 1):
        p = '/kaggle/working/still-%03d.png' % fr
        sh('npx remotion still remotion/src/index.ts DestructionBridge '
           '%s --frame=%d %s --gl=angle-egl --log=error' % (p, fr, PROPS), cwd=ENG)
        print('still', fr, os.path.getsize(p) if os.path.exists(p) else 'MISSING', flush=True)

print('=== render chunk %d-%d ===' % (START, END), flush=True)
out = '/kaggle/working/%s.mp4' % OUT
if os.path.exists(out):
    os.remove(out)
LOG = '/kaggle/working/render.log'
base = ('npx remotion render remotion/src/index.ts DestructionBridge %s --frames=%d-%d %s '
        '--concurrency=4 --log=error --timeout=900000 --public-dir=remotion/public') % (out, START, END, PROPS)
t0 = time.time()
sh('( %s --gl=angle-egl ) > %s 2>&1 || ( echo "[retry swangle]" >> %s; %s --gl=swangle >> %s 2>&1 )'
   % (base, LOG, LOG, base, LOG), cwd=ENG)
r = subprocess.run("grep -c 'undeclared identifier' %s || true" % LOG,
                   shell=True, capture_output=True, text=True)
nerr = int((r.stdout or '0').strip() or 0)
print('shader-errors:', nerr, flush=True)
sh("grep -m4 -E 'ERROR: 0:|Shader Error|Cannot|Error' %s || true" % LOG)
print('RESULT', json.dumps({
    'out': OUT, 'start': START, 'end': END, 'seconds': round(time.time() - t0, 1),
    'ok': os.path.exists(out) and nerr == 0, 'shaderErrors': nerr,
    'bytes': os.path.getsize(out) if os.path.exists(out) else 0,
}), flush=True)

sh('rm -rf /kaggle/working/eng', cwd='/kaggle/working')
sh('ls -lh /kaggle/working/*.mp4 /kaggle/working/*.png 2>/dev/null || true')
print('=== done ===', flush=True)
