import React from 'react';
import { Composition, staticFile } from 'remotion';
import { Destruction, type DestructionProps } from './Destruction';

/**
 * The composition reads `sim.json` up front so its length, frame rate and size
 * always match whatever `npm run bake` produced.  Nothing about the shot is
 * hard-coded here: bake a different GLB, point `--props` at its folder, render.
 */
type Meta = {
  props: DestructionProps;
  defaultProps: DestructionProps;
};

async function calculateMetadata({ props }: Meta) {
  const shot = props.shot ?? 'bridge';
  const sim = await fetch(staticFile(`${shot}/sim.json`)).then((r) => {
    if (!r.ok) throw new Error(`cannot read ${shot}/sim.json (${r.status}) — run "npm run prepare"`);
    return r.json();
  });
  return {
    fps: sim.fps ?? 30,
    durationInFrames: sim.frames ?? 270,
    width: props.width ?? 1920,
    height: props.height ?? 1080,
    props: { ...props, shot },
  };
}

export const RemotionRoot: React.FC = () => (
  <Composition
    id="DestructionBridge"
    component={Destruction}
    defaultProps={{ shot: 'bridge' } satisfies DestructionProps}
    calculateMetadata={calculateMetadata}
    durationInFrames={270}
    fps={30}
    width={1920}
    height={1080}
  />
);