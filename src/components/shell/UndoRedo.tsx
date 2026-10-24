"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { redoAction, undoAction } from "@/app/(app)/undo-actions";
import { Icon } from "@/components/ui/Icon";
import { toast } from "@/components/ui/Toaster";
import { useEditMode } from "./ModeContext";

const KEY = "orbit-undo";
type Stacks = { exclude: string[]; redo: string[] };

function load(): Stacks {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Stacks | null;
    if (s && Array.isArray(s.exclude) && Array.isArray(s.redo)) return s;
  } catch {}
  return { exclude: [], redo: [] };
}
function save(s: Stacks) {
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        exclude: s.exclude.slice(-200),
        redo: s.redo.slice(-30),
      }),
    );
  } catch {}
}

// Undo / Redo (plan/system-versioning.md §8): buttons in the top bar in Edit mode, and
// Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) in either mode, not while typing. Undo puts back this member's newest part
// edit; it is a new change, so a field someone changed since is left alone and the toast says
// so. This tab remembers what it undid (sessionStorage), so two tabs never fight.
export function UndoRedo() {
  const edit = useEditMode();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is browser-only
    setCanRedo(load().redo.length > 0);
  }, []);

  const run = async (kind: "undo" | "redo") => {
    if (busyRef.current) return;
    const s = load();
    if (kind === "redo" && !s.redo.length) return toast("Nothing to redo.");
    busyRef.current = true;
    setBusy(true);
    try {
      if (kind === "undo") {
        const r = await undoAction(s.exclude);
        if (r.error) return toast(r.error, true);
        if (r.undone) s.exclude.push(r.undone);
        if (r.batchId) {
          s.exclude.push(r.batchId);
          s.redo.push(r.batchId);
        }
        toast(r.message ?? "Undone.");
      } else {
        const id = s.redo.pop()!;
        const r = await redoAction(id);
        if (r.error) return toast(r.error, true);
        toast(r.message ?? "Redone.");
      }
      save(s);
      setCanRedo(s.redo.length > 0);
      router.refresh();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      e.preventDefault();
      void runRef.current(key === "y" || e.shiftKey ? "redo" : "undo");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (!edit) return null;
  const btn = "press flex h-8 w-8 items-center justify-center rounded-md border border-white/30 hover:bg-white/10 disabled:opacity-40";
  return (
    <div className="flex items-center gap-1">
      <button type="button" className={btn} disabled={busy} onClick={() => run("undo")} aria-label="Undo" title="Undo my last change (Ctrl+Z)">
        <Icon name="undo" className="h-4 w-4" />
      </button>
      <button type="button" className={btn} disabled={busy || !canRedo} onClick={() => run("redo")} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
        <Icon name="redo" className="h-4 w-4" />
      </button>
    </div>
  );
}
