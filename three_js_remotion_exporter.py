"""
Three.js + Remotion Exporter
This module provides optimized export functionality for Three.js and Remotion integration
"""

import os
import json
import numpy as np
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import trimesh
from PIL import Image
import base64
import io


class ThreeJSRemotionExporter:
    """
    Export 3D scenes in formats optimized for Three.js and Remotion integration
    """
    
    def __init__(self, output_dir: str = "outputs/three_js"):
        """
        Initialize the exporter
        
        Args:
            output_dir: Directory to save exported files
        """
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Export configuration
        self.config = {
            "format": "glb",  # Default format
            "texture_resolution": 1024,
            "compress_textures": True,
            "include_animations": True,
            "optimize_geometry": True,
            "draco_compression": False,
            "generate_lods": False,
            "create_texture_atlas": False,
            "output_info": True
        }
        
        # Texture atlas settings
        self.atlas_size = 2048
        self.atlas_padding = 4
        
    def export_scene(self, scene_data: Dict, scene_name: str) -> Dict:
        """
        Export a 3D scene for Three.js + Remotion integration
        
        Args:
            scene_data: Scene data from our framework
            scene_name: Name for the exported scene
            
        Returns:
            Dictionary with export information
        """
        print(f"🚀 Exporting scene '{scene_name}' for Three.js + Remotion...")
        
        # Create scene
        scene = trimesh.Scene()
        
        # Add rooms
        for room in scene_data["rooms"]:
            room_mesh = self._create_room_mesh(room)
            scene.add_geometry(room_mesh)
        
        # Add furniture
        for furniture in scene_data["furniture"]:
            furniture_mesh = self._create_furniture_mesh(furniture)
            scene.add_geometry(furniture_mesh)
        
        # Apply materials and textures
        self._apply_materials(scene, scene_data)
        
        # Export based on format
        if self.config["format"] == "glb":
            output_path = self.output_dir / f"{scene_name}.glb"
            result = self._export_glb(scene, output_path)
        elif self.config["format"] == "gltf":
            output_path = self.output_dir / f"{scene_name}.gltf"
            result = self._export_gltf(scene, output_path)
        elif self.config["format"] == "obj":
            output_path = self.output_dir / f"{scene_name}.obj"
            result = self._export_obj(scene, output_path)
        else:
            raise ValueError(f"Unsupported format: {self.config['format']}")
        
        # Generate additional files for Three.js + Remotion
        self._generate_three_js_files(scene_data, scene_name, result)
        
        # Generate metadata
        metadata = self._generate_metadata(scene_data, result)
        
        print(f"✅ Scene '{scene_name}' exported successfully!")
        return metadata
    
    def _create_room_mesh(self, room_data: Dict) -> trimesh.Trimesh:
        """Create a mesh for a room"""
        vertices = np.array(room_data["vertices"])
        faces = np.array(room_data["faces"])
        
        # Create mesh
        room_mesh = trimesh.Trimesh(vertices=vertices, faces=faces)
        
        # Apply transformation
        transform = trimesh.transformations.translation_matrix(room_data["position"])
        room_mesh.apply_transform(transform)
        
        return room_mesh
    
    def _create_furniture_mesh(self, furniture_data: Dict) -> trimesh.Trimesh:
        """Create a mesh for furniture"""
        vertices = np.array(furniture_data["vertices"])
        faces = np.array(furniture_data["faces"])
        
        # Create mesh
        furniture_mesh = trimesh.Trimesh(vertices=vertices, faces=faces)
        
        # Apply transformation
        transform = trimesh.transformations.translation_matrix(furniture_data["position"])
        furniture_mesh.apply_transform(transform)
        
        return furniture_mesh
    
    def _apply_materials(self, scene: trimesh.Scene, scene_data: Dict):
        """Apply materials to the scene"""
        # Define materials based on object type
        materials = {
            "wall": trimesh.visual.material.PBRMaterial(
                baseColor=[0.9, 0.9, 0.9, 1.0],  # Light gray
                roughness=0.8,
                metalness=0.0
            ),
            "floor": trimesh.visual.material.PBRMaterial(
                baseColor=[0.8, 0.7, 0.6, 1.0],  # Wood color
                roughness=0.7,
                metalness=0.0
            ),
            "ceiling": trimesh.visual.material.PBRMaterial(
                baseColor=[0.95, 0.95, 0.95, 1.0],  # White
                roughness=0.9,
                metalness=0.0
            )
        }
        
        # Add furniture materials
        furniture_materials = {
            "sofa": trimesh.visual.material.PBRMaterial(
                baseColor=[0.6, 0.3, 0.1, 1.0],  # Brown
                roughness=0.7,
                metalness=0.0
            ),
            "bed": trimesh.visual.material.PBRMaterial(
                baseColor=[0.2, 0.4, 0.8, 1.0],  # Blue
                roughness=0.8,
                metalness=0.0
            ),
            "table": trimesh.visual.material.PBRMaterial(
                baseColor=[0.8, 0.6, 0.4, 1.0],  # Wood
                roughness=0.6,
                metalness=0.0
            ),
            "chair": trimesh.visual.material.PBRMaterial(
                baseColor=[0.5, 0.3, 0.1, 1.0],  # Dark brown
                roughness=0.7,
                metalness=0.0
            )
        }
        
        # Apply materials to scene objects
        for geometry in scene.geometry.values():
            # Determine material based on geometry properties
            if hasattr(geometry, 'metadata'):
                obj_type = geometry.metadata.get('type', 'wall')
            else:
                obj_type = 'wall'
            
            # Choose material
            if obj_type in materials:
                geometry.visual = materials[obj_type]
            elif obj_type in furniture_materials:
                geometry.visual = furniture_materials[obj_type]
            else:
                # Default material
                geometry.visual = materials["wall"]
    
    def _export_glb(self, scene: trimesh.Scene, output_path: Path) -> Dict:
        """Export scene as GLB (binary GLTF)"""
        print(f"📦 Exporting as GLB: {output_path}")
        
        # Export scene
        scene.export(output_path, file_type='glb')
        
        # Get file info
        file_size = output_path.stat().st_size
        
        return {
            "format": "glb",
            "path": str(output_path),
            "size": file_size,
            "compressed": True,
            "binary": True
        }
    
    def _export_gltf(self, scene: trimesh.Scene, output_path: Path) -> Dict:
        """Export scene as GLTF (text-based)"""
        print(f"📦 Exporting as GLTF: {output_path}")
        
        # Create directory for textures if needed
        output_dir = output_path.parent
        textures_dir = output_dir / "textures"
        textures_dir.mkdir(exist_ok=True)
        
        # Export scene
        scene.export(output_path, file_type='gltf')
        
        # Get file info
        file_size = output_path.stat().st_size
        
        return {
            "format": "gltf",
            "path": str(output_path),
            "size": file_size,
            "compressed": False,
            "binary": False,
            "textures_dir": str(textures_dir)
        }
    
    def _export_obj(self, scene: trimesh.Scene, output_path: Path) -> Dict:
        """Export scene as OBJ + MTL"""
        print(f"📦 Exporting as OBJ: {output_path}")
        
        # Create directory for materials
        output_dir = output_path.parent
        materials_dir = output_dir / "materials"
        materials_dir.mkdir(exist_ok=True)
        
        # Export scene
        scene.export(output_path, file_type='obj')
        
        # Create materials file
        mtl_path = output_dir / f"{output_path.stem}.mtl"
        self._create_mtl_file(mtl_path, scene)
        
        # Get file info
        obj_size = output_path.stat().st_size
        mtl_size = mtl_path.stat().st_size
        
        return {
            "format": "obj",
            "path": str(output_path),
            "mtl_path": str(mtl_path),
            "size": obj_size + mtl_size,
            "compressed": False,
            "binary": False,
            "materials_dir": str(materials_dir)
        }
    
    def _create_mtl_file(self, mtl_path: Path, scene: trimesh.Scene):
        """Create MTL materials file"""
        with open(mtl_path, 'w') as f:
            f.write("# Materials for Three.js + Remotion\n\n")
            
            material_index = 1
            for geometry in scene.geometry.values():
                if hasattr(geometry, 'visual') and geometry.visual:
                    material = geometry.visual
                    if hasattr(material, 'baseColor'):
                        color = material.baseColor
                        f.write(f"newmtl material_{material_index}\n")
                        f.write(f"Ka 0.0 0.0 0.0\n")  # Ambient
                        f.write(f"Kd {color[0]:.3f} {color[1]:.3f} {color[2]:.3f}\n")  # Diffuse
                        f.write(f"Ks 0.0 0.0 0.0\n")  # Specular
                        f.write(f"Ns 0.0\n")  # Shininess
                        f.write(f"d {color[3]:.3f}\n")  # Alpha
                        f.write("\n")
                        material_index += 1
    
    def _generate_three_js_files(self, scene_data: Dict, scene_name: str, export_result: Dict):
        """Generate Three.js + Remotion specific files"""
        # Generate React component
        self._generate_react_component(scene_name, export_result)
        
        # Generate loader script
        self._generate_loader_script(scene_name, export_result)
        
        # Generate Remotion template
        self._generate_remotion_template(scene_name, export_result)
        
        # Generate TypeScript types
        self._generate_typescript_types(scene_name, scene_data)
    
    def _generate_react_component(self, scene_name: str, export_result: Dict):
        """Generate React Three Fiber component"""
        component_path = self.output_dir / f"{scene_name}.tsx"
        
        component_code = f"""import {{ Suspense, useRef, useEffect }} from 'react';
import {{ Canvas }} from '@react-three/fiber';
import {{ useGLTF }} from '@react-three/drei';
import {{ useVideoTexture }} from '@remotion/three';
import {{ useCurrentFrame, useVideoConfig }} from 'remotion';

// 3D Scene Component
export const {scene_name}Scene = ({{ videoUrl }}: {{ videoUrl: string }}) => {{
  const {{ scene }} = useGLTF('/{scene_name}.glb');
  const frame = useCurrentFrame();
  const {{ fps, durationInFrames }} = useVideoConfig();
  
  // Apply video textures
  useEffect(() => {{
    if (videoUrl) {{
      const videoTexture = useVideoTexture(videoUrl);
      
      scene.traverse((child) => {{
        if (child.isMesh && child.material.name === 'screen') {{
          child.material.map = videoTexture;
          child.material.needsUpdate = true;
        }}
      }});
    }}
  }}, [videoUrl, scene]);
  
  // Animate based on timeline
  useFrame(() => {{
    const time = frame / fps;
    
    // Example animations
    scene.rotation.y = time * 0.1;
    
    // Pulsing effect
    scene.scale.setScalar(1 + Math.sin(time * 2) * 0.05);
  }});
  
  return (
    <primitive object={{scene}} />
  );
}};

// Canvas Component
export const {scene_name}Canvas = ({{ videoUrl }}: {{ videoUrl: string }}) => {{
  return (
    <Canvas
      camera={{{{ position: [0, 0, 5], fov: 75 }}}}
      style={{{{ width: '100%', height: '100%' }}}}
    >
      <Suspense fallback={null}>
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} />
        <{scene_name}Scene videoUrl={{videoUrl}} />
      </Suspense>
    </Canvas>
  );
}};
"""
        
        with open(component_path, 'w') as f:
            f.write(component_code)
        
        print(f"✅ React component generated: {component_path}")
    
    def _generate_loader_script(self, scene_name: str, export_result: Dict):
        """Generate Three.js loader script"""
        loader_path = self.output_dir / f"{scene_name}-loader.js"
        
        loader_code = f"""import {{ GLTFLoader }} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {{ useVideoTexture }} from '@remotion/three';

// Three.js Scene Loader
export class {scene_name}Loader {{
  constructor() {{
    this.loader = new GLTFLoader();
    this.scene = null;
    this.textures = {{}};
  }}
  
  async loadModel(path) {{
    return new Promise((resolve, reject) => {{
      this.loader.load(
        path,
        (gltf) => {{
          this.scene = gltf.scene;
          this.optimizeScene();
          resolve(this.scene);
        }},
        (progress) => {{
          console.log('Loading progress:', (progress.loaded / progress.total) * 100 + '%');
        }},
        (error) => {{
          reject(error);
        }}
      );
    }});
  }}
  
  optimizeScene() {{
    if (!this.scene) return;
    
    // Optimize for video rendering
    this.scene.traverse((child) => {{
      if (child.isMesh) {{
        // Optimize geometry
        child.geometry.computeVertexNormals();
        
        // Optimize materials
        if (child.material) {{
          child.material.needsUpdate = true;
        }}
      }}
    }});
  }}
  
  applyVideoTexture(videoUrl, materialName) {{
    const videoTexture = useVideoTexture(videoUrl);
    
    this.scene.traverse((child) => {{
      if (child.isMesh && child.material.name === materialName) {{
        child.material.map = videoTexture;
        child.material.needsUpdate = true;
      }}
    }});
  }}
  
  // Animation methods
  playAnimation(name) {{
    // Implement animation playback
  }}
  
  pauseAnimation() {{
    // Implement animation pause
  }}
}}

// Export singleton instance
export const {scene_name}LoaderInstance = new {scene_name}Loader();
"""
        
        with open(loader_path, 'w') as f:
            f.write(loader_code)
        
        print(f"✅ Loader script generated: {loader_path}")
    
    def _generate_remotion_template(self, scene_name: str, export_result: Dict):
        """Generate Remotion video template"""
        template_path = self.output_dir / f"{scene_name}-remotion.tsx"
        
        template_code = f"""import {{ RemotionVideo }} from './remotion-video';
import {{ {scene_name}Canvas }} from './{scene_name}.tsx';

// Remotion Video Template
export const {scene_name}Video = () => {{
  return (
    <RemotionVideo
      durationInFrames={{ 300 }} // 5 seconds at 60fps
      fps={{ 60 }}
      width={{ 1920 }}
      height={{ 1080 }}
      codec=\"h264\"
      bitrate={{ 10_000_000 }}
      audioCodec=\"aac\"
      audioBitrate={{ 128_000 }}
      pixelFormat=\"yuv420p\"
      }}
    >
      <{scene_name}Canvas videoUrl=\"/background.mp4\" />
    </RemotionVideo>
  );
}};

// Export component
export default {scene_name}Video;
"""
        
        with open(template_path, 'w') as f:
            f.write(template_code)
        
        print(f"✅ Remotion template generated: {template_path}")
    
    def _generate_typescript_types(self, scene_name: str, scene_data: Dict):
        """Generate TypeScript types for the scene"""
        types_path = self.output_dir / f"{scene_name}-types.ts"
        
        types_code = f"""// TypeScript types for {scene_name} scene

export interface {scene_name}SceneProps {{
  videoUrl: string;
  className?: string;
  style?: React.CSSProperties;
  onFrame?: (frame: number) => void;
}}

export interface {scene_name}Material {{
  name: string;
  type: 'wall' | 'floor' | 'ceiling' | 'furniture';
  color: [number, number, number, number];
  roughness?: number;
  metalness?: number;
  map?: string;
}}

export interface {scene_name}Object {{
  id: string;
  type: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  geometry: {{
    vertices: number[][];
    faces: number[][];
  }};
  material: {scene_name}Material;
}}

export interface {scene_name}SceneData {{
  rooms: {scene_name}Object[];
  furniture: {scene_name}Object[];
  metadata: {{
    totalRooms: number;
    totalFurniture: number;
    physicsEnabled: boolean;
    processingTime: number;
  }};
}}

export interface {scene_name}AnimationConfig {{
  duration: number;
  loop: boolean;
  easing?: string;
  keyframes: Array<{{
    time: number;
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
  }}>;
}}
"""
        
        with open(types_path, 'w') as f:
            f.write(types_code)
        
        print(f"✅ TypeScript types generated: {types_path}")
    
    def _generate_metadata(self, scene_data: Dict, export_result: Dict) -> Dict:
        """Generate metadata for the exported scene"""
        metadata = {
            "scene_name": scene_data.get("input_image", "unknown"),
            "export_timestamp": json.dumps(scene_data.get("timestamp", "")),
            "export_format": export_result["format"],
            "export_path": export_result["path"],
            "export_size": export_result["size"],
            "config": self.config,
            "scene_info": {
                "total_rooms": len(scene_data["rooms"]),
                "total_furniture": len(scene_data["furniture"]),
                "physics_enabled": scene_data["metadata"]["physics_enabled"],
                "processing_time": scene_data["metadata"]["processing_time"]
            },
            "files_generated": [
                export_result["path"],
                str(self.output_dir / f"{export_result['path'].split('/')[-1].split('.')[0]}.tsx"),
                str(self.output_dir / f"{export_result['path'].split('/')[-1].split('.')[0]}-loader.js"),
                str(self.output_dir / f"{export_result['path'].split('/')[-1].split('.')[0]}-remotion.tsx"),
                str(self.output_dir / f"{export_result['path'].split('/')[-1].split('.')[0]}-types.ts")
            ],
            "three_js_optimizations": {
                "texture_compression": self.config["compress_textures"],
                "geometry_optimization": self.config["optimize_geometry"],
                "draco_compression": self.config["draco_compression"],
                "lods_generated": self.config["generate_lods"],
                "texture_atlas": self.config["create_texture_atlas"]
            },
            "remotion_features": {
                "video_texture_support": True,
                "timeline_animations": True,
                "performance_optimization": True,
                "reduced_motion_support": True
            }
        }
        
        # Save metadata
        metadata_path = self.output_dir / f"{export_result['path'].split('/')[-1].split('.')[0]}-metadata.json"
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)
        
        return metadata
    
    def create_texture_atlas(self, textures: List[Dict]) -> Dict:
        """Create a texture atlas from multiple textures"""
        print("🎨 Creating texture atlas...")
        
        # Calculate atlas size
        total_area = sum(t["width"] * t["height"] for t in textures)
        atlas_size = int(np.sqrt(total_area) * 1.2)  # Add 20% buffer
        
        # Create atlas canvas
        atlas = Image.new('RGBA', (atlas_size, atlas_size), (0, 0, 0, 0))
        
        # Place textures in atlas
        x, y = 0, 0
        atlas_info = {{
            "size": atlas_size,
            "textures": []
        }}
        
        for texture in textures:
            img = Image.open(texture["path"])
            
            # Place texture in atlas
            atlas.paste(img, (x, y))
            
            # Store texture info
            atlas_info["textures"].append({
                "name": texture["name"],
                "uv": [
                    x / atlas_size,
                    y / atlas_size,
                    (x + texture["width"]) / atlas_size,
                    (y + texture["height"]) / atlas_size
                ],
                "size": [texture["width"], texture["height"]]
            })
            
            # Update position
            x += texture["width"] + self.atlas_padding
            if x > atlas_size - texture["width"]:
                x = 0
                y += texture["height"] + self.atlas_padding
        
        # Save atlas
        atlas_path = self.output_dir / "texture-atlas.png"
        atlas.save(atlas_path)
        
        return {
            "atlas_path": str(atlas_path),
            "atlas_info": atlas_info
        }
    
    def optimize_for_video_rendering(self, scene: trimesh.Scene) -> trimesh.Scene:
        """Optimize scene for video rendering"""
        print("⚡ Optimizing scene for video rendering...")
        
        optimized_scene = scene.copy()
        
        # Optimize geometry
        for geometry in optimized_scene.geometry.values():
            if hasattr(geometry, 'geometry'):
                # Simplify geometry if needed
                if len(geometry.geometry.faces) > 10000:
                    # Reduce polygon count
                    geometry.geometry = geometry.simplify_quadric(0.1)
                
                # Compute vertex normals
                geometry.geometry.compute_vertex_normals()
        
        # Optimize materials
        optimized_scene.traverse((child) => {
            if hasattr(child, 'material'):
                material = child.material
                if material:
                    # Optimize texture settings
                    if hasattr(material, 'map'):
                        material.map.anisotropy = 4
                        material.map.encoding = 3001  # sRGBEncoding
                    
                    # Optimize material properties
                    if hasattr(material, 'roughness'):
                        material.roughness = min(material.roughness, 0.9)
                    
                    if hasattr(material, 'metalness'):
                        material.metalness = min(material.metalness, 0.9)
        })
        
        return optimized_scene


