"use client";

import { useActionState, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { createSystem } from "../actions";

// small: the compact button beside the systems in the robots panel.
export function NewSystemButton({ robotId, small = false }: { robotId: string; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createSystem.bind(null, robotId), undefined);

  return (
    <>
      <button
        className={small ? "press rounded-md border border-line-strong px-2 py-0.5 text-xs font-semibold text-fg-2 hover:border-accent hover:text-accent" : "btn-primary"}
        onClick={() => setOpen(true)}
      >
        + {small ? "Add system" : "New system"}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New system">
        <form action={action} className="space-y-4">
          <div>
            <label className="label" htmlFor="sys-name">
              System name
            </label>
            <input id="sys-name" name="name" required className="input" placeholder="e.g. Drivetrain" />
          </div>
          <div>
            <label className="label" htmlFor="sys-url">
              System assembly URL (optional)
            </label>
            <input
              id="sys-url"
              name="assemblyUrl"
              className="input"
              placeholder="https://…onshape.com/documents/…/w/…/e/…"
            />
            <p className="mt-1 text-xs text-subtle">
              If provided, we&apos;ll fetch the document&apos;s part studios and subassemblies for you.
            </p>
          </div>
          {state?.error && <p className="text-sm text-rose-700">{state.error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" disabled={pending}>
              {pending ? "Creating…" : "Create system"}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
