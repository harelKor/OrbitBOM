"use client";

import { useActionState, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { MACHINES } from "@/config/machines";
import { ALL_MATERIALS } from "@/config/materials";
import { addManualPart } from "@/app/(app)/parts-actions";

// FRCBOM's "Add Manual Part" dialog (ref §2b).
export function ManualPartButton({ systemId }: { systemId: string }) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [state, action, pending] = useActionState(
    async (prev: { error?: string } | undefined, formData: FormData) => {
      const result = await addManualPart(systemId, prev, formData);
      if (!result.error) {
        setOpen(false);
        setFormKey((k) => k + 1);
      }
      return result;
    },
    undefined,
  );

  const machineSelect = (name: string, label: string, stage: "Process" | "PreProcess") => (
    <select name={name} className="input" defaultValue="">
      <option value="">{label} (optional)</option>
      {MACHINES.filter((m) => m.stage === stage).map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <button className="btn-primary bg-emerald-600 hover:bg-emerald-500" onClick={() => setOpen(true)}>
        + Manual part
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Add Manual Part">
        <form key={formKey} action={action} className="space-y-3">
          <input name="name" required placeholder="Part Name *" className="input" />
          <div className="grid grid-cols-2 gap-3">
            <input name="quantity" type="number" min={0} required defaultValue={1} className="input" aria-label="Quantity" />
            <input name="material" placeholder="Material" list="manual-materials" className="input" />
            <datalist id="manual-materials">
              {ALL_MATERIALS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {machineSelect("preProcess", "Pre Process", "PreProcess")}
            {machineSelect("process1", "Process 1", "Process")}
            {machineSelect("process2", "Process 2", "Process")}
          </div>
          <input name="drawingUrl" type="url" placeholder="Drawing PDF link (optional, https://…)" className="input" />
          {state?.error && <p className="text-sm text-rose-300">{state.error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
