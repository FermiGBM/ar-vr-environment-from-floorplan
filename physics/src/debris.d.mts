// Types for the framework-agnostic runtime in debris.mjs.  Keeping them next to
// the implementation (rather than rewriting it in TypeScript) means the exact
// same module drives the browser preview and the Remotion render.

export interface SimMaterial {
  name: string;
  color: number[];
  avg: number[];
}
export interface SimBody {
  id: number;
  name: string;
  material: number;
  mass: number;
  volume: number;
  initial: number[];
  releaseFrame: number | null;
  sleepFrame: number | null;
  motion: { offset: number; count: number } | null;
}
export interface SimSplash {
  frame: number;
  position: [number, number, number];
  strength: number;
  radius: number;
}
export interface SimDecal {
  frame: number;
  piece: number;
  local: [number, number, number];
  localNormal: [number, number, number];
  position: [number, number, number];
  normal: [number, number, number];
  size: number;
  kind: string;
}
export interface SimDust {
  frame: number;
  position: [number, number, number];
  radius: number;
  count: number;
  life: number;
  color: [number, number, number];
}
export interface SimChip {
  frame: number;
  position: [number, number, number];
  velocity: [number, number, number];
  size: number;
  life: number;
  color: [number, number, number] | null;
}
export interface SimExplosion {
  frame: number;
  position: [number, number, number];
  radius: number;
  visible: boolean;
  kind: 'explode' | 'implode';
}
export interface SimShot {
  version: number;
  asset: string;
  bounds: { lo: number[]; hi: number[]; size: number[] };
  materials: SimMaterial[];
  fps: number;
  frames: number;
  duration: number;
  gravity: number[];
  bodies: SimBody[];
  explosions: SimExplosion[];
  decals: SimDecal[];
  splashes: SimSplash[];
  chips: SimChip[];
  dust: SimDust[];
  water: { level: number; extent: [number, number] } | null;
  ground: { level: number; extent: number } | null;
  killY: number;
  motion: string | null;
}

export interface DestructionFx {
  sim: SimShot;
  group: THREE.Group;
  mesh: THREE.Mesh;
  pieces: number[];
  parts: Record<string, THREE.Object3D | undefined>;
  update(frame: number): void;
  setTime(seconds: number): void;
  dispose(): void;
}

export function loadDestruction(opts: {
  glb: string;
  sim: string;
  motion?: string;
  shadows?: boolean;
}): Promise<Destruction>;

export function frameCamera(
  camera: THREE.Camera,
  sim: SimShot,
  opts?: { zoom?: number; dir?: [number, number, number] },
): { center: THREE.Vector3; radius: number };
