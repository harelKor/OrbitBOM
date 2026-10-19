"use client";

import { useActionState } from "react";
import { linkAssembly } from "./actions";

export function LinkAssemblyForm({
  assemblyUrl,
  robots,
  onshapeConnected,
}: {
  assemblyUrl: string;
  robots: { id: string; name: string }[];
  onshapeConnected: boolean;
}) {
  const [state, action, pending] = useActionState(linkAssembly.bind(null, assemblyUrl), undefined);

  if (!robots.length) return <p className="text-slate-400">Create a robot in OrbitBOM first, then reopen this panel.</p>;
  return (
    <form action={action} className="space-y-3">
      <h1 className="text-base font-semibold">Add this assembly to a robot</h1>
      <div>
        <label className="label" htmlFor="panel-robot">
          Robot
        </label>
        <select id="panel-robot" name="robotId" className="input" required>
          {robots.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="panel-name">
          System name
        </label>
        <input id="panel-name" name="name" className="input" required placeholder="e.g. Intake" />
      </div>
      {!onshapeConnected && (
        <p className="text-amber-300">Connect Onshape on your OrbitBOM profile page to pull the parts.</p>
      )}
      {state?.error && <p className="text-rose-300">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Linking and syncing…" : "Link & sync"}
      </button>
    </form>
  );
}
