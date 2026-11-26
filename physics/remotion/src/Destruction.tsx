import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AbsoluteFill, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { ThreeCanvas } from '@remotion/three';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { frameCamera, loadDestruction, type DestructionFx as Fx, type SimShot } from '../../src/debris.mjs';

export type DestructionProps = {
  /** folder under remotion/public/, produced by `npm run prepare` */
  shot?: string;
  width?: number;
  height?: number;
};

/**
 * Renders one baked shot.  Every visual is a pure function of the frame index,
 * so Remotion can render frames in any order (and in parallel) without drift.
 */
export const Destruction: React.FC<DestructionProps> = ({ shot = 'bridge', width = 1920, height = 1080 }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#0b1218' }}>
      <ThreeCanvas
        width={width}
        height={height}
        shadows
        dpr={1}
        camera={{ fov: 42, near: 0.1, far: 4000, position: [0, 30, 90] }}
        gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
        style={{ width: '100%', height: '100%' }}
      >
        <ShotScene shot={shot} />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};

const ShotScene: React.FC<{ shot: string }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { scene, camera, gl, invalidate } = useThree();

  const [fx, setFx] = useState<Fx | null>(null);
  const [handle] = useState(() => delayRender(`loading ${shot}`));

  // ---- load once ---------------------------------------------------------
  useLayoutEffect(() => {
    let alive = true;
    loadDestruction({
      glb: staticFile(`${shot}/debris.glb`),
      sim: staticFile(`${shot}/sim.json`),
    })
      .then((loaded) => {
        if (!alive) return;
        setFx(loaded);
        continueRender(handle);
      })
      .catch((err) => {
        console.error(err);
        continueRender(handle);
      });
    return () => {
      alive = false;
    };
  }, [shot, handle]);

  // ---- renderer look -----------------------------------------------------
  useLayoutEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 0.92;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    pmrem.dispose();
    return () => {
      scene.environment = null;
      env.dispose();
    };
  }, [gl, scene]);

  // ---- camera framing ----------------------------------------------------
  useLayoutEffect(() => {
    if (!fx) return;
    const { center } = frameCamera(camera, fx.sim as SimShot, { zoom: 1.5, dir: [0.62, 0.34, 1] });
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    invalidate();
  }, [fx, camera, invalidate]);

  // ---- attach + per-frame transform --------------------------------------
  useLayoutEffect(() => {
    if (!fx) return;
    scene.add(fx.group);
    return () => {
      scene.remove(fx.group);
      fx.dispose();
    };
  }, [fx, scene]);

  useLayoutEffect(() => {
    if (!fx) return;
    const sim = fx.sim as SimShot;
    // composition fps may differ from the bake fps
    const local = Math.round((frame * (sim.fps ?? 30)) / fps);
    fx.update(local);
    invalidate();
  }, [fx, frame, fps, invalidate]);

  const focus = useMemo(() => {
    if (!fx) return { center: new THREE.Vector3(), radius: 40 };
    const b = (fx.sim as SimShot).bounds;
    const center = new THREE.Vector3(
      (b.lo[0] + b.hi[0]) / 2,
      (b.lo[1] + b.hi[1]) / 2,
      (b.lo[2] + b.hi[2]) / 2,
    );
    const radius = 0.5 * Math.hypot(b.size[0], b.size[1], b.size[2]);
    return { center, radius };
  }, [fx]);

  return (
    <>
      <SceneBackdrop radius={focus.radius} />
      <Lights center={focus.center} radius={focus.radius} />
    </>
  );
};

/** Gradient dome + fog so the water has a horizon instead of a hard edge. */
const SceneBackdrop: React.FC<{ radius: number }> = ({ radius }) => {
  const { scene, camera } = useThree();
  const dome = useRef<THREE.Mesh>(null);

  useLayoutEffect(() => {
    scene.fog = new THREE.Fog('#26333c', radius * 3, radius * 12);
    return () => {
      scene.fog = null;
    };
  }, [scene, radius]);

  useLayoutEffect(() => {
    if (dome.current) dome.current.position.copy(camera.position);
  }, [camera]);

  return (
    <mesh ref={dome} frustumCulled={false} renderOrder={-1}>
      <sphereGeometry args={[1800, 32, 16]} />
      <shaderMaterial
        side={THREE.BackSide}
        depthWrite={false}
        fog={false}
        uniforms={{
          uTop: { value: new THREE.Color('#0b1218') },
          uHorizon: { value: new THREE.Color('#26333c') },
          uBottom: { value: new THREE.Color('#131a1f') },
        }}
        vertexShader={`varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`}
        fragmentShader={`uniform vec3 uTop, uHorizon, uBottom;
          varying vec3 vDir;
          void main() {
            float h = vDir.y;
            vec3 c = h > 0.0
              ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55))
              : mix(uHorizon, uBottom, pow(clamp(-h, 0.0, 1.0), 0.7));
            gl_FragColor = vec4(c, 1.0);
          }`}
      />
    </mesh>
  );
};

const Lights: React.FC<{ center: THREE.Vector3; radius: number }> = ({ center, radius }) => {
  const sun = useRef<THREE.DirectionalLight>(null);

  useLayoutEffect(() => {
    if (!sun.current) return;
    sun.current.target.position.copy(center);
    sun.current.target.updateMatrixWorld();
    const d = radius * 1.15;
    const cam = sun.current.shadow.camera;
    cam.left = -d;
    cam.right = d;
    cam.top = d;
    cam.bottom = -d;
    cam.near = 1;
    cam.far = radius * 8 + 260;
    cam.updateProjectionMatrix();
  }, [center, radius]);

  return (
    <>
      <directionalLight
        ref={sun}
        color="#fff2dd"
        intensity={2.3}
        position={[
          center.x + 0.45 * 190,
          center.y + 0.75 * 190,
          center.z + 0.3 * 190,
        ]}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0008}
        shadow-normalBias={0.02}
      />
      <hemisphereLight args={['#9fc6d8', '#2a2620', 0.35]} />
    </>
  );
};