"""
Three.js + Remotion Integration Example
This script demonstrates how to use the ThreeJSRemotionExporter to create
optimized 3D scenes for Three.js and Remotion integration.
"""

import json
import os
from pathlib import Path
from three_js_remotion_exporter import ThreeJSRemotionExporter


def create_sample_scene_data():
    """Create sample scene data for demonstration"""
    return {
        "input_image": "sample_floor_plan.png",
        "timestamp": "2024-01-01T00:00:00",
        "rooms": [
            {
                "id": 0,
                "vertices": [
                    [0, 0, 0], [4, 0, 0], [4, 3, 0], [0, 3, 0],
                    [0, 0, 3], [4, 0, 3], [4, 3, 3], [0, 3, 3]
                ],
                "faces": [
                    [0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1],
                    [2, 6, 7, 3], [0, 3, 7, 4], [1, 5, 6, 2]
                ],
                "position": [0, 0, 0],
                "dimensions": {"width": 4, "height": 3, "depth": 3},
                "type": "living_room"
            },
            {
                "id": 1,
                "vertices": [
                    [4, 0, 0], [6, 0, 0], [6, 2, 0], [4, 2, 0],
                    [4, 0, 3], [6, 0, 3], [6, 2, 3], [4, 2, 3]
                ],
                "faces": [
                    [0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1],
                    [2, 6, 7, 3], [0, 3, 7, 4], [1, 5, 6, 2]
                ],
                "position": [4, 0, 0],
                "dimensions": {"width": 2, "height": 2, "depth": 3},
                "type": "kitchen"
            }
        ],
        "furniture": [
            {
                "id": 0,
                "type": "sofa",
                "vertices": [
                    [0.5, 0.5, 0], [2.5, 0.5, 0], [2.5, 1.3, 0], [0.5, 1.3, 0],
                    [0.5, 0.5, 0.8], [2.5, 0.5, 0.8], [2.5, 1.3, 0.8], [0.5, 1.3, 0.8]
                ],
                "faces": [
                    [0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1],
                    [2, 6, 7, 3], [0, 3, 7, 4], [1, 5, 6, 2]
                ],
                "position": [1, 0.5, 0],
                "size": [2, 0.8, 0.8],
                "room_id": 0
            },
            {
                "id": 1,
                "type": "coffee_table",
                "vertices": [
                    [1.5, 1.5, 0], [2.5, 1.5, 0], [2.5, 2.2, 0], [1.5, 2.2, 0],
                    [1.5, 1.5, 0.5], [2.5, 1.5, 0.5], [2.5, 2.2, 0.5], [1.5, 2.2, 0.5]
                ],
                "faces": [
                    [0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1],
                    [2, 6, 7, 3], [0, 3, 7, 4], [1, 5, 6, 2]
                ],
                "position": [2, 1.5, 0],
                "size": [1, 0.7, 0.5],
                "room_id": 0
            },
            {
                "id": 2,
                "type": "counter",
                "vertices": [
                    [4.2, 0.2, 0], [5.8, 0.2, 0], [5.8, 1.8, 0], [4.2, 1.8, 0],
                    [4.2, 0.2, 0.8], [5.8, 0.2, 0.8], [5.8, 1.8, 0.8], [4.2, 1.8, 0.8]
                ],
                "faces": [
                    [0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1],
                    [2, 6, 7, 3], [0, 3, 7, 4], [1, 5, 6, 2]
                ],
                "position": [4.2, 0.2, 0],
                "size": [1.6, 1.6, 0.8],
                "room_id": 1
            }
        ],
        "metadata": {
            "total_rooms": 2,
            "total_furniture": 3,
            "physics_enabled": True,
            "processing_time": 45.2
        }
    }


