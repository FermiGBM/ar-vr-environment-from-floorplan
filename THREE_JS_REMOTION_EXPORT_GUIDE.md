# Three.js + Remotion Export Guide

## Overview

This guide provides recommendations for exporting 3D environments from our framework to work optimally with Three.js in Remotion projects.

## Best Export Formats for Three.js + Remotion

### 1. **GLTF (Recommended)**
**File Format**: `.glb` (binary) or `.gltf` (text-based)

**Why GLTF is Best for Three.js + Remotion:**
- ✅ **Native Three.js Support**: Three.js has excellent GLTF loaders
- ✅ **Remotion Compatibility**: Works seamlessly with Remotion's Three.js integration
- ✅ **Binary Efficiency**: GLB format is compact and loads quickly
- ✅ **Feature Rich**: Supports animations, materials, and textures
- ✅ **Web Optimized**: Designed specifically for web applications
- ✅ **Industry Standard**: Most widely adopted 3D format for web

**Three.js Integration:**
```javascript
import { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useVideoTexture } from '@remotion/three';

// Load GLTF in Three.js
const gltfLoader = new GLTFLoader();
gltfLoader.load('/path/to/your/model.glb', (gltf) => {
  const scene = gltf.scene;
  // Add to your Three.js scene
});
```

**Remotion Integration:**
```jsx
import { useGLTF } from '@react-three/drei';
import { useVideoTexture } from '@remotion/three';

export const My3DScene = () => {
  const { scene } = useGLTF('/path/to/your/model.glb');
  
  return (
    <primitive object={scene} />
  );
};
```

### 2. **GLB (Binary GLTF)**
**File Format**: `.glb` (single binary file)

**Advantages for Three.js + Remotion:**
- ✅ **Single File**: No external dependencies (textures included)
- ✅ **Fast Loading**: Binary format loads quickly
- ✅ **Network Efficient**: Smaller file size than GLTF + separate textures
- ✅ **Easy Deployment**: Single file to manage

**Best for**: Production builds and final delivery

### 3. **OBJ + MTL (Alternative)**
**File Format**: `.obj` (geometry) + `.mtl` (materials)

**When to Use OBJ + MTL:**
- ✅ Simple scenes with basic materials
- ✅ When you need manual material control
- ✅ Compatibility with legacy systems

**Limitations for Three.js + Remotion:**
- ❌ No animation support
- ❌ Larger file sizes
- ❌ Material definitions separate from geometry
- ❌ Less efficient than GLTF

**Three.js Integration:**
```javascript
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';

// Load materials
const mtlLoader = new MTLLoader();
mtlLoader.load('/path/to/materials.mtl', (materials) => {
  materials.preload();
  
  // Load geometry
  const objLoader = new OBJLoader();
  objLoader.setMaterials(materials);
  objLoader.load('/path/to/model.obj', (object) => {
    // Add to scene
  });
});
```

### 4. **DRACO Compressed GLTF**
**File Format**: `.glb` with Draco compression

**Advantages:**
- ✅ **Smaller File Sizes**: Up to 95% compression
- ✅ **Faster Loading**: Reduced network transfer time
- ✅ **Better Performance**: Especially for complex models

**Three.js Setup:**
```javascript
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// Setup Draco loader
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/path/to/draco/');

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

// Load compressed model
gltfLoader.load('/path/to/compressed.glb', (gltf) => {
  // Use compressed model
});
```

## Export Configuration for Three.js + Remotion

### Optimal Settings for GLTF Export

```javascript
const gltfExporter = {
  type: 'GLTF',
  options: {
    // Format
    format: 'binary', // 'binary' for GLB, 'string' for GLTF
    
    // Compression
    embedImages: true, // Include textures in the file
    maxTextureSize: 2048, // Texture resolution
    
    // Materials
    includeMaterials: true,
    materialOptions: {
      forceDefault: false,
      forceOpacity: false
    },
    
    // Geometry
    includeCustomProperties: true,
    truncateDrawRange: true,
    
    // Animation
    onlyVisible: false,
    animations: ['idle', 'walk'], // Include specific animations
    
    // Performance
    binary: true, // Use binary format
    forceIndices: false,
    forcePowerOfTwoTextures: false
  }
};
```

