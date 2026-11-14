"use client";

import { useEffect, useState } from "react";
import type { Place } from "@/lib/inventory/places";
import { FindButton } from "./FindButton";

type Answer = { places: Place[]; drawers: Record<string, string> };

// One read per system while the page is open (a minute at most), shared by every part window.
const answers = new Map<string, { at: number; answer: Promise<Answer | null> }>();
function load(systemId: string) {
  const hit = answers.get(systemId);
  if (hit && Date.now() - hit.at < 60_000) return hit.answer;
  const answer = fetch(`/api/places?system=${encodeURIComponent(systemId)}`)
    .then((r) => (r.ok ? (r.json() as Promise<Answer>) : null))
    .catch(() => null);
  answers.set(systemId, { at: Date.now(), answer });
  return answer;
}

// A made part waits in its system's drawer for its status (Ready for QA, In Stock…), chosen in
// Settings → Map (Harel, 2026-11-14): the map icon flies there. Nothing shows without one.
export function SystemDrawerButton({ systemId, status, className }: { systemId: string | null | undefined; status: string; className?: string }) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  useEffect(() => {
    if (!systemId) return;
    let live = true;
    void load(systemId).then((a) => live && setAnswer(a));
    return () => {
      live = false;
    };
  }, [systemId]);
  const placeId = answer?.drawers[status];
  if (!answer || !placeId || !answer.places.some((p) => p.id === placeId)) return null;
  return <FindButton places={answer.places} placeId={placeId} title={`Where ${status} parts wait`} className={className} />;
}
