"use client";

import { useTransition } from "react";
import { askConfirm } from "@/components/ui/useConfirm";

// Members → Remove deletes the member for good: their name leaves every history row, comment and
// stock move. One mis-tap on a phone mustn't do that, so it asks first (audit 2026-11-14).
export function RemoveMember({ name, action }: { name: string; action: () => Promise<void> }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn-danger"
      disabled={pending}
      onClick={async () => {
        const yes = await askConfirm({
          title: `Remove ${name}?`,
          body: "Their name disappears from part history, comments and stock moves. This can't be undone.",
          confirm: "Remove",
          danger: true,
        });
        if (yes) start(() => action());
      }}
    >
      Remove
    </button>
  );
}
