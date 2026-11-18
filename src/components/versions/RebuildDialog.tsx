"use client";

import { CALL_COSTS, costHint } from "@/config/callCosts";
import { Dialog } from "@/components/Dialog";

// Update system found nothing new in Onshape (Harel, 2026-11-18): say so, and offer Rebuild 3D
// model, which reads the system's assembly again even though no part changed (new mates, a model
// built before a change to how the app reads Onshape).
export function RebuildDialog({ open, onClose, onRebuild, text }: { open: boolean; onClose: () => void; onRebuild: () => void; text: string }) {
  return (
    <Dialog open={open} onClose={onClose} title="Up to date" width="w-[min(26rem,calc(100vw-2rem))]">
      <p className="text-sm text-fg-2">{text}</p>
      <p className="mt-2 text-sm text-muted">Rebuild the 3D model anyway to read the assembly again: its mates, groups and where every part sits.</p>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            onClose();
            onRebuild();
          }}
          {...costHint(CALL_COSTS.rebuildSystem)}
        >
          Rebuild 3D model
        </button>
      </div>
    </Dialog>
  );
}
