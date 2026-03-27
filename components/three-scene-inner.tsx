"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

function DefaultScene() {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[4, 4, 4]} intensity={0.8} />
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#8b5cf6" />
      </mesh>
      <OrbitControls makeDefault />
    </>
  );
}

export function ThreeSceneInner() {
  return (
    <Canvas camera={{ position: [2, 2, 2], fov: 50 }} style={{ width: "100%", height: "100%", minHeight: 200 }}>
      <DefaultScene />
    </Canvas>
  );
}
