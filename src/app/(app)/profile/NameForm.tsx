"use client";

import { useState, useTransition } from "react";
import { renameSelf } from "./actions";

// The profile heading: the member's name, with Rename to change how the team sees it.
export function NameForm({ name }: { name: string }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold">{name}</h1>
        <button type="button" onClick={() => setEditing(true)} className="press text-sm text-subtle hover:text-accent">
          Rename
        </button>
      </div>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      action={(data) =>
        startTransition(async () => {
          const result = await renameSelf(String(data.get("name") ?? ""));
          if (result.error) setError(result.error);
          else {
            setError(null);
            setEditing(false);
          }
        })
      }
    >
      <input name="name" defaultValue={name} autoFocus maxLength={60} aria-label="Your name" className="input w-64 text-lg font-semibold" />
      <button type="submit" disabled={pending} className="btn-primary">
        Save
      </button>
      <button type="button" onClick={() => setEditing(false)} className="btn">
        Cancel
      </button>
      {error && <p className="w-full text-sm text-rose-700">{error}</p>}
    </form>
  );
}
