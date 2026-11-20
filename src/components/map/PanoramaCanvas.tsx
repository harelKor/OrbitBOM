"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { clampPano, cylinder, pitchOf, yawOf, type Box, type Pano, type Pic } from "./panorama";

// The 360° picture drawn with WebGL (Harel, 2026-11-20): the picture inside an open cylinder, the
// camera at its centre (maths in panorama.ts). Draws only when the view or the box changes, so a
// phone does nothing while nobody touches it. Loaded with next/dynamic: three.js stays out of the
// pages that never show a panorama.

// The picture as a same-origin blob, so WebGL may read it whatever the R2 link's CORS caching did
// (an <img> elsewhere may have cached it without CORS headers): first the cache, then the network.
async function loadPicture(src: string, signal: AbortSignal): Promise<HTMLImageElement> {
  const get = (cache: RequestCache) => fetch(src, { mode: "cors", cache, signal }).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))));
  const blob = await get("default").catch((e) => (signal.aborted ? Promise.reject(e) : get("reload")));
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // The decoded picture stays usable after its URL goes.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export default function PanoramaCanvas({ src, pic, pano, box, onError }: { src: string; pic: Pic; pano: Pano; box: Box; onError?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const gl = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; mesh: THREE.Mesh } | null>(null);
  const [ready, setReady] = useState(0);
  const frame = useRef(0);

  // One renderer per picture.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ctrl = new AbortController();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "low-power" });
    } catch {
      onError?.();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    el.appendChild(renderer.domElement);
    const { r, H } = cylinder(pic);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, r * 0.05, r * 4);
    camera.rotation.order = "YXZ";
    const geometry = new THREE.CylinderGeometry(r, r, H, 160, 1, true);
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0 });
    const mesh = new THREE.Mesh(geometry, material);
    // Mirrored, so the picture reads left to right from inside.
    mesh.scale.x = -1;
    scene.add(mesh);
    gl.current = { renderer, scene, camera, mesh };
    let texture: THREE.Texture | null = null;
    loadPicture(src, ctrl.signal).then(
      (img) => {
        texture = new THREE.Texture(img);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.needsUpdate = true;
        material.map = texture;
        material.opacity = 1;
        material.transparent = false;
        material.needsUpdate = true;
        setReady((n) => n + 1);
      },
      () => !ctrl.signal.aborted && onError?.(),
    );
    return () => {
      ctrl.abort();
      cancelAnimationFrame(frame.current);
      texture?.dispose();
      material.dispose();
      geometry.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      gl.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new picture is a new renderer
  }, [src, pic.w, pic.h]);

  // Draw the newest view on the next frame (several changes in one frame draw once).
  useEffect(() => {
    const g = gl.current;
    if (!g || !box.w || !box.h) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const p = clampPano(pano, pic);
      const { renderer, camera, scene } = g;
      const size = renderer.getSize(new THREE.Vector2());
      if (size.x !== box.w || size.y !== box.h) renderer.setSize(box.w, box.h, false);
      camera.aspect = box.w / box.h;
      camera.fov = p.fov;
      camera.rotation.set(pitchOf(p.v, pic), yawOf(p.u), 0);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    });
  }, [pano, box.w, box.h, pic, ready]);

  return <div ref={host} className="absolute inset-0" aria-hidden />;
}
