import * as THREE from 'three';
import { patchMaterial } from '../src/debris.mjs';

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };

const uniforms = { uPieces: { value: null }, uPieceCount: { value: 8 } };

// Run the hook the way the renderer would, against a real three shader template.
function compile(mat, template) {
  patchMaterial(mat, uniforms);
  const shader = {
    uniforms: {},
    vertexShader: template.vertexShader,
    fragmentShader: template.fragmentShader,
  };
  mat.onBeforeCompile(shader, null);
  return shader.vertexShader;
}

// The lookup must be declared before the first use of qrot(pieceQuat, ...).
function declaresBeforeUse(src, label) {
  const decl = src.indexOf('vec4 pieceQuat =');
  const use = src.indexOf('qrot(pieceQuat');
  check(decl >= 0, `${label}: pieceQuat is declared`);
  check(use >= 0, `${label}: pieceQuat is used`);
  check(decl >= 0 && decl < use, `${label}: declaration precedes use`);
}

// ...and it must not sit inside an `#ifdef` that the program never defines.
function notConditional(src, label) {
  const start = src.indexOf('#ifdef USE_DISPLACEMENTMAP');
  if (start < 0) return check(true, `${label}: no conditional normal block`);
  const end = src.indexOf('#endif', start);
  const decl = src.indexOf('vec4 pieceQuat =');
  check(decl < start || decl > end, `${label}: lookup is outside USE_DISPLACEMENTMAP`);
}

const std = compile(new THREE.MeshStandardMaterial(), THREE.ShaderLib.physical);
declaresBeforeUse(std, 'physical');
check(/vec3 objectNormal = qrot\(pieceQuat, normal\);/.test(std), 'physical: normals rotate with the piece');
check(/vec3 transformed = qrot\(pieceQuat, position\) \+ piecePos;/.test(std), 'physical: positions rotate with the piece');
check(std.includes('attribute float aPiece;'), 'physical: aPiece attribute is declared');

const depth = compile(new THREE.MeshDepthMaterial(), THREE.ShaderLib.depth);
declaresBeforeUse(depth, 'depth');
notConditional(depth, 'depth');
check(/vec3 transformed = qrot\(pieceQuat, position\) \+ piecePos;/.test(depth), 'depth: positions follow the pieces');
check(depth.includes('attribute float aPiece;'), 'depth: aPiece attribute is declared');

console.log(failures ? `\n${failures} failure(s)` : '\nall shader checks passed');
process.exit(failures ? 1 : 0);