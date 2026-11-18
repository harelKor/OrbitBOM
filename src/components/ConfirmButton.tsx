"use client";

import { startTransition } from "react";
import { askConfirm } from "@/components/ui/useConfirm";

// A submit button that asks before running a destructive server action.
export function ConfirmButton({
  action,
  message,
  body,
  confirm = "Delete",
  className = "btn-danger",
  children,
}: {
  action: () => Promise<void>;
  message: string;
  body?: string;
  confirm?: string;
  className?: string;
  children: React.ReactNode;
}) {
  // A yes runs the action itself rather than submitting the form again: tapping the Orbit
  // window's Delete counts as a tap outside the gear popover this button sits in, which closes
  // the popover and unmounts the form, so a second submit never reached the server (Delete
  // system and Delete robot did nothing, 2026-11-18).
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void askConfirm({ title: message, body, confirm, danger: true }).then((yes) => {
          if (yes) startTransition(() => action());
        });
      }}
    >
      <button className={className}>{children}</button>
    </form>
  );
}
