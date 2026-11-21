"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { SceneTools, ViewerModel } from "@/components/dashboard/ModelCanvas";
import { Icon } from "@/components/ui/Icon";
import type { V3 } from "@/lib/drawing/brep";
import { snapAxis } from "@/lib/drawing/extra";

const ModelCanvas = dynamic(() => import("@/components/dashboard/ModelCanvas").then((m) => m.ModelCanvas), { ssr: false });
const NO_COLORS = new Map<string, string>();
const NO_LOCATE = () => {};

// The scene is Y up; Onshape's Part Studio is Z up (stage.ts turns the model -90° about X).
const toPart = (v: THREE.Vector3): V3 => [v.x, -v.z, v.y];

// Add view (Harel, 2026-11-21): the part in 3D with the view cube top right; drag to turn it,
// then Add current view. The camera's direction (and its right) in the part's own axes goes to
// the drawing: on one of the cube's faces it's a straight, measured view, else a picture.
export function AddViewWindow({ model, busy, onAdd, onClose }: { model: ViewerModel; busy: boolean; onAdd: (dir: V3, right: V3) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tools, setTools] = useState<SceneTools | null>(null);
  const turn = useRef<THREE.Quaternion | null>(null);
  const [straight, setStraight] = useState(false);
  useEffect(() => dialog.current?.showModal(), []);
  useEffect(
    () =>
      tools?.watch((q) => {
        turn.current = q.clone();
        const { dir, right } = camera(q);
        setStraight(!!snapAxis(dir) && !!snapAxis(right));
      }),
    [tools],
  );
  const add = () => {
    if (!turn.current) return;
    const { dir, right } = camera(turn.current);
    // On a cube face (within 1°): exactly on it, so it's measured.
    const [w, h] = [snapAxis(dir), snapAxis(right)];
    onAdd(w && h ? w : dir, w && h ? h : right);
  };
  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="modal m-auto h-[min(42rem,calc(100dvh-2rem))] w-[min(56rem,calc(100vw-2rem))] max-w-none overflow-hidden p-0"
      aria-label="Add view"
    >
      <div className="flex h-full flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">Add view</h2>
          <span className="text-xs text-muted">{straight ? "Straight: measured, with dimensions" : "Angled: a picture, no dimensions"}</span>
          <button className="btn-primary h-8" onClick={add} disabled={!tools || busy}>
            {busy ? "Adding…" : "Add current view"}
          </button>
          <button onClick={onClose} className="press rounded p-1 text-muted hover:text-fg" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="relative min-h-0 flex-1">
          <ModelCanvas model={model} colors={NO_COLORS} mode="cad" locateKey={null} onLocated={NO_LOCATE} onTools={setTools} cube />
          {!tools && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted">Loading the part…</div>}
        </div>
      </div>
    </dialog>
  );
}

function camera(q: THREE.Quaternion): { dir: V3; right: V3 } {
  return { dir: toPart(new THREE.Vector3(0, 0, 1).applyQuaternion(q)), right: toPart(new THREE.Vector3(1, 0, 0).applyQuaternion(q)) };
}
