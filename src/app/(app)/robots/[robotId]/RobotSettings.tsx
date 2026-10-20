"use client";

import { useActionState } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Popover } from "@/components/bom/Popover";
import { Icon } from "@/components/ui/Icon";
import { deleteRobot, setRobotArchived, updateRobot, type FormState } from "../actions";

// Edit mode's gear menu on the robot dashboard: name, code, main assembly (the 3D model's
// source), archive and delete.
export function RobotSettings({
  robot,
  isAdmin,
}: {
  robot: { id: string; name: string; code: string | null; mainAssemblyUrl: string | null; archived: boolean };
  isAdmin: boolean;
}) {
  const [state, update, pending] = useActionState((_: FormState, formData: FormData) => updateRobot(robot.id, formData), undefined);
  return (
    <Popover
      align="right"
      hideCaret
      triggerClassName="btn h-9 w-9 justify-center px-0"
      trigger={
        <>
          <Icon name="gear" />
          <span className="sr-only">Robot settings</span>
        </>
      }
    >
      {() => (
        <div className="space-y-3 p-1">
          <form action={update} className="space-y-2">
            <label className="label" htmlFor="robot-name">
              Name
            </label>
            <input id="robot-name" name="name" defaultValue={robot.name} required className="input" />
            <label className="label" htmlFor="robot-code">
              Robot code
            </label>
            <input id="robot-code" name="code" defaultValue={robot.code ?? ""} placeholder="e.g. A" className="input" />
            <label className="label" htmlFor="robot-assembly">
              Main assembly (for the 3D view)
            </label>
            <input
              id="robot-assembly"
              name="mainAssemblyUrl"
              defaultValue={robot.mainAssemblyUrl ?? ""}
              placeholder="https://…onshape.com/documents/…"
              className="input"
            />
            {state?.error && <p className="text-xs text-rose-600">{state.error}</p>}
            <button className="btn-primary w-full justify-center" disabled={pending}>
              Save
            </button>
          </form>
          <form action={setRobotArchived.bind(null, robot.id, !robot.archived)}>
            <button className="btn w-full justify-center">{robot.archived ? "Unarchive robot" : "Archive robot"}</button>
          </form>
          {isAdmin && (
            <ConfirmButton
              action={deleteRobot.bind(null, robot.id)}
              message={`Delete the robot "${robot.name}", all its systems and parts? This can't be undone.`}
              className="btn-danger w-full justify-center"
            >
              Delete robot
            </ConfirmButton>
          )}
        </div>
      )}
    </Popover>
  );
}
