"use client";

import { useActionState } from "react";
import { linkAssembly, linkMainAssembly, setBatchLayoutsDocument } from "./actions";
import { SystemChoice, type ChoiceSystem } from "./SystemChoice";

// An unlinked assembly outside any Basepart document: a system's or the robot's Final, the
// assembly the BOM is read from (Harel, 2026-11-12), or the robot's Batch Layouts document.
export function LinkAssemblyForm({
  assemblyUrl,
  query,
  documentUrl,
  robots,
  systems,
  layoutsFor,
  onshapeConnected,
  isAdmin,
  divided = false,
}: {
  assemblyUrl: string;
  query: string; // the panel's place, to come back to its home after linking
  documentUrl: string;
  robots: { id: string; name: string }[];
  systems: ChoiceSystem[]; // systems with no Final yet (started from their Basepart)
  layoutsFor: string[]; // robots whose Batch Layouts document this is
  onshapeConnected: boolean;
  isAdmin: boolean; // only admins can set the robot's Final
  divided?: boolean; // below another form (Replace as robot Basepart)
}) {
  const [state, action, pending] = useActionState(linkAssembly.bind(null, assemblyUrl, query), undefined);
  const [mainState, mainAction, mainPending] = useActionState(linkMainAssembly.bind(null, assemblyUrl, query), undefined);
  const [layoutsState, layoutsAction, layoutsPending] = useActionState(setBatchLayoutsDocument.bind(null, documentUrl), undefined);

  if (!robots.length) return <p className="text-muted">Create a robot in OrbitParts first, then reopen this panel.</p>;
  return (
    <div className={`space-y-6 ${divided ? "border-t border-line pt-5" : ""}`}>
      {layoutsFor.length > 0 && (
        <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 font-semibold text-emerald-700 dark:text-emerald-300">
          ✓ Used as Batch Layouts document for {layoutsFor.join(", ")}
        </p>
      )}
      {isAdmin && (
        <form action={mainAction} className="space-y-3">
          <h1 className="text-base font-semibold">Is this the whole robot&apos;s Final?</h1>
          <p className="text-muted">Use it as the robot&apos;s Final assembly, with every system&apos;s Final in it.</p>
          <select name="robotId" aria-label="Robot" className="input" required>
            {robots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          {mainState?.error && <p className="text-rose-700">{mainState.error}</p>}
          <button className="btn w-full active:scale-[0.98]" disabled={mainPending}>
            {mainPending ? "Linking…" : "Sync as robot Final"}
          </button>
        </form>
      )}
      <form action={action} className={isAdmin ? "space-y-3 border-t border-line pt-5" : "space-y-3"}>
        <h2 className="text-base font-semibold">{isAdmin ? "Or sync it as a system's Final" : "Sync it as a system's Final"}</h2>
        <p className="text-muted">The system&apos;s BOM is read from its Final assembly.</p>
        <SystemChoice robots={robots} systems={systems} idPrefix="final" />
        {!onshapeConnected && <p className="text-amber-700">Connect Onshape on your OrbitParts profile page to pull the parts.</p>}
        {state?.error && <p className="text-rose-700">{state.error}</p>}
        <button className="btn-primary w-full active:scale-[0.98]" disabled={pending}>
          {pending ? "Linking and syncing…" : "Sync as system Final"}
        </button>
      </form>
      <form action={layoutsAction} className="space-y-3 border-t border-line pt-5">
        <h2 className="text-base font-semibold">Or keep Fab batch layouts here</h2>
        <p className="text-muted">Onshape Layout makes each batch&apos;s &quot;Batch - name&quot; assembly in this document.</p>
        {robots.length > 1 && (
          <select name="robotId" aria-label="Robot" className="input" required>
            {robots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
        {robots.length === 1 && <input type="hidden" name="robotId" value={robots[0].id} />}
        {layoutsState?.error && <p className="text-rose-700">{layoutsState.error}</p>}
        {layoutsState?.saved && !layoutsPending && <p className="text-emerald-700 dark:text-emerald-300">Saved.</p>}
        <button className="btn w-full active:scale-[0.98]" disabled={layoutsPending}>
          {layoutsPending ? "Saving…" : robots.length === 1 ? `Use this document for ${robots[0].name}'s Batch Layouts` : "Use this document for the robot's Batch Layouts"}
        </button>
      </form>
    </div>
  );
}
