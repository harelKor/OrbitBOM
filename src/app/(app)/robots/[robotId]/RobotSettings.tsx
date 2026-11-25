"use client";

import { useActionState } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Popover } from "@/components/bom/Popover";
import { Icon } from "@/components/ui/Icon";
import { ROBOT_FOLDERS, type RobotFolder } from "@/config/robotFolders";
import { deleteRobot, setRobotFolder, updateRobot, type FormState } from "../actions";
import { safeAction } from "@/lib/safeAction";

// The small gear in the corner of a robot card or system tile in the side panel.
export const GEAR_SMALL = "flex h-6 w-6 items-center justify-center rounded-md bg-surface/90 text-muted shadow-sm hover:text-fg";

// Edit mode's gear menu on a robot card: name, year, code, main assembly (the 3D model's
// source when no system is linked), folder and delete.
export function RobotSettings({
  robot,
  isAdmin,
  small = false,
}: {
  robot: { id: string; name: string; year: number; code: string | null; mainAssemblyUrl: string | null; folder: RobotFolder | null };
  isAdmin: boolean;
  small?: boolean;
}) {
  const [state, update, pending] = useActionState((_: FormState, formData: FormData): Promise<FormState> => safeAction(async () => (await updateRobot(robot.id, formData)) ?? {}), undefined);
  return (
    <Popover
      align="right"
      hideCaret
      triggerClassName={small ? GEAR_SMALL : "btn h-9 w-9 justify-center px-0"}
      trigger={
        <>
          <Icon name="gear" className={small ? "h-3.5 w-3.5" : undefined} />
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
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="robot-year">
                  Year
                </label>
                <input id="robot-year" name="year" type="number" defaultValue={robot.year} required className="input tabular-nums" />
              </div>
              <div>
                <label className="label" htmlFor="robot-code">
                  Robot code
                </label>
                <input id="robot-code" name="code" defaultValue={robot.code ?? ""} placeholder="e.g. A" className="input" />
              </div>
            </div>
            <OnshapeLinkField id="robot-assembly" name="mainAssemblyUrl" label="Main assembly (3D view if no system is linked)" value={robot.mainAssemblyUrl} />
            <SaveRow pending={pending} state={state} />
          </form>
          <div>
            <div className="label">Move to folder</div>
            <div className="grid grid-cols-2 gap-1">
              {[...ROBOT_FOLDERS, { key: null, label: "No folder" }].map((f) => (
                <form key={f.key ?? "none"} action={setRobotFolder.bind(null, robot.id, f.key)}>
                  <button className="btn h-9 w-full justify-center text-xs" disabled={robot.folder === f.key} aria-pressed={robot.folder === f.key}>
                    {f.label}
                  </button>
                </form>
              ))}
            </div>
          </div>
          {isAdmin && (
            <ConfirmButton
              action={deleteRobot.bind(null, robot.id)}
              message={`Delete the robot "${robot.name}", all its systems and parts?`}
              body="It stays in Settings → Recently deleted for 30 days."
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

// An Onshape link input with a way to open the saved link and check it is the right one.
export function OnshapeLinkField({ id, name, label, value }: { id: string; name: string; label: string; value: string | null }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label className="label" htmlFor={id}>
          {label}
        </label>
        {value && (
          <a href={value} target="_blank" rel="noreferrer" className="text-xs text-accent-hover hover:underline">
            Open ↗
          </a>
        )}
      </div>
      <input id={id} name={name} defaultValue={value ?? ""} placeholder="https://…onshape.com/documents/…/e/…" className="input" />
    </div>
  );
}

export function SaveRow({ pending, state }: { pending: boolean; state: FormState }) {
  return (
    <>
      {state?.error && <p className="text-xs text-rose-500">{state.error}</p>}
      {state?.saved && !pending && <p className="text-xs text-subtle">Saved.</p>}
      <button className="btn-primary w-full justify-center" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
    </>
  );
}
