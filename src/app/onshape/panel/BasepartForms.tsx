"use client";

import { CALL_COSTS, costHint } from "@/config/callCosts";
import { useActionState } from "react";
import { replaceBasepart, saveGeometry, syncBasepart } from "./actions";
import { GeometryPicker } from "./GeometryPicker";
import { SystemChoice, type ChoiceRobot, type ChoiceSystem } from "./SystemChoice";
import type { GeometrySketch } from "@/db/schema";

// The panel in an unlinked Part Studio (Harel, 2026-11-12): only "Sync as system Basepart", and
// for admins "Sync as robot Basepart". A Basepart is 3D and comments only, no BOM; its Geometry
// sketches are chosen here.
export function SyncBasepartForm({
  studioUrl,
  query,
  robots,
  systems,
  isAdmin,
  onshapeConnected,
}: {
  studioUrl: string;
  query: string;
  robots: ChoiceRobot[];
  systems: ChoiceSystem[]; // systems with no Basepart yet (started from their Final)
  isAdmin: boolean;
  onshapeConnected: boolean;
}) {
  const [state, action, pending] = useActionState(syncBasepart.bind(null, studioUrl, query, "system"), undefined);
  const [robotState, robotAction, robotPending] = useActionState(syncBasepart.bind(null, studioUrl, query, "robot"), undefined);
  if (!robots.length) return <p className="text-muted">Create a robot in OrbitParts first, then reopen this panel.</p>;
  return (
    <div className="space-y-6">
      {!onshapeConnected && <p className="text-amber-700">Connect Onshape on your OrbitParts profile page to show it in 3D.</p>}
      <form action={action} className="space-y-3">
        <h1 className="text-base font-semibold">Sync as system Basepart</h1>
        <p className="text-muted">Shown in the system&apos;s Basepart 3D view. The BOM comes later, from its Final assembly.</p>
        <SystemChoice robots={robots} systems={systems} idPrefix="basepart" />
        <GeometryPicker studioUrl={studioUrl} />
        {state?.error && <p className="text-rose-700">{state.error}</p>}
        <button className="btn-primary w-full active:scale-[0.98]" disabled={pending} {...costHint(CALL_COSTS.basepart)}>
          {pending ? "Syncing…" : "Sync as system Basepart"}
        </button>
      </form>
      {isAdmin && (
        <form action={robotAction} className="space-y-3 border-t border-line pt-5">
          <h2 className="text-base font-semibold">Or sync as robot Basepart</h2>
          <select name="robotId" aria-label="Robot" className="input" required>
            {robots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <GeometryPicker studioUrl={studioUrl} />
          {robotState?.error && <p className="text-rose-700">{robotState.error}</p>}
          <button className="btn w-full active:scale-[0.98]" disabled={robotPending} {...costHint(CALL_COSTS.basepart)}>
            {robotPending ? "Syncing…" : "Sync as robot Basepart"}
          </button>
        </form>
      )}
    </div>
  );
}

// The panel in an unlinked assembly in the same document as a Basepart Part Studio: "Replace as
// system Basepart", and for admins "Replace as robot Basepart" in the robot's document.
export function ReplaceBasepartForm({
  assemblyUrl,
  query,
  systems,
  robots,
}: {
  assemblyUrl: string;
  query: string;
  systems: { id: string; name: string; robotName: string }[];
  robots: ChoiceRobot[]; // admins only
}) {
  const [state, action, pending] = useActionState(replaceBasepart.bind(null, assemblyUrl, query, "system"), undefined);
  const [robotState, robotAction, robotPending] = useActionState(replaceBasepart.bind(null, assemblyUrl, query, "robot"), undefined);
  return (
    <div className="space-y-6">
      {systems.length > 0 && (
        <form action={action} className="space-y-3">
          <h1 className="text-base font-semibold">Replace as system Basepart</h1>
          <p className="text-muted">This assembly takes the place of the Basepart Part Studio. Its Geometry sketches stay.</p>
          {systems.length > 1 ? (
            <select name="id" aria-label="System" className="input" required>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.robotName} · {s.name}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input type="hidden" name="id" value={systems[0].id} />
              <p className="font-semibold">
                {systems[0].robotName} · {systems[0].name}
              </p>
            </>
          )}
          {state?.error && <p className="text-rose-700">{state.error}</p>}
          <button className="btn-primary w-full active:scale-[0.98]" disabled={pending} {...costHint(CALL_COSTS.basepart)}>
            {pending ? "Replacing…" : "Replace as system Basepart"}
          </button>
        </form>
      )}
      {robots.length > 0 && (
        <form action={robotAction} className={`space-y-3 ${systems.length ? "border-t border-line pt-5" : ""}`}>
          <h2 className="text-base font-semibold">Replace as robot Basepart</h2>
          <p className="text-muted">This assembly takes the place of the robot&apos;s Basepart Part Studio.</p>
          {robots.length > 1 ? (
            <select name="id" aria-label="Robot" className="input" required>
              {robots.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          ) : (
            <input type="hidden" name="id" value={robots[0].id} />
          )}
          {robotState?.error && <p className="text-rose-700">{robotState.error}</p>}
          <button className="btn w-full active:scale-[0.98]" disabled={robotPending} {...costHint(CALL_COSTS.basepart)}>
            {robotPending ? "Replacing…" : robots.length === 1 ? `Replace as ${robots[0].name}'s Basepart` : "Replace as robot Basepart"}
          </button>
        </form>
      )}
    </div>
  );
}

// The panel's Geometry page: the Basepart's sketches chosen again.
export function GeometryForm({ target, id, query, studioUrl, initial }: { target: "system" | "robot"; id: string; query: string; studioUrl: string; initial: GeometrySketch[] }) {
  const [state, action, pending] = useActionState(saveGeometry.bind(null, target, id, query), undefined);
  return (
    <form action={action} className="space-y-3">
      <GeometryPicker studioUrl={studioUrl} initial={initial} />
      {state?.error && <p className="text-rose-700">{state.error}</p>}
      <button className="btn-primary w-full active:scale-[0.98]" disabled={pending} {...costHint(CALL_COSTS.basepart)}>
        {pending ? "Saving…" : "Save Geometry"}
      </button>
    </form>
  );
}
