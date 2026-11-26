# Kaggle render farm

Renders a baked shot as video in parallel chunks on Kaggle's free CPU sessions
(5 at a time per account), then stitches the H.264 chunks with `-c copy` so no
frame is re-encoded.

## 1. Stage the project as a private dataset

Kaggle kernels only see `/kaggle/input`, so upload the Remotion package plus the
baked shot as a dataset (one per account — private datasets are not shared):

```
dist/
  package.json  package-lock.json  tsconfig.json  remotion.config.ts
  src/debris.mjs  src/debris.d.mts
  remotion/src/index.ts  remotion/src/Root.tsx  remotion/src/Destruction.tsx
  remotion/public/bridge/{debris.glb,sim.json,motion.bin,shot.json}
  dataset-metadata.json      # {"title":"…","id":"<account>/physics-demo",
                             #  "licenses":[{"name":"CC0-1.0"}]}
```

```bash
kaggle datasets create  -p dist -r zip                  # first upload
kaggle datasets version -p dist -r zip -m "new shot"    # every change
```

## 2. Push chunk kernels

`gen.py` writes `kernels/physics-chunk-<n>/{worker.py,kernel-metadata.json}` for
10 non-overlapping 27-frame slices of a 270-frame shot (edit `CHUNKS` for other
lengths). Kernel metadata already points at `<account>/physics-demo`.

```bash
python3 tools/kaggle/gen.py validate <account>        # stills + 1-frame smoke test
python3 tools/kaggle/gen.py chunks <account> 1 4      # push with: kaggle kernels push -p kernels/physics-chunk-1
python3 tools/kaggle/gen.py chunks <account> 5 10     # once slots free up
```

Per session the worker installs Chromium's system libraries, runs
`npm install` + `remotion browser ensure`, and renders with `--gl=angle-egl`,
falling back to `--gl=swangle` (patched with `--enable-unsafe-swiftshader` on
GPU-less machines). It prints a `RESULT {...}` line with `ok`, `shaderErrors`
and the output size, then deletes half a gigabyte of `node_modules`.

Watch the quota: `Maximum batch CPU session count of 5 reached` means another
account (or older work) is still holding sessions.

## 3. Fetch and stitch

```bash
for n in $(seq 1 10); do
  kaggle kernels output <account>/physics-chunk-$n -p out/c$n
done

for n in $(seq 1 10); do echo "file $PWD/out/c$n/$(ls out/c$n/*.mp4)" >> list.txt; done
ffmpeg -f concat -safe 0 -i list.txt -c copy bridge.mp4
```

Verify `frame= 270` and `Duration: 00:00:09.00` before publishing, then:

```bash
node tools/publish_video.mjs --video bridge.mp4 --stills out --poster frame-108.png
```

## Gotchas

- The first frame of a render is captured the instant every `delayRender` handle
  is released — `Destruction.tsx` draws once (`gl.render`) before continuing, or
  stills and chunk starts come out as empty sky.
- `THREE.ShaderLib.depth` only contains `<beginnormal_vertex>` inside
  `#ifdef USE_DISPLACEMENTMAP`; a shader patch anchored there compiles out and
  the debris stops moving. The lookup is declared at the top of `main()` instead.
- Kaggle's home disk is small (Cloud Shell: 5 GB, often ~97% full). Stage in
  `/tmp`, and keep `dataset-metadata.json` named exactly that.