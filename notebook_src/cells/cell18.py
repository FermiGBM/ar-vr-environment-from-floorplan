VIEWER = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>__TITLE__</title>
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:#0e1116;color:#e8eef7;
            font-family:system-ui,Arial,sans-serif}
  #hud{position:fixed;top:12px;left:12px;z-index:5;background:rgba(14,17,22,.82);
       padding:10px 14px;border-radius:10px;font-size:13px;line-height:1.55;max-width:340px}
  #hud b{color:#7fd1ff}
  .modes{display:flex;gap:6px;margin:8px 0 4px}
  button.mode{background:#223043;color:#d7e8ff;border:1px solid #3c587a;border-radius:6px;
              padding:5px 9px;cursor:pointer;font-size:12px}
  button.mode.active{background:#2f7fb8;border-color:#7fd1ff;color:#fff}
  #hint{color:#9bb0c8;font-size:12px}
  #cross{position:fixed;left:50%;top:50%;width:6px;height:6px;margin:-3px;border-radius:50%;
         background:#7fd1ff;opacity:.8;z-index:4;display:none}
  #label{position:fixed;bottom:12px;left:12px;z-index:5;background:rgba(14,17,22,.7);
         padding:6px 10px;border-radius:8px;font-size:12px;color:#9bb0c8}
  #touch{position:fixed;left:18px;bottom:64px;z-index:6;width:132px;height:132px;
         display:none;touch-action:none;user-select:none;-webkit-user-select:none}
  #stick{position:absolute;inset:0;border:2px solid rgba(127,209,255,.45);
         border-radius:50%;background:rgba(20,34,50,.55)}
  #knob{position:absolute;left:50%;top:50%;width:52px;height:52px;margin:-26px;
         border-radius:50%;background:rgba(127,209,255,.72);box-shadow:0 0 16px #2f7fb8}
  #jump{position:fixed;right:20px;bottom:72px;z-index:6;display:none;
         width:72px;height:72px;border-radius:50%;border:2px solid #3c587a;
         background:rgba(34,48,67,.86);color:#d7e8ff;font-size:13px;touch-action:none}
  @media (pointer: coarse){
    #touch,#jump{display:block}
    #hud{max-width:min(92vw,340px);font-size:12px}
    button.mode{padding:9px 12px;font-size:13px}
    #label{bottom:8px}
  }
</style>
</head>
<body>
<div id="hud">
  <b>__TITLE__</b><br/>rooms/zones: __ROOMS__ &nbsp;|&nbsp; objects: __ITEMS__ &nbsp;|&nbsp; depth: __DEPTH__
  <div class="modes">
    <button class="mode" id="m-walk">1 · Walk</button>
    <button class="mode active" id="m-orbit">2 · Orbit</button>
    <button class="mode" id="m-cine">3 · Cinematic</button>
  </div>
  <div id="hint">Walk: click to lock mouse · WASD move · Shift run · Space jump · Esc release<br/>
  Orbit: drag rotate · wheel zoom · right-drag pan<br/>
  Cinematic: camera trails the marker like a Remotion shot</div>
</div>
<div id="cross"></div>
<div id="touch"><div id="stick"><div id="knob"></div></div></div>
<button id="jump">JUMP</button>
<div id="label">loading __GLB__ …</div>
<script type="importmap">
{ "imports": {
  "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
  "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
} }
</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';

const MAN = __MANIFEST__;
const AXIS = MAN.axis || 'z-up';
const toV = (a) => AXIS === 'z-up'
  ? new THREE.Vector3(a[0], a[2], -a[1])
  : new THREE.Vector3(a[0], a[1], a[2]);
const label = document.getElementById('label');
const cross = document.getElementById('cross');
const TOUCH = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);
const MODE_LABEL = TOUCH
  ? {walk:'Walk · joystick + drag to look', orbit:'Orbit · drag / pinch', cine:'Cinematic · trailing camera'}
  : {walk:'Walk mode · WASD + mouse', orbit:'Orbit overview', cine:'Cinematic · trailing camera'};