### Three.js + Remotion Best Practices

#### 1. **Texture Optimization**
```javascript
// Optimize textures for web
const textureLoader = new THREE.TextureLoader();
const texture = textureLoader.load('/texture.jpg');

// Compress for better performance
texture.encoding = THREE.sRGBEncoding;
texture.anisotropy = 4;

// For Remotion video textures
const videoTexture = useVideoTexture('/video.mp4');
```

#### 2. **Scene Optimization**
```jsx
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';

export const OptimizedScene = () => {
  const { scene } = useGLTF('/model.glb');
  
  useFrame((state) => {
    // Optimize animations
    if (scene.animations) {
      scene.animations.forEach(clip => {
        clip.optimize();
      });
    }
  });
  
  return <primitive object={scene} />;
};
```

#### 3. **Memory Management**
```jsx
import { Suspense, useMemo } from 'react';
import { useGLTF, useProgress } from '@react-three/drei';

export const MemoryOptimizedScene = () => {
  const { scene } = useGLTF('/model.glb');
  
  // Memoize scene to prevent re-renders
  const memoizedScene = useMemo(() => {
    const clonedScene = scene.clone();
    // Optimize scene
    clonedScene.traverse((child) => {
      if (child.isMesh) {
        child.geometry.computeVertexNormals();
      }
    });
    return clonedScene;
  }, [scene]);
  
  return (
    <Suspense fallback={null}>
      <primitive object={memoizedScene} />
    </Suspense>
  );
};
```

## Remotion-Specific Considerations

### 1. **Video Texture Integration**
```jsx
import { useVideoTexture } from '@remotion/three';
import { useGLTF } from '@react-three/drei';

export const VideoTextureScene = () => {
  const { scene } = useGLTF('/model.glb');
  const videoTexture = useVideoTexture('/background.mp4');
  
  // Apply video texture to specific materials
  scene.traverse((child) => {
    if (child.isMesh && child.material.name === 'screen') {
      child.material.map = videoTexture;
    }
  });
  
  return <primitive object={scene} />;
};
```

### 2. **Synchronization with Video Timeline**
```jsx
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { useGLTF } from '@react-three/drei';

export const TimedAnimations = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { scene } = useGLTF('/model.glb');
  
  // Sync animations with video timeline
  useFrame(() => {
    const time = frame / fps;
    
    // Update animations based on time
    scene.traverse((child) => {
      if (child.isMesh && child.userData.animation) {
        child.rotation.y = time * 0.5; // Example animation
      }
    });
  });
  
  return <primitive object={scene} />;
};
```

### 3. **Performance Optimization for Video Rendering**
```jsx
import { useReducedMotion } from 'remotion';

export const PerformanceOptimizedScene = () => {
  const prefersReducedMotion = useReducedMotion();
  const { scene } = useGLTF('/model.glb');
  
  // Disable complex animations if user prefers reduced motion
  useEffect(() => {
    if (prefersReducedMotion) {
      scene.traverse((child) => {
        if (child.isMesh) {
          child.userData.animationEnabled = false;
        }
      });
    }
  }, [prefersReducedMotion, scene]);
  
  return <primitive object={scene} />;
};
```

## Complete Export Workflow

### Step 1: Export from Our Framework
```python
# Export for Three.js + Remotion
def export_for_three_js(scene_data, output_path, format='glb'):
    """
    Export 3D scene in Three.js + Remotion compatible format
    
    Args:
        scene_data: Scene data from our framework
        output_path: Output file path
        format: 'glb', 'gltf', or 'obj'
    """
    if format == 'glb':
        # Export as binary GLTF
        export_as_glb(scene_data, output_path)
    elif format == 'gltf':
        # Export as text-based GLTF
        export_as_gltf(scene_data, output_path)
    elif format == 'obj':
        # Export as OBJ + MTL
        export_as_obj(scene_data, output_path)
```

