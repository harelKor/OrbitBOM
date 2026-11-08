"use client";

import { useActionState, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { createReview, type ReviewFormState } from "./actions";

export type RobotOption = { id: string; name: string; systems: { id: string; name: string; hasAssembly: boolean }[] };

// + New review: a name, the robot, a system (its assembly) or any assembly link, and a note.
// Saving sends round 1 at once.
export function NewReview({ robots, defaultRobotId }: { robots: RobotOption[]; defaultRobotId: string | null }) {
  const [open, setOpen] = useState(false);
  const [robotId, setRobotId] = useState(defaultRobotId ?? robots[0]?.id ?? "");
  const [systemId, setSystemId] = useState("");
  const [state, action, pending] = useActionState<ReviewFormState, FormData>(createReview, undefined);
  const robot = robots.find((r) => r.id === robotId);
  const system = robot?.systems.find((s) => s.id === systemId);

  return (
    <>
      <button className="btn-primary active:scale-[0.98]" onClick={() => setOpen(true)} disabled={!robots.length}>
        + New review
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New CAD review" sheet>
        <form action={action} className="space-y-3 p-5">
          <div>
            <label className="label" htmlFor="review-title">
              Design
            </label>
            <input id="review-title" name="title" required className="input w-full" placeholder="Intake v2" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="review-robot">
                Robot
              </label>
              <select
                id="review-robot"
                name="robotId"
                value={robotId}
                onChange={(e) => {
                  setRobotId(e.target.value);
                  setSystemId("");
                }}
                className="input w-full"
              >
                {robots.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="review-system">
                System
              </label>
              <select id="review-system" name="systemId" value={systemId} onChange={(e) => setSystemId(e.target.value)} className="input w-full">
                <option value="">None (a new design)</option>
                {robot?.systems.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="review-url">
              Onshape assembly{system?.hasAssembly ? " (empty: the system's)" : ""}
            </label>
            <input id="review-url" name="assemblyUrl" className="input w-full" placeholder="https://cad.onshape.com/documents/…/w/…/e/…" required={!system?.hasAssembly} />
          </div>
          <div>
            <label className="label" htmlFor="review-note">
              Note for the mentors
            </label>
            <textarea id="review-note" name="note" rows={3} className="input min-h-20 w-full" placeholder="What to look at first…" />
          </div>
          {state?.error && <p className="text-sm text-rose-500">{state.error}</p>}
          <button className="btn-primary w-full justify-center active:scale-[0.98]" disabled={pending}>
            {pending ? "Sending round 1…" : "Send for review"}
          </button>
          <p className="text-xs text-muted">Freezes the assembly as it is in Onshape now. Mentors see that state; your next edits don&rsquo;t change it.</p>
        </form>
      </Dialog>
    </>
  );
}