def export_for_three_js_remotion():
    """Export scene data for Three.js + Remotion integration"""
    
    # Create output directory
    output_dir = Path("outputs/three_js_remotion")
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Create sample scene data
    scene_data = create_sample_scene_data()
    
    # Create exporter with different configurations
    configs = [
        {
            "name": "basic_glb",
            "config": {
                "format": "glb",
                "texture_resolution": 1024,
                "compress_textures": True,
                "include_animations": False,
                "optimize_geometry": True,
                "draco_compression": False,
                "generate_lods": False,
                "create_texture_atlas": False
            }
        },
        {
            "name": "optimized_glb",
            "config": {
                "format": "glb",
                "texture_resolution": 512,
                "compress_textures": True,
                "include_animations": False,
                "optimize_geometry": True,
                "draco_compression": True,
                "generate_lods": True,
                "create_texture_atlas": True
            }
        },
        {
            "name": "gltf_with_textures",
            "config": {
                "format": "gltf",
                "texture_resolution": 2048,
                "compress_textures": False,
                "include_animations": True,
                "optimize_geometry": True,
                "draco_compression": False,
                "generate_lods": False,
                "create_texture_atlas": False
            }
        }
    ]
    
    # Export scenes with different configurations
    results = []
    
    for config_info in configs:
        print(f"\n🚀 Exporting with {config_info['name']} configuration...")
        
        # Create exporter with specific configuration
        exporter = ThreeJSRemotionExporter(str(output_dir / config_info['name']))
        exporter.config = config_info['config']
        
        # Export scene
        result = exporter.export_scene(scene_data, f"living_room_{config_info['name']}")
        
        # Add configuration info to result
        result['configuration'] = config_info['config']
        results.append(result)
        
        print(f"✅ Export completed for {config_info['name']}")
    
    # Generate comparison report
    generate_comparison_report(results, output_dir)
    
    # Generate usage examples
    generate_usage_examples(output_dir)
    
    return results


def generate_comparison_report(results, output_dir):
    """Generate a comparison report of different export configurations"""
    
    report_path = output_dir / "export_comparison_report.md"
    
    with open(report_path, 'w') as f:
        f.write("# Three.js + Remotion Export Comparison Report\n\n")
        f.write("This report compares different export configurations for Three.js + Remotion integration.\n\n")
        
        # Table of contents
        f.write("## Table of Contents\n\n")
        f.write("1. [Export Overview](#export-overview)\n")
        f.write("2. [Configuration Comparison](#configuration-comparison)\n")
        f.write("3. [Performance Analysis](#performance-analysis)\n")
        f.write("4. [Recommendations](#recommendations)\n\n")
        
        # Export overview
        f.write("## Export Overview\n\n")
        f.write("The following scenes were exported with different configurations:\n\n")
        
        for result in results:
            f.write(f"### {result['scene_name']}\n")
            f.write(f"- **Format**: {result['export_format']}\n")
            f.write(f"- **Size**: {result['export_size']} bytes\n")
            f.write(f"- **Rooms**: {result['scene_info']['total_rooms']}\n")
            f.write(f"- **Furniture**: {result['scene_info']['total_furniture']}\n")
            f.write(f"- **Physics**: {result['scene_info']['physics_enabled']}\n\n")
        
        # Configuration comparison
        f.write("## Configuration Comparison\n\n")
        f.write("| Configuration | Format | Texture Resolution | Compression | Draco | LODs | Atlas |\n")
        f.write("|--------------|--------|-------------------|------------|-------|------|-------|\n")
        
        for result in results:
            config = result['configuration']
            f.write(f"| {result['scene_name']} | {config['format']} | {config['texture_resolution']}px | ")
            f.write(f"{'✅' if config['compress_textures'] else '❌'} | ")
            f.write(f"{'✅' if config['draco_compression'] else '❌'} | ")
            f.write(f"{'✅' if config['generate_lods'] else '❌'} | ")
            f.write(f"{'✅' if config['create_texture_atlas'] else '❌'} |\n")
        
        f.write("\n")
        
        # Performance analysis
        f.write("## Performance Analysis\n\n")
        f.write("### File Sizes\n\n")
        f.write("| Configuration | File Size | Compression Ratio |\n")
        f.write("|--------------|-----------|------------------|\n")
        
        base_size = results[0]['export_size']
        for result in results:
            config = result['configuration']
            compression_ratio = (base_size - result['export_size']) / base_size * 100
            f.write(f"| {result['scene_name']} | {result['export_size']} bytes | {compression_ratio:.1f}% |\n")
        
        f.write("\n")
        
        f.write("### Loading Performance\n\n")
        f.write("Based on the configuration, the expected loading performance:\n\n")
        f.write("- **Basic GLB**: Fast loading, good for simple scenes\n")
        f.write("- **Optimized GLB**: Fastest loading with Draco compression and texture atlas\n")
        f.write("- **GLTF with Textures**: Slower loading but highest quality\n\n")
        
        # Recommendations
        f.write("## Recommendations\n\n")
        f.write("### For Production Use\n")
        f.write("1. **Recommended**: Optimized GLB configuration\n")
        f.write("   - Fast loading with Draco compression\n")
        f.write("   - Texture atlas reduces HTTP requests\n")
        f.write("   - LODs improve performance at distance\n\n")
        
        f.write("### For High-Quality Rendering\n")
        f.write("1. **Recommended**: GLTF with textures configuration\n")
        f.write("   - Highest texture quality\n")
        f.write("   - Better for detailed scenes\n")
        f.write("   - Suitable for high-end video production\n\n")
        
        f.write("### For Web Applications\n")
        f.write("1. **Recommended**: Basic GLB configuration\n")
        f.write("   - Smaller file size\n")
        f.write("   - Faster initial load\n")
        f.write("   - Good for interactive web experiences\n\n")
        
        f.write("### For Remotion Videos\n")
        f.write("1. **Recommended**: Optimized GLB configuration\n")
        f.write("   - Best balance of quality and performance\n")
        f.write("   - Optimized for video rendering\n")
        f.write("   - Efficient for batch processing\n\n")
    
    print(f"✅ Comparison report generated: {report_path}")


