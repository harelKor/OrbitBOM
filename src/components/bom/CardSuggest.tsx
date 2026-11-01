"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { approveParts, rejectParts, suggestPart } from "@/app/(app)/robots/[robotId]/review/actions";
import { useCan } from "@/components/shell/ModeContext";
import { CheckIcon } from "@/components/ui/CheckBadge";
import { Icon } from "@/components/ui/Icon";
import { SuggestIcon } from "@/components/ui/SuggestIcon";
import { toast } from "@/components/ui/Toaster";
import { partTitle, type CardPart } from "./types";

// What this browser just did to a part's suggestion (true: suggested, false: approved or
// rejected), shown until the page's next data says the same. Kept outside the card so it survives
// the card re-mounting when the BOM re-sorts.
const overrides = new Map<string, boolean>();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const setOverride = (id: string, on: boolean | null) => {
  if (on === null) overrides.delete(id);
  else overrides.set(id, on);
  listeners.forEach((l) => l());
};

// Suggest and its ✓ / ✕, at a card thumbnail's bottom-right and a List row's right end. A part
// with a suggestion waiting in To Review (from here, the Suggest bar, Suggest setup, auto-link or a
// member's Claude) shows ✓ (Approve) and ✕ (Reject: the old values come back); an Undefined part
// with none shows Suggest, which runs the rules on it and turns into ✓ / ✕. The part window keeps
// its own Suggest with the full "old → new" rows.
export function CardSuggest({ part, variant = "card" }: { part: CardPart; variant?: "card" | "row" }) {
  const review = useCan("review");
  const override = useSyncExternalStore(subscribe, () => overrides.get(part.id), () => undefined);
  const [busy, setBusy] = useState<"suggest" | "approve" | "reject" | null>(null);
  const fromServer = !!part.review;
  // The page's data caught up: drop what this browser remembered.
  useEffect(() => {
    if (overrides.get(part.id) === fromServer) setOverride(part.id, null);
  }, [part.id, fromServer]);
  if (!review || part.isManual || part.memberIds) return null;
  const waiting = override ?? fromServer;
  if (!waiting && part.classification !== "undefined") return null;

  const run = async (e: React.MouseEvent, kind: "suggest" | "approve" | "reject") => {
    e.stopPropagation();
    setBusy(kind);
    try {
      const r = kind === "suggest" ? await suggestPart(part.id) : kind === "approve" ? await approveParts([part.id]) : await rejectParts([part.id]);
      if (r.error) return toast(r.error, true);
      // Suggest's "nothing to suggest" comes back as a message; anything else waits in To Review.
      if (kind !== "suggest" || !r.message) setOverride(part.id, kind === "suggest");
      if (r.message) toast(r.message);
    } finally {
      setBusy(null);
    }
  };

  const btn =
    variant === "card"
      ? "overlay-btn active:scale-[0.98] disabled:opacity-50"
      : "press flex h-8 w-8 items-center justify-center rounded-full border border-line-strong bg-raised text-fg-2 hover:border-sky-400/40 active:scale-[0.98] disabled:opacity-50";
  if (!waiting) {
    return (
      <button
        type="button"
        onClick={(e) => run(e, "suggest")}
        disabled={!!busy}
        className={`${btn} text-amber-500 ${busy ? "animate-pulse" : ""}`}
        aria-label={`Suggest setup for ${partTitle(part)}`}
        title="Suggest: guess the type, material, machines and inventory item"
      >
        <SuggestIcon />
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        onClick={(e) => run(e, "approve")}
        disabled={!!busy}
        className={`${btn} border-emerald-400/70 text-emerald-500 hover:border-emerald-500 hover:bg-emerald-500 hover:text-white ${busy === "approve" ? "animate-pulse" : ""}`}
        aria-label={`Approve the suggestion for ${partTitle(part)}`}
        title="Approve: keep the suggested values"
      >
        <CheckIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={(e) => run(e, "reject")}
        disabled={!!busy}
        className={`${btn} border-rose-400/70 text-rose-500 hover:border-rose-600 hover:bg-rose-600 hover:text-white ${busy === "reject" ? "animate-pulse" : ""}`}
        aria-label={`Reject the suggestion for ${partTitle(part)}`}
        title="Reject: put the old values back"
      >
        <Icon name="close" />
      </button>
    </span>
  );
}