const modeLabel = () => MODE_LABEL[mode];
if (TOUCH) document.getElementById('hint').innerHTML =
  'Walk: joystick to move · drag screen to look · JUMP button<br/>' +
  'Orbit: one-finger drag · pinch to zoom<br/>' +
  'Cinematic: trailing camera follows the marker';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1116);
const camera = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.05, 500);
const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x30343c, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(8, 16, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
scene.add(sun);
for (const z of MAN.zones || []) {
  const p = toV(z.position);
  const lamp = new THREE.PointLight(0xffe9c8, 0.7, 7);
  lamp.position.set(p.x, Math.min(p.y + 1.1, 2.6), p.z);
  scene.add(lamp);
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;

// ---------- navigation grid (from the notebook manifest) ------------------
const nav = MAN.nav_grid;
function blocked(x, z) {
  if (!nav) return false;
  const ty = AXIS === 'z-up' ? -z : z;          // inverse of toV for the horizontal plane
  const i = Math.round((x - nav.min[0]) / nav.cell);
  const j = Math.round((ty - nav.min[1]) / nav.cell);
  if (i < 0 || j < 0 || i >= nav.cols || j >= nav.rows) return true;
  return nav.blocked[j][i] === '1';
}
const RAD = (MAN.physics && MAN.physics.radius_m) || 0.28;
const EYE = (MAN.physics && MAN.physics.eye_height_m) || 1.65;
function canStand(x, z, r=RAD) {
  const d = [[0,0],[r,0],[-r,0],[0,r],[0,-r],[r*.7,r*.7],[-r*.7,r*.7],[r*.7,-r*.7],[-r*.7,-r*.7]];
  for (const [dx,dz] of d) if (blocked(x+dx, z+dz)) return false;
  return true;
}
function nearestFree(x, z) {
  if (canStand(x,z)) return [x,z];
  for (let ring=1; ring<40; ring++) {
    for (let k=0; k<16; k++) {
      const a = k*Math.PI/8, nx=x+Math.cos(a)*ring*.12, nz=z+Math.sin(a)*ring*.12;
      if (canStand(nx,nz)) return [nx,nz];
    }
  }
  return [x,z];
}

// ---------- modes ----------------------------------------------------------
let mode = 'orbit';
let yaw = 0, pitch = 0, vy = 0, onGround = true;
const spawnV = toV((MAN.spawn && MAN.spawn.position) || [0,0,1.65]);
const sp = nearestFree(spawnV.x, spawnV.z);
const player = {x:sp[0], y:0, z:sp[1]};
yaw = (MAN.spawn && MAN.spawn.yaw) || 0;
const keys = Object.create(null);
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code==='Digit1') setMode('walk');
  if (e.code==='Digit2') setMode('orbit');
  if (e.code==='Digit3') setMode('cine');
  if (e.code==='Space' && mode==='walk' && onGround) { vy=4.2; onGround=false; }
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== renderer.domElement || mode!=='walk') return;
  yaw -= e.movementX * 0.0022;
  pitch = THREE.MathUtils.clamp(pitch - e.movementY*0.0022, -1.35, 1.35);
});
renderer.domElement.addEventListener('click', () => {
  if (mode==='walk' && !TOUCH && document.pointerLockElement !== renderer.domElement)
    renderer.domElement.requestPointerLock();
});

// ---------- touch input (mobile) -------------------------------------------
const joy = {x:0, y:0, id:null};
const stickEl = document.getElementById('touch');
const knobEl = document.getElementById('knob');
function setJoy(e) {
  const r = stickEl.getBoundingClientRect();
  let dx = (e.clientX - (r.left + r.width / 2)) / (r.width * 0.34);
  let dy = (e.clientY - (r.top + r.height / 2)) / (r.height * 0.34);
  const m = Math.hypot(dx, dy);
  if (m > 1) { dx /= m; dy /= m; }
  joy.x = dx; joy.y = -dy;                       // stick up = walk forward
  knobEl.style.transform = `translate(${dx * r.width * 0.30}px,${dy * r.height * 0.30}px)`;
}
stickEl.addEventListener('pointerdown', e => {
  joy.id = e.pointerId; stickEl.setPointerCapture(e.pointerId); setJoy(e); e.preventDefault();
}, {passive:false});
stickEl.addEventListener('pointermove', e => { if (e.pointerId === joy.id) setJoy(e); }, {passive:false});
function endJoy(e) {
  if (e.pointerId !== joy.id) return;
  joy.id = null; joy.x = 0; joy.y = 0; knobEl.style.transform = '';
}
stickEl.addEventListener('pointerup', endJoy);
stickEl.addEventListener('pointercancel', endJoy);