def generate_usage_examples(output_dir):
    """Generate usage examples for Three.js + Remotion"""
    
    examples_dir = output_dir / "examples"
    examples_dir.mkdir(exist_ok=True)
    
    # Example 1: Basic Three.js integration
    example1_path = examples_dir / "basic-three-js.js"
    with open(example1_path, 'w') as f:
        f.write("""// Basic Three.js Integration Example
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0x404040);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
directionalLight.position.set(1, 1, 1);
scene.add(directionalLight);

// Load GLTF model
const loader = new GLTFLoader();
loader.load('/outputs/three_js_remotion/basic_glb/living_room_basic_glb.glb', (gltf) => {
    const model = gltf.scene;
    scene.add(model);
    
    // Center the model
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    
    // Position camera
    camera.position.z = 5;
    
    // Animation loop
    function animate() {
        requestAnimationFrame(animate);
        
        // Rotate model slowly
        model.rotation.y += 0.005;
        
        renderer.render(scene, camera);
    }
    
    animate();
});

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
""")
    
    # Example 2: React Three Fiber integration
    example2_path = examples_dir / "react-three-fiber.tsx"
    with open(example2_path, 'w') as f:
        f.write("""// React Three Fiber Integration Example
import React, { Suspense, useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { useVideoTexture } from '@remotion/three';

// 3D Scene Component
const LivingRoomScene = ({ videoUrl }) => {
  const { scene } = useGLTF('/outputs/three_js_remotion/basic_glb/living_room_basic_glb.glb');
  const sceneRef = useRef();
  
  // Apply video texture
  useEffect(() => {
    if (videoUrl) {
      const videoTexture = useVideoTexture(videoUrl);
      
      scene.traverse((child) => {
        if (child.isMesh && child.material.name === 'screen') {
          child.material.map = videoTexture;
          child.material.needsUpdate = true;
        }
      });
    }
  }, [videoUrl, scene]);
  
  // Animation
  useFrame((state) => {
    if (sceneRef.current) {
      sceneRef.current.rotation.y = state.clock.getElapsedTime() * 0.1;
    }
  });
  
  return <primitive ref={sceneRef} object={scene} />;
};

// Canvas Component
const LivingRoomCanvas = ({ videoUrl }) => {
  return (
    <Canvas
      camera={{ position: [0, 0, 5], fov: 75 }}
      style={{ width: '100%', height: '100%' }}
    >
      <Suspense fallback={null}>
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} />
        <LivingRoomScene videoUrl={videoUrl} />
      </Suspense>
    </Canvas>
  );
};

// Usage in React component
const App = () => {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <LivingRoomCanvas videoUrl="/background.mp4" />
    </div>
  );
};

export default App;
""")
    
    # Example 3: Remotion integration
    example3_path = examples_dir / "remotion-video.tsx"
    with open(example3_path, 'w') as f:
        f.write("""// Remotion Video Integration Example
import React from 'react';
import { RemotionVideo } from './remotion-video';
import { LivingRoomCanvas } from './react-three-fiber';

// Remotion Video Template
const LivingRoomVideo = () => {
  return (
    <RemotionVideo
      durationInFrames={300} // 5 seconds at 60fps
      fps={60}
      width={1920}
      height={1080}
      codec="h264"
      bitrate={10_000_000}
      audioCodec="aac"
      audioBitrate={128_000}
      pixelFormat="yuv420p"
    >
      <LivingRoomCanvas videoUrl="/background.mp4" />
    </RemotionVideo>
  );
};

// Export component
export default LivingRoomVideo;
""")
    
    # Example 4: TypeScript types
    example4_path = examples_dir / "types.ts"
    with open(example4_path, 'w') as f:
        f.write("""// TypeScript Types for Three.js + Remotion Integration

export interface LivingRoomSceneProps {
  videoUrl: string;
  className?: string;
  style?: React.CSSProperties;
  onFrame?: (frame: number) => void;
}

export interface LivingRoomMaterial {
  name: string;
  type: 'wall' | 'floor' | 'ceiling' | 'furniture';
  color: [number, number, number, number];
  roughness?: number;
  metalness?: number;
  map?: string;
}

export interface LivingRoomObject {
  id: string;
  type: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  geometry: {
    vertices: number[][];
    faces: number[][];
  };
  material: LivingRoomMaterial;
}

export interface LivingRoomSceneData {
  rooms: LivingRoomObject[];
  furniture: LivingRoomObject[];
  metadata: {
    totalRooms: number;
    totalFurniture: number;
    physicsEnabled: boolean;
    processingTime: number;
  };
}

export interface LivingRoomAnimationConfig {
  duration: number;
  loop: boolean;
  easing?: string;
  keyframes: Array<{
    time: number;
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
  }>;
}
""")
    
    print(f"✅ Usage examples generated in: {examples_dir}")


def main():
    """Main function to demonstrate Three.js + Remotion export"""
    
    print("🚀 Three.js + Remotion Export Demo")
    print("=" * 50)
    
    # Export scenes
    results = export_for_three_js_remotion()
    
    # Print summary
    print("\n📊 Export Summary")
    print("=" * 50)
    
    for result in results:
        print(f"\n📁 {result['scene_name']}:")
        print(f"   Format: {result['export_format']}")
        print(f"   Size: {result['export_size']} bytes")
        print(f"   Rooms: {result['scene_info']['total_rooms']}")
        print(f"   Furniture: {result['scene_info']['total_furniture']}")
        print(f"   Physics: {result['scene_info']['physics_enabled']}")
    
    print("\n✅ Export completed successfully!")
    print("📁 Check the outputs directory for exported files and examples.")


if __name__ == "__main__":
    main()
"""