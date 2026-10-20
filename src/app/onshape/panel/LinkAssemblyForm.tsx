"use client";

import { useActionState } from "react";
import { linkAssembly, linkMainAssembly } from "./actions";

export function LinkAssemblyForm({
  assemblyUrl,
  robots,
  onshapeConnected,
}: {
  assemblyUrl: string;
  robots: { id: string; name: string }[];
  onshapeConnected: boolean;
}) {
  const [state, action, pending] = useActionState(
    linkAssembly.bind(null, assemblyUrl),
    undefined,
  );
  const [mainState, mainAction, mainPending] = useActionState(
    linkMainAssembly.bind(null, assemblyUrl),
    undefined,
  );

  if (!robots.length)
    return (
      <p className="text-muted">
        Create a robot in OrbitMech first, then reopen this panel.
      </p>
    );
  return (
    <div className="space-y-6">
      <form action={mainAction} className="space-y-3">
        <h1 className="text-base font-semibold">Is this the whole robot?</h1>
        <p className="text-muted">
          Use it as the robot&apos;s main assembly. The 3D view on the robot
          page is built from it.
        </p>
        <select name="robotId" aria-label="Robot" className="input" required>
          {robots.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {mainState?.error && <p className="text-rose-700">{mainState.error}</p>}
        <button className="btn w-full" disabled={mainPending}>
          {mainPending ? "Linking…" : "Use as main assembly"}
        </button>
      </form>
      <form action={action} className="space-y-3 border-t border-line pt-5">
        <h2 className="text-base font-semibold">
          Or add it to a robot as a system
        </h2>
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
          <input
            id="panel-name"
            name="name"
            className="input"
            required
            placeholder="e.g. Intake"
          />
        </div>
        {!onshapeConnected && (
          <p className="text-amber-700">
            Connect Onshape on your OrbitMech profile page to pull the parts.
          </p>
        )}
        {state?.error && <p className="text-rose-700">{state.error}</p>}
        <button className="btn-primary w-full" disabled={pending}>
          {pending ? "Linking and syncing…" : "Link & sync"}
        </button>
      </form>
    </div>
  );
}