### Step 2: Three.js Integration
```javascript
// Load and integrate with Three.js
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useVideoTexture } from '@remotion/three';

class ThreeJSSceneLoader {
  constructor() {
    this.loader = new GLTFLoader();
    this.scene = null;
  }
  
  async loadModel(path) {
    return new Promise((resolve, reject) => {
      this.loader.load(
        path,
        (gltf) => {
          this.scene = gltf.scene;
          this.optimizeScene();
          resolve(this.scene);
        },
        (progress) => {
          console.log('Loading progress:', (progress.loaded / progress.total) * 100 + '%');
        },
        (error) => {
          reject(error);
        }
      );
    });
  }
  
  optimizeScene() {
    if (!this.scene) return;
    
    // Optimize for video rendering
    this.scene.traverse((child) => {
      if (child.isMesh) {
        // Optimize geometry
        child.geometry.computeVertexNormals();
        
        // Optimize materials
        if (child.material) {
          child.material.needsUpdate = true;
        }
      }
    });
  }
  
  applyVideoTexture(videoUrl, materialName) {
    const videoTexture = new VideoTexture(videoUrl);
    
    this.scene.traverse((child) => {
      if (child.isMesh && child.material.name === materialName) {
        child.material.map = videoTexture;
        child.material.needsUpdate = true;
      }
    });
  }
}
```

### Step 3: Remotion Integration
```jsx
import { useVideoTexture } from '@remotion/three';
import { useGLTF } from '@react-three/drei';
import { useCurrentFrame, useVideoConfig } from 'remotion';

export const Remotion3DScene = () => {
  const { scene } = useGLTF('/path/to/model.glb');
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  
  // Apply video textures
  useEffect(() => {
    const videoTexture = useVideoTexture('/background.mp4');
    
    scene.traverse((child) => {
      if (child.isMesh && child.material.name === 'screen') {
        child.material.map = videoTexture;
        child.material.needsUpdate = true;
      }
    });
  }, [scene]);
  
  // Animate based on timeline
  useFrame(() => {
    const time = frame / fps;
    
    // Example animation
    scene.rotation.y = time * 0.1;
    
    // Pulsing effect
    scene.scale.setScalar(1 + Math.sin(time * 2) * 0.05);
  });
  
  return (
    <primitive object={scene} />
  );
};
```

## Performance Optimization Tips

### 1. **Level of Detail (LOD)**
```jsx
import { useGLTF } from '@react-three/drei';
import { useMemo } from 'react';

export const LODScene = () => {
  const { scene } = useGLTF('/model.glb');
  
  const lodScene = useMemo(() => {
    const clonedScene = scene.clone();
    
    // Create LOD levels
    clonedScene.traverse((child) => {
      if (child.isMesh) {
        // Simplify geometry for distance
        const simplifiedGeometry = child.geometry.clone();
        simplifiedGeometry.scale(0.8, 0.8, 0.8);
        
        // Create LOD mesh
        const lodMesh = new THREE.Mesh(simplifiedGeometry, child.material);
        lodMesh.visible = false;
        
        // Add to parent
        child.parent.add(lodMesh);
      }
    });
    
    return clonedScene;
  }, [scene]);
  
  return <primitive object={lodScene} />;
};
```

### 2. **Texture Atlas Optimization**
```javascript
// Combine multiple textures into an atlas
function createTextureAtlas(textures) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  // Set canvas size
  canvas.width = 2048;
  canvas.height = 2048;
  
  // Draw textures to atlas
  let x = 0, y = 0;
  textures.forEach(texture => {
    ctx.drawImage(texture.image, x, y);
    x += texture.image.width;
    if (x > canvas.width) {
      x = 0;
      y += texture.image.height;
    }
  });
  
  return new THREE.CanvasTexture(canvas);
}
```

### 3. **Memory Management**
```jsx
import { Suspense, useEffect, useRef } from 'react';

export const MemoryManagedScene = () => {
  const sceneRef = useRef();
  
  useEffect(() => {
    return () => {
      // Clean up when component unmounts
      if (sceneRef.current) {
        sceneRef.current.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
        });
      }
    };
  }, []);
  
  return (
    <Suspense fallback={null}>
      <primitive ref={sceneRef} object={scene} />
    </Suspense>
  );
};
```

## Troubleshooting Common Issues

