"use client";

import { useActionState } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Popover } from "@/components/bom/Popover";
import { Icon } from "@/components/ui/Icon";
import { deleteSystem, updateSystem, type FormState } from "../../../actions";
import { OnshapeLinkField, SaveRow } from "../../RobotSettings";

// Edit mode's gear menu on a system page: name, Onshape assembly, delete.
export function SystemSettings({
  robotId,
  system,
  isAdmin,
}: {
  robotId: string;
  system: { id: string; name: string; assemblyUrl: string | null };
  isAdmin: boolean;
}) {
  const [state, update, pending] = useActionState(
    (prev: FormState, formData: FormData) => updateSystem(system.id, prev, formData),
    undefined,
  );
  return (
    <Popover
      align="right"
      hideCaret
      triggerClassName="btn h-9 w-9 justify-center px-0"
      trigger={
        <>
          <Icon name="gear" />
          <span className="sr-only">System settings</span>
        </>
      }
    >
      {() => (
        <div className="space-y-3 p-1">
          <form action={update} className="space-y-2">
            <label className="label" htmlFor="system-name">
              Name
            </label>
            <input id="system-name" name="name" defaultValue={system.name} required className="input" />
            <OnshapeLinkField id="system-assembly" name="assemblyUrl" label="Onshape assembly" value={system.assemblyUrl} />
            <SaveRow pending={pending} state={state} />
          </form>
          {isAdmin && (
            <ConfirmButton
              action={deleteSystem.bind(null, robotId, system.id)}
              message={`Delete the system "${system.name}" and all its parts? This can't be undone.`}
              className="btn-danger w-full justify-center"
            >
              Delete system
            </ConfirmButton>
          )}
        </div>
      )}
    </Popover>
  );
}
