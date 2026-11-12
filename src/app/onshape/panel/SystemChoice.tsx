"use client";

import { useState } from "react";

export type ChoiceRobot = { id: string; name: string };
export type ChoiceSystem = { id: string; name: string; robotId: string };

// Robot, then a new system (its name) or one of `systems` of that robot, for the panel's sync
// forms (Harel, 2026-11-12): a system started from its Basepart gets its Final later, and the
// other way round. Sends robotId, systemId ("new" or an id) and name.
export function SystemChoice({ robots, systems, idPrefix }: { robots: ChoiceRobot[]; systems: ChoiceSystem[]; idPrefix: string }) {
  const [robotId, setRobotId] = useState(robots[0]?.id ?? "");
  const own = systems.filter((s) => s.robotId === robotId);
  const [systemId, setSystemId] = useState("new");
  const picked = own.some((s) => s.id === systemId) ? systemId : "new";
  return (
    <>
      <div>
        <label className="label" htmlFor={`${idPrefix}-robot`}>
          Robot
        </label>
        <select id={`${idPrefix}-robot`} name="robotId" className="input" required value={robotId} onChange={(e) => setRobotId(e.target.value)}>
          {robots.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      {own.length > 0 && (
        <div>
          <label className="label" htmlFor={`${idPrefix}-system`}>
            System
          </label>
          <select id={`${idPrefix}-system`} name="systemId" className="input" value={picked} onChange={(e) => setSystemId(e.target.value)}>
            <option value="new">New system…</option>
            {own.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {own.length === 0 && <input type="hidden" name="systemId" value="new" />}
      {picked === "new" && (
        <div>
          <label className="label" htmlFor={`${idPrefix}-name`}>
            System name
          </label>
          <input id={`${idPrefix}-name`} name="name" className="input" required placeholder="e.g. Intake" />
        </div>
      )}
    </>
  );
}
