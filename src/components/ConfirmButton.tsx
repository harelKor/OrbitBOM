"use client";

import { useRef } from "react";
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
  const form = useRef<HTMLFormElement>(null);
  // The Orbit window answers later than the submit event, so the first submit always stops and a
  // yes submits the form again; this flag lets that second one through to the server action.
  const confirmed = useRef(false);
  return (
    <form
      ref={form}
      action={action}
      onSubmit={(e) => {
        if (confirmed.current) {
          confirmed.current = false;
          return;
        }
        e.preventDefault();
        void askConfirm({ title: message, body, confirm, danger: true }).then((yes) => {
          if (!yes) return;
          confirmed.current = true;
          form.current?.requestSubmit();
        });
      }}
    >
      <button className={className}>{children}</button>
    </form>
  );
}
