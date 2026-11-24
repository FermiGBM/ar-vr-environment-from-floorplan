// Remotion + Three.js: render the notebook's world with a deterministic trailing camera.
// Copy this file (and outputs/3d/scene_1.glb + camera_path_1.json) into your Remotion project.
//
//   npm i three @react-three/fiber @remotion/three @types/three
//   remotion.config.ts: Config.setChromiumOpenGlRenderer('angle');
//
// The GLB and path JSON use trimesh Z-up. toThree() converts them to three.js Y-up.

import React, {useMemo} from 'react';
import {ThreeCanvas} from '@remotion/three';
import {useCurrentFrame} from 'remotion';
import {useLoader, useThree} from '@react-three/fiber';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import pathData from './camera_path_1.json';

const toThree = (p) => new THREE.Vector3(p[0], p[2], -p[1]); // Z-up -> Y-up

const CameraRig = ({paths, frames, lagFrames}) => {
  const frame = useCurrentFrame();
  const {camera} = useThree();

  const curves = useMemo(() => ({
    subject: new THREE.CatmullRomCurve3(paths.subject.map(k => toThree(k.position)), true, 'centripetal'),
    camera: new THREE.CatmullRomCurve3(paths.camera.map(k => toThree(k.position)), true, 'centripetal'),
  }), [paths]);

  // Frame-independent trailing: sample the camera curve slightly behind the subject.
  // No accumulator, so every frame renders identically in parallel / Lambda.
  const t = ((frame % frames) + frames) / frames;
  const lagT = lagFrames / frames;
  const subject = curves.subject.getPointAt(t);
  const eye = curves.camera.getPointAt((t - lagT + 1) % 1);
  const lookAt = curves.subject.getPointAt((t - lagT * 2 + 1) % 1);

  camera.position.copy(eye);
  camera.lookAt(lookAt);
  camera.updateProjectionMatrix();

  return (
    <mesh position={subject}>
      <sphereGeometry args={[0.14, 20, 16]} />
      <meshStandardMaterial color="#ffb24a" emissive="#6b3300" />
    </mesh>
  );
};

const WorldModel = ({src}) => {
  const gltf = useLoader(GLTFLoader, src);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf]);
  return (
    <>
      <hemisphereLight args={[0xdfe8ff, 0x30343c, 0.9]} />
      <directionalLight position={[8, 16, 6]} intensity={1.8} castShadow />
      <primitive object={scene} rotation={[-Math.PI / 2, 0, 0]} />
    </>
  );
};

export const TrailingCameraWorld: React.FC<{
  glbUrl: string;
  durationInFrames?: number;
}> = ({glbUrl, durationInFrames = 300}) => {
  const frames = pathData.frames || durationInFrames;

  return (
    <ThreeCanvas style={{width: '100%', height: '100%'}} gl={{antialias: true}}>
      <color attach="background" args={['#0e1116']} />
      <WorldModel src={glbUrl} />
      <CameraRig
        paths={{subject: pathData.subject_path, camera: pathData.camera_path}}
        frames={frames}
        lagFrames={pathData.settings?.look_at_lag_frames ?? 9}
      />
    </ThreeCanvas>
  );
};

// In your Root.tsx:
//   <Composition
//     id="TrailingWorld"
//     component={() => <TrailingCameraWorld glbUrl="/scene_1.glb" />}
//     durationInFrames={300}
//     fps={30}
//     width={1920}
//     height={1080}
//   />
