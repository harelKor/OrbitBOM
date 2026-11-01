"use client";

import { useState, useSyncExternalStore } from "react";
import { approveParts, rejectParts, suggestPart } from "@/app/(app)/robots/[robotId]/review/actions";
import { useCan } from "@/components/shell/ModeContext";
import { CheckIcon } from "@/components/ui/CheckBadge";
import { Icon } from "@/components/ui/Icon";
import { toast } from "@/components/ui/Toaster";
import { partTitle, type CardPart } from "./types";

// Parts suggested from their card on this page, waiting for the card's ✓ / ✕. Kept outside the
// card so the icons survive the card re-mounting when the BOM re-sorts after the suggestion.
const suggested = new Set<string>();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const mark = (id: string, on: boolean) => {
  if (on) suggested.add(id);
  else suggested.delete(id);
  listeners.forEach((l) => l());
};

// The card thumbnail's bottom-right Suggest: only on Undefined parts. After a suggestion it turns
// into ✓ (Approve) and ✕ (Reject, the part goes back to Undefined) in the same spot. The part
// window keeps its own Suggest with the full "old → new" rows.
export function CardSuggest({ part }: { part: CardPart }) {
  const review = useCan("review");
  const waiting = useSyncExternalStore(subscribe, () => suggested.has(part.id), () => false);
  const [busy, setBusy] = useState<"suggest" | "approve" | "reject" | null>(null);
  if (!review || part.isManual || part.memberIds) return null;
  if (!waiting && part.classification !== "undefined") return null;

  const run = async (kind: "suggest" | "approve" | "reject") => {
    setBusy(kind);
    try {
      const r = kind === "suggest" ? await suggestPart(part.id) : kind === "approve" ? await approveParts([part.id]) : await rejectParts([part.id]);
      if (r.error) return toast(r.error, true);
      if (kind === "suggest") {
        // "Nothing to suggest" comes back as a message; anything else waits in To Review.
        if (r.message) toast(r.message);
        else mark(part.id, true);
      } else {
        mark(part.id, false);
        if (r.message) toast(r.message);
      }
    } finally {
      setBusy(null);
    }
  };

  const btn = "overlay-btn active:scale-[0.98] disabled:opacity-50";
  if (!waiting) {
    return (
      <button
        type="button"
        onClick={() => run("suggest")}
        disabled={!!busy}
        className={`${btn} ${busy ? "animate-pulse" : ""}`}
        aria-label={`Suggest setup for ${partTitle(part)}`}
        title="Suggest: guess the type, material, machines and inventory item"
      >
        <Icon name="spark" className="text-amber-500" />
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => run("approve")}
        disabled={!!busy}
        className={`${btn} border-emerald-400/70 text-emerald-500 hover:bg-emerald-500 hover:text-white ${busy === "approve" ? "animate-pulse" : ""}`}
        aria-label={`Approve the suggestion for ${partTitle(part)}`}
        title="Approve: keep the suggested values"
      >
        <CheckIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => run("reject")}
        disabled={!!busy}
        className={`${btn} border-rose-400/70 text-rose-500 hover:bg-rose-600 hover:text-white ${busy === "reject" ? "animate-pulse" : ""}`}
        aria-label={`Reject the suggestion for ${partTitle(part)}`}
        title="Reject: put the old values back (Undefined)"
      >
        <Icon name="close" />
      </button>
    </span>
  );
}
