"use client";

import dynamic from "next/dynamic";

/**
 * Minimal Three.js scene (React Three Fiber + Drei).
 * Loaded only on the client. Replace the default scene with your 3D viz
 * (e.g. volatility surface, option payoff, etc.).
 */
const Scene = dynamic(() => import("./three-scene-inner").then((m) => m.ThreeSceneInner), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center rounded bg-muted/20 text-sm text-muted-foreground">
      Loading 3D…
    </div>
  ),
});

export function ThreeScene({ className }: { className?: string }) {
  return <div className={className} style={{ width: "100%", height: "100%", minHeight: 200 }}><Scene /></div>;
}