const lookTouch = {id:null, x:0, y:0};
renderer.domElement.addEventListener('pointerdown', e => {
  if (!TOUCH || mode !== 'walk' || e.pointerType === 'mouse') return;
  lookTouch.id = e.pointerId; lookTouch.x = e.clientX; lookTouch.y = e.clientY;
  renderer.domElement.setPointerCapture(e.pointerId); e.preventDefault();
}, {passive:false});
renderer.domElement.addEventListener('pointermove', e => {
  if (!TOUCH || mode !== 'walk' || e.pointerId !== lookTouch.id) return;
  yaw -= (e.clientX - lookTouch.x) * 0.005;
  pitch = THREE.MathUtils.clamp(pitch - (e.clientY - lookTouch.y) * 0.005, -1.35, 1.35);
  lookTouch.x = e.clientX; lookTouch.y = e.clientY; e.preventDefault();
}, {passive:false});
function endLook(e) { if (e.pointerId === lookTouch.id) lookTouch.id = null; }
renderer.domElement.addEventListener('pointerup', endLook);
renderer.domElement.addEventListener('pointercancel', endLook);
document.getElementById('jump').addEventListener('pointerdown', e => {
  if (mode === 'walk' && onGround) { vy = 4.2; onGround = false; }
  e.preventDefault();
}, {passive:false});
function setMode(next) {
  mode = next;
  for (const m of ['walk','orbit','cine'])
    document.getElementById('m-'+m).classList.toggle('active', m===mode);
  controls.enabled = (mode==='orbit');
  cross.style.display = (mode==='walk') ? 'block' : 'none';
  if (mode==='walk') {
    const f = (MAN.spawn && MAN.spawn.position) || [0,0,1.65];
    const t = (MAN.zones && MAN.zones.length>1)
      ? MAN.zones[MAN.zones.length-1].position : [f[0], f[1]+2, f[2]];
    const a = toV(f), b = toV(t);
    yaw = Math.atan2(-(b.x-a.x), -(b.z-a.z));
    pitch = 0; vy = 0;
  }
  if (mode==='cine' && !curves) buildCurves();
  label.textContent = modeLabel();
}
document.getElementById('m-walk').onclick = () => setMode('walk');
document.getElementById('m-orbit').onclick = () => setMode('orbit');
document.getElementById('m-cine').onclick = () => setMode('cine');

// ---------- cinematic trailing-camera paths --------------------------------
let curves = null, marker = null, lookAt = new THREE.Vector3();
function buildCurves() {
  const cp = MAN.camera_paths;
  if (!cp || !cp.camera || cp.camera.length < 3) return;
  const subj = cp.subject.map(k => toV(k.position));
  const cam  = cp.camera.map(k => toV(k.position));
  curves = {
    subject: new THREE.CatmullRomCurve3(subj, true, 'centripetal'),
    camera:  new THREE.CatmullRomCurve3(cam, true, 'centripetal'),
    frames: (MAN.camera_settings && MAN.camera_settings.frames) || 300
  };
  marker = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12),
    new THREE.MeshStandardMaterial({color:0xffb24a, emissive:0x6b3300}));
  scene.add(marker);
  camera.position.copy(curves.camera.getPointAt(0));
  lookAt.copy(curves.subject.getPointAt(0));
}
function cinematic(frame) {
  if (!curves) return;
  const t = (frame % curves.frames) / curves.frames;
  const lag = MAN.camera_settings.trailing.look_at_lag_frames || 9;
  const tl = ((frame - lag + curves.frames) % curves.frames) / curves.frames;
  const subj = curves.subject.getPointAt(t);
  const goal = curves.camera.getPointAt(t);
  const target = curves.subject.getPointAt(tl).add(new THREE.Vector3(0,0.6,0));
  const smooth = MAN.camera_settings.trailing.smoothing || 0.14;
  camera.position.lerp(goal, smooth);
  lookAt.lerp(target, smooth);
  camera.lookAt(lookAt);
  if (marker) marker.position.copy(subj);
}