### 1. **Texture Loading Issues**
```javascript
// Handle texture loading errors
const textureLoader = new THREE.TextureLoader();
textureLoader.load(
  '/texture.jpg',
  (texture) => {
    // Success
    console.log('Texture loaded successfully');
  },
  (progress) => {
    // Loading progress
    console.log('Loading:', progress);
  },
  (error) => {
    // Error handling
    console.error('Texture loading error:', error);
    // Fallback texture
    const fallbackTexture = new THREE.Texture();
    fallbackTexture.needsUpdate = true;
  }
);
```

### 2. **Animation Synchronization**
```javascript
// Sync animations with Remotion timeline
useFrame((state, delta) => {
  const frame = useCurrentFrame();
  const fps = useVideoConfig().fps;
  const time = frame / fps;
  
  // Update animations
  if (sceneRef.current && sceneRef.current.animations) {
    sceneRef.current.animations.forEach(clip => {
      const action = mixer.clipAction(clip);
      action.time = time;
      action.play();
    });
  }
});
```

### 3. **Performance Issues**
```javascript
// Monitor performance
useFrame((state) => {
  if (state.performance) {
    const fps = state.performance.current;
    console.log('Current FPS:', fps);
    
    // Reduce quality if FPS drops
    if (fps < 30) {
      // Reduce quality settings
    }
  }
});
```

## Conclusion

For Three.js + Remotion integration, **GLTF/GLB format is the best choice** due to:

1. **Native Three.js Support**: Excellent compatibility and performance
2. **Remotion Integration**: Seamless integration with React Three Fiber
3. **Web Optimization**: Designed specifically for web applications
4. **Feature Rich**: Supports animations, materials, and textures
5. **Industry Standard**: Most widely adopted format for web 3D

The binary GLB format is particularly recommended for production use as it provides the best balance of file size, loading performance, and feature support for Three.js + Remotion projects.

---

## Exporting an explorable world + trailing camera (notebook v2)

The Kaggle notebook now exports more than a mesh:

| File | Contents |
|---|---|
| `3d/scene_1.glb` | explorable world (plan rooms or photo room shell), PBR materials, Z-up |
| `3d/scene_1.json` | spawn, zones, nav grid, furniture, camera settings |
| `3d/camera_path_1.json` | looping `subject_path` + `camera_path` keyframes (fps 30, 360 frames) |
| `web/viewer_1.html` | Walk / Orbit / Cinematic preview with the same trailing camera |

`camera_path_1.json` is frame-indexed and already bakes the trailing offset into `camera_path`, so
rendering is deterministic: no per-frame accumulator, safe for parallel frame rendering / Lambda.
Points are trimesh **Z-up**; convert with `(x, y, z) → (x, z, -y)`.

A ready-to-use component lives in `remotion_trailing_camera.tsx`. The core of it is:

```tsx
const toThree = (p) => new THREE.Vector3(p[0], p[2], -p[1]); // Z-up -> Y-up

const curves = {
  subject: new THREE.CatmullRomCurve3(path.subject_path.map(k => toThree(k.position)), true, 'centripetal'),
  camera:  new THREE.CatmullRomCurve3(path.camera_path.map(k => toThree(k.position)), true, 'centripetal'),
};
const t = (frame % path.frames) / path.frames;
const lag = path.settings.look_at_lag_frames / path.frames;
const subject = curves.subject.getPointAt(t);
const eye = curves.camera.getPointAt((t - lag + 1) % 1);       // camera trails the subject
const lookAt = curves.subject.getPointAt((t - lag * 2 + 1) % 1);
camera.position.copy(eye);
camera.lookAt(lookAt);
```

Notes:

- Use `<ThreeCanvas>` from `@remotion/three` so `useCurrentFrame()` works inside React Three Fiber.
- Rotate the imported GLB with `rotation={[-Math.PI / 2, 0, 0]}` (after cloning the loaded scene).
- Set `Config.setChromiumOpenGlRenderer('angle')` in `remotion.config.ts`; pass `chromiumOptions.gl:
  'angle'` for serverless rendering.
- The viewer's **Cinematic** mode plays the same curves, so what you preview in the notebook is what
  Remotion renders.