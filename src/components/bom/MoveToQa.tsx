"use client";

// "+" no longer jumps to QA (Harel, 2026-11-20): when a member's "+" finishes a step that would
// move the part to Ready for QA, the card asks "Move to QA?" first. Yes moves it; No keeps the
// count but leaves the part at its process (parts.qa_held), and the card offers the move again.
// The count saves at once, held, before the question (audit 2026-11-25, BOM-7): a piece counted by
// someone who walks away, or a card that re-mounts, is never lost; Yes then moves it to QA.

import { useState } from "react";
import { planPartUpdate, type PartChanges } from "@/lib/parts/changes";
import { computeStatus } from "@/lib/status";
import type { SaveFn } from "./fields";
import type { CardPart } from "./types";

const QA = "Ready for QA";

// Whether this count would take the part to Ready for QA (it isn't there now).
export function wouldGoToQa(part: CardPart, changes: PartChanges): boolean {
  if (part.classification === "cots" || computeStatus(part) === QA) return false;
  const { set } = planPartUpdate(part, { ...changes, qaHeld: false }, "ui");
  return computeStatus({ ...part, ...set } as CardPart) === QA;
}

// Kept at its process after a "No": the card's Move to QA puts it in Ready for QA.
export const heldForQa = (part: CardPart) => part.classification !== "cots" && part.qaHeld && computeStatus(part) !== QA && computeStatus({ ...part, qaHeld: false }) === QA;

// `count` saves a "+" (or any count), asking first when it would move the part to QA; `prompt`
// is the small question to put on the card while it asks.
// `place`: on a card's picture, or over the end of a list row.
export function useMoveToQa(part: CardPart, save: SaveFn, place: "card" | "row" = "card") {
  const [asking, setAsking] = useState(false);
  const count = (changes: PartChanges) => {
    if (wouldGoToQa(part, changes)) {
      save({ ...changes, qaHeld: true });
      setAsking(true);
    } else save(changes);
  };
  const answer = (move: boolean) => {
    if (move) save({ qaHeld: false });
    setAsking(false);
  };
  const at = place === "row" ? ROW : CARD;
  const prompt = asking ? <MoveToQaPrompt at={at} onAnswer={answer} /> : heldForQa(part) ? <MoveToQaOffer at={at} onMove={() => save({ qaHeld: false })} /> : null;
  return { count, prompt };
}

// Why a part's "+" is gone: its next process waits for CAD's QA (audit 2026-11-25, BOM-1).
export function QaGateChip({ n }: { n: number }) {
  return (
    <span className="rounded-full border border-amber-500/50 bg-amber-400/15 px-2 py-0.5 text-[0.6875rem] font-semibold whitespace-nowrap text-amber-700 dark:text-amber-300" title={`Process ${n} starts once CAD approves the QA`}>
      QA before P{n}
    </span>
  );
}

const CARD = "inset-x-2 bottom-12";
const ROW = "right-2 top-1/2 -translate-y-1/2";
const box = "absolute z-30 flex items-center justify-between gap-2 rounded-lg border border-line-strong bg-surface/95 px-2.5 py-1.5 text-xs font-semibold text-fg shadow-lg backdrop-blur-md";
const btn = "press rounded-md px-2.5 py-1 text-xs font-semibold active:scale-[0.98] pointer-coarse:min-h-9";

function MoveToQaPrompt({ at, onAnswer }: { at: string; onAnswer: (move: boolean) => void }) {
  return (
    <div role="dialog" aria-label="Move to QA?" className={`${box} ${at}`} onClick={(e) => e.stopPropagation()}>
      <span>Move to QA?</span>
      <span className="flex gap-1.5">
        <button type="button" autoFocus onClick={() => onAnswer(true)} className={`${btn} bg-accent text-white hover:opacity-90`}>
          Yes
        </button>
        <button type="button" onClick={() => onAnswer(false)} className={`${btn} border border-line-strong bg-raised text-fg-2 hover:text-fg`}>
          No
        </button>
      </span>
    </div>
  );
}

function MoveToQaOffer({ at, onMove }: { at: string; onMove: () => void }) {
  return (
    <div className={`${box} ${at} justify-center`} onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={onMove} className={`${btn} bg-amber-400 text-[#111318] hover:bg-amber-300`} title="Every piece is done here: move the part to Ready for QA">
        Move to QA
      </button>
    </div>
  );
}