new GLTFLoader().load('__GLB__', (gltf) => {
  const root = gltf.scene;
  if (AXIS === 'z-up') root.rotation.x = -Math.PI/2;   // trimesh Z-up -> three.js Y-up
  root.traverse(o => { if (o.isMesh) {
    o.castShadow = true; o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(m => { if (m) m.side = THREE.DoubleSide; });
  }});
  scene.add(root);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  controls.target.copy(center);
  const r = Math.max(size.x, size.y, size.z);
  camera.position.copy(center).add(new THREE.Vector3(r*0.9, r*0.75, r*1.1));
  camera.near = r/200; camera.far = r*50; camera.updateProjectionMatrix();
  controls.update();
  label.textContent = modeLabel();
}, undefined, (err) => { console.error(err); label.textContent = 'GLB load failed: '+err.message; });

addEventListener('resize', () => {
  camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

let frameNo = 0;
function loop() {
  frameNo++;
  if (!renderer.xr.isPresenting) {
    if (mode==='orbit') {
      controls.update();
    } else if (mode==='walk') {
      const run = keys.ShiftLeft || keys.ShiftRight ? 1.8 : 1.0;
      const speed = 2.8 * run;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      let mx=0, mz=0;
      if (keys.KeyW || keys.ArrowUp)    { mx+=fx; mz+=fz; }
      if (keys.KeyS || keys.ArrowDown)  { mx-=fx; mz-=fz; }
      if (keys.KeyD || keys.ArrowRight) { mx+=rx; mz+=rz; }
      if (keys.KeyA || keys.ArrowLeft)  { mx-=rx; mz-=rz; }
      if (TOUCH) { mx += fx*joy.y + rx*joy.x; mz += fz*joy.y + rz*joy.x; }
      const mag = Math.hypot(mx,mz);
      const scale = mag > 1 ? 1/mag : 1;
      mx = mx*scale*speed/60; mz = mz*scale*speed/60;
      if (canStand(player.x+mx, player.z)) player.x += mx;
      if (canStand(player.x, player.z+mz)) player.z += mz;
      vy -= 11.0/60;
      player.y = Math.max(0, player.y + vy/60);
      if (player.y === 0) { vy = 0; onGround = true; }
      camera.position.set(player.x, player.y + EYE, player.z);
      camera.rotation.order = 'YXZ';
      camera.rotation.y = yaw; camera.rotation.x = pitch;
    } else if (mode==='cine') {
      cinematic(frameNo);
    }
  }
  renderer.render(scene, camera);
}
setMode('orbit');
renderer.setAnimationLoop(loop);
</script>
</body>
</html>"""

for i, (glb, meta) in enumerate(exports, 1):
    payload = json.dumps(meta, separators=(",", ":")).replace("</", "<\\/")
    html = (VIEWER.replace("__TITLE__", f"Environment {i}")
                  .replace("__GLB__", glb.name)
                  .replace("__ROOMS__", str(len(meta["rooms"]) or len(meta["zones"])))
                  .replace("__ITEMS__", str(len(meta["furniture"])))
                  .replace("__DEPTH__", str(meta.get("depth_method") or "n/a"))
                  .replace("__MANIFEST__", payload))
    (OUT / "web" / f"viewer_{i}.html").write_text(html)
    print(f"  wrote viewer_{i}.html  ->  loads {glb.name}  (walk / orbit / cinematic + VR)")
