"use client";

import { useState, useTransition } from "react";
import { SystemSelect, type TeamSystemOption } from "@/components/teams/SystemSelect";
import { TEAMS, isTeam, type Team } from "@/config/teams";
import { setMemberTeam } from "./actions";

// Admins set any member's team and, for CAD Team, their subsystem.
export function MemberTeam({
  memberId,
  team,
  systemId,
  systems,
}: {
  memberId: string;
  team: Team | null;
  systemId: string | null;
  systems: TeamSystemOption[];
}) {
  const [current, setCurrent] = useState({ team, systemId });
  const [pending, startTransition] = useTransition();

  function save(next: Team | null, nextSystem: string | null) {
    setCurrent({ team: next, systemId: next === "cad" ? nextSystem : null });
    startTransition(() => setMemberTeam(memberId, next, nextSystem));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={current.team ?? ""}
        disabled={pending}
        onChange={(e) => save(isTeam(e.target.value) ? e.target.value : null, current.systemId)}
        aria-label="Team"
        className="input w-36"
      >
        <option value="">No team</option>
        {TEAMS.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      {current.team === "cad" && (
        <SystemSelect value={current.systemId} systems={systems} disabled={pending} onChange={(id) => save("cad", id)} className="w-40" />
      )}
    </div>
  );
}