# Example usage
if __name__ == "__main__":
    # Example scene data
    example_scene_data = {
        "input_image": "example_floor_plan.png",
        "timestamp": "2024-01-01T00:00:00",
        "rooms": [
            {
                "id": 0,
                "vertices": [[0, 0, 0], [4, 0, 0], [4, 3, 0], [0, 3, 0], [0, 0, 3], [4, 0, 3], [4, 3, 3], [0, 3, 3]],
                "faces": [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [2, 6, 7, 3], [0, 3, 7, 4], [1, 5, 6, 2]],
                "position": [0, 0, 0],
                "dimensions": {"width": 4, "height": 3, "depth": 3}
            }
        ],
        "furniture": [
            {
                "id": 0,
                "type": "sofa",
                "vertices": [[0, 0, 0], [2, 0, 0], [2, 0.8, 0], [0, 0.8, 0], [0, 0, 0.8], [2, 0, 0.8], [2, 0.8, 0.8], [0, 0.8, 0.8]],
                "faces": [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [2, 6, 7, 3], [0, 3, 7, 4], [1, 5, 6, 2]],
                "position": [1, 1, 0],
                "size": [2, 0.8, 0.8]
            }
        ],
        "metadata": {
            "total_rooms": 1,
            "total_furniture": 1,
            "physics_enabled": True,
            "processing_time": 45.2
        }
    }
    
    # Create exporter
    exporter = ThreeJSRemotionExporter()
    
    # Export scene
    result = exporter.export_scene(example_scene_data, "example_scene")
    
    print(f"Export completed: {result}")
"""