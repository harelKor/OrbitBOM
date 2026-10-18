"use client";

// A submit button that asks before running a destructive server action.
export function ConfirmButton({
  action,
  message,
  className = "btn-danger",
  children,
}: {
  action: () => Promise<void>;
  message: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      <button className={className}>{children}</button>
    </form>
  );
}
