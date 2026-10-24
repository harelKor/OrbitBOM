"use client";

import { useState, useTransition } from "react";
import { TEAMS, type Team } from "@/config/teams";
import { SystemSelect, type TeamSystemOption } from "./SystemSelect";

// The profile's team boxes: Build Team or CAD Team, and for CAD Team an optional subsystem.
// Saves on every click; clicking the selected box again clears the team.
export function TeamPicker({
  team,
  systemId,
  systems,
  save,
}: {
  team: Team | null;
  systemId: string | null;
  systems: TeamSystemOption[];
  save: (team: Team | null, systemId: string | null) => Promise<void>;
}) {
  const [current, setCurrent] = useState({ team, systemId });
  const [pending, startTransition] = useTransition();

  function choose(next: Team | null, nextSystem: string | null) {
    setCurrent({ team: next, systemId: next === "cad" ? nextSystem : null });
    startTransition(() => save(next, nextSystem));
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Your team">
        {TEAMS.map((t) => {
          const on = current.team === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={pending}
              onClick={() => choose(on ? null : t.id, current.systemId)}
              data-selected={on}
              className="card-interactive p-4 text-left disabled:opacity-60"
            >
              <span className={`block text-lg font-semibold ${on ? "text-accent" : "text-fg"}`}>{t.label}</span>
              <span className="block text-sm text-muted">{t.text}</span>
            </button>
          );
        })}
      </div>
      {current.team === "cad" && (
        <label className="flex flex-wrap items-center gap-3 text-sm text-fg-2">
          Subsystem
          <SystemSelect value={current.systemId} systems={systems} disabled={pending} onChange={(id) => choose("cad", id)} className="w-64" />
        </label>
      )}
    </div>
  );
}
