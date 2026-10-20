"use client";

import { useActionState } from "react";
import { createRobot } from "../actions";

export function NewRobotForm() {
  const [state, action, pending] = useActionState(createRobot, undefined);
  return (
    <form action={action} className="panel max-w-lg space-y-4 p-6">
      <div>
        <label className="label" htmlFor="name">
          Robot name *
        </label>
        <input id="name" name="name" required className="input" placeholder="e.g. Blitzer" />
      </div>
      <div>
        <label className="label" htmlFor="year">
          Competition year *
        </label>
        <input
          id="year"
          name="year"
          type="number"
          required
          className="input"
          defaultValue={new Date().getFullYear() + 1}
        />
      </div>
      <div>
        <label className="label" htmlFor="mainAssemblyUrl">
          Main assembly URL (optional)
        </label>
        <input
          id="mainAssemblyUrl"
          name="mainAssemblyUrl"
          className="input"
          placeholder="https://…onshape.com/documents/…/w/…/e/…"
        />
        <p className="mt-1 text-xs text-subtle">Used for the robot&apos;s thumbnail.</p>
      </div>
      {state?.error && <p className="text-sm text-rose-700">{state.error}</p>}
      <button className="btn-primary" disabled={pending}>
        {pending ? "Creating…" : "Create robot"}
      </button>
    </form>
  );
}
