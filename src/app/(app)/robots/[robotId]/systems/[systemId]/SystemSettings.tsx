"use client";

import { useActionState, useState } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Popover } from "@/components/bom/Popover";
import { Checkbox } from "@/components/ui/Checkbox";
import { Icon } from "@/components/ui/Icon";
import { deleteSystem, updateSystem, type FormState } from "../../../actions";
import { GEAR_SMALL, OnshapeLinkField, SaveRow } from "../../RobotSettings";

// Edit mode's gear menu on a system tile: name, Onshape assembly, follow its versions, delete.
export function SystemSettings({
  robotId,
  system,
  isAdmin,
  small = false,
}: {
  robotId: string;
  system: { id: string; name: string; assemblyUrl: string | null; followVersions?: boolean };
  isAdmin: boolean;
  small?: boolean;
}) {
  const [state, update, pending] = useActionState(
    (prev: FormState, formData: FormData) => updateSystem(system.id, prev, formData),
    undefined,
  );
  const [follow, setFollow] = useState(!!system.followVersions);
  return (
    <Popover
      align="right"
      hideCaret
      triggerClassName={small ? GEAR_SMALL : "btn h-9 w-9 justify-center px-0"}
      trigger={
        <>
          <Icon name="gear" className={small ? "h-3.5 w-3.5" : undefined} />
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
            <input type="hidden" name="followVersions" value={follow ? "1" : ""} />
            <Checkbox checked={follow} onChange={setFollow}>
              <span>
                Follow Onshape versions
                <span className="block text-xs text-muted">Changes show up when the CAD document gets a new version, not on every edit.</span>
              </span>
            </Checkbox>
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
