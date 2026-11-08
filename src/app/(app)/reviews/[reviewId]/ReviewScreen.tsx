"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { PickedPart } from "@/components/dashboard/PickedPart";
import type { ViewerModel } from "@/components/dashboard/ModelCanvas";
import { LocalTime } from "@/components/ui/LocalTime";
import type { ReviewRound, ReviewSummary } from "@/lib/data/reviews";
import { onshapeUrl } from "@/lib/onshape/url";
import { sendReviewRound, setReviewClosed } from "../actions";

const ModelCanvas = dynamic(() => import("@/components/dashboard/ModelCanvas").then((m) => m.ModelCanvas), { ssr: false });
const NO_COLORS = new Map<string, string>();

type RoundModel = ViewerModel & { names: Record<string, string> };
type Load = { state: "loading" } | { state: "building"; done: number; total: number } | { state: "error"; message: string } | { state: "ready"; model: RoundModel };

// The review screen: the picked round's 3D view (the frozen Onshape state the student sent) and
// its panel: rounds, the student's note, Open in Onshape at that round, Send for review. On a
// phone the view comes first and the panel follows; from lg it's a column on the right.
export function ReviewScreen({ review, canSend, isOwnerOrAdmin }: { review: ReviewSummary; canSend: boolean; isOwnerOrAdmin: boolean }) {
  const router = useRouter();
  const latest = review.rounds.at(-1) ?? null;
  // The round picked with R1…Rn, until a newer round arrives: then the newest is shown.
  const [chosen, setChosen] = useState<{ latest: string | null; id: string } | null>(null);
  const round = (chosen?.latest === (latest?.id ?? null) && review.rounds.find((r) => r.id === chosen.id)) || latest;
  const [retry, setRetry] = useState(0);
  const open = review.status === "open";

  return (
    <div className="grid gap-3 lg:h-[calc(100dvh-var(--topbar-h,2.75rem)-7.5rem)] lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="panel relative h-[62dvh] min-h-[20rem] overflow-hidden lg:h-full">
        {round ? (
          <RoundStage key={`${round.id}:${retry}`} round={round} canBuild={canSend} onBuilt={() => router.refresh()} onRetry={() => setRetry((n) => n + 1)} />
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted">No rounds yet.</div>
        )}
      </div>

      <aside className="panel space-y-4 overflow-y-auto p-3">
        <div>
          <div className="label">Rounds</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {review.rounds.map((r) => (
              <button
                key={r.id}
                onClick={() => setChosen({ latest: latest?.id ?? null, id: r.id })}
                className={`press min-h-9 min-w-11 rounded-md border px-2.5 text-sm font-semibold tabular-nums pointer-coarse:min-h-11 ${r.id === round?.id ? "border-accent bg-accent text-white" : "border-line-strong bg-surface text-fg-2 hover:border-accent/50"}`}
                aria-pressed={r.id === round?.id}
              >
                R{r.seq}
              </button>
            ))}
          </div>
        </div>

        {round && (
          <div className="space-y-2 text-sm">
            <div className="text-xs text-muted">
              Round {round.seq} · {round.sentBy ?? "Someone"}, <LocalTime at={round.sentAt} />
              {round.state === "ready" && round.calls > 0 && <span className="tabular-nums"> · {round.calls} Onshape calls</span>}
            </div>
            {round.note ? <p className="whitespace-pre-wrap text-fg">{round.note}</p> : <p className="text-muted">No note with this round.</p>}
            <a href={onshapeUrl(round.ref)} target="_blank" rel="noreferrer" className="btn w-full justify-center active:scale-[0.98]">
              Open in Onshape at round {round.seq}
            </a>
          </div>
        )}

        {canSend && open && <SendRound reviewId={review.id} next={(latest?.seq ?? 0) + 1} onSent={() => router.refresh()} />}

        {isOwnerOrAdmin && review.status !== "approved" && <CloseButton reviewId={review.id} closed={!open} />}
      </aside>
    </div>
  );
}

// One round's 3D view. A ready round is read from R2; a building one is built step by step by a
// member who can (the steps call Onshape on their account) and only watched by everyone else.
function RoundStage({ round, canBuild, onBuilt, onRetry }: { round: ReviewRound; canBuild: boolean; onBuilt: () => void; onRetry: () => void }) {
  const [load, setLoad] = useState<Load>(round.state === "building" && !canBuild ? { state: "building", done: 0, total: 0 } : { state: "loading" });
  const [picked, setPicked] = useState<string | null>(null);
  const built = useRef(onBuilt);
  useEffect(() => {
    built.current = onBuilt;
  }, [onBuilt]);

  useEffect(() => {
    if (round.state === "building" && !canBuild) return;
    let cancelled = false;
    const fetchModel = async () => {
      const res = await fetch(`/api/reviews/rounds/${round.id}`);
      const body = (await res.json()) as { model: RoundModel | null };
      if (cancelled) return;
      setLoad(body.model ? { state: "ready", model: body.model } : { state: "error", message: "This round's 3D view isn't ready." });
    };
    const build = async () => {
      for (;;) {
        const res = await fetch(`/api/reviews/rounds/${round.id}`, { method: "POST" });
        const body = (await res.json()) as { state?: "ready" | "working"; done?: number; total?: number; error?: string };
        if (cancelled) return;
        if (!res.ok || body.error) return setLoad({ state: "error", message: body.error ?? `The 3D export failed (${res.status}).` });
        if (body.state === "ready") {
          built.current();
          return fetchModel();
        }
        setLoad({ state: "building", done: body.done ?? 0, total: body.total ?? 0 });
      }
    };
    (round.state === "ready" ? fetchModel() : build()).catch((err) => {
      if (!cancelled) setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) });
    });
    return () => {
      cancelled = true;
    };
  }, [round.id, round.state, canBuild]);

  const names = useMemo(() => (load.state === "ready" ? load.model.names : {}), [load]);
  const nameMap = useMemo(() => new Map(Object.entries(names)), [names]);

  if (load.state === "ready") {
    return (
      <>
        <ModelCanvas model={load.model} colors={NO_COLORS} mode="cad" locateKey={null} onLocated={() => {}} selectedKey={picked} onPick={setPicked} names={nameMap} />
        {picked && <PickedPart bottom name={names[picked] ?? "Unnamed part"} onClear={() => setPicked(null)} />}
      </>
    );
  }
  return (
    <div className="grid h-full place-items-center p-6 text-center text-sm text-muted">
      {load.state === "loading" && <span>Loading the 3D view…</span>}
      {load.state === "building" && (
        <span className="tabular-nums">
          {canBuild
            ? load.total
              ? `Exporting from Onshape… ${load.done} of ${load.total} Part Studios`
              : "Reading the assembly from Onshape…"
            : "The student's round is still being exported. Check back in a minute."}
        </span>
      )}
      {load.state === "error" && (
        <div className="max-w-sm space-y-3">
          <p className="text-rose-500">{load.message}</p>
          {canBuild && round.state === "building" && (
            <button className="btn active:scale-[0.98]" onClick={onRetry}>
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SendRound({ reviewId, next, onSent }: { reviewId: string; next: number; onSent: () => void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = () =>
    start(async () => {
      setError(null);
      const res = await sendReviewRound(reviewId, note);
      if (res.error) return setError(res.error);
      setNote("");
      onSent();
    });
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <label className="label" htmlFor="round-note">
        What changed (round {next})
      </label>
      <textarea id="round-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="input min-h-20 w-full" placeholder="Fixed the clearance at the intake pivot…" />
      {error && <p className="text-xs text-rose-500">{error}</p>}
      <button className="btn-primary w-full justify-center active:scale-[0.98]" disabled={pending} onClick={send}>
        {pending ? "Sending…" : "Send for review"}
      </button>
      <p className="text-xs text-muted">Sends the assembly as it is in Onshape now. Only Part Studios that changed are exported again.</p>
    </div>
  );
}

function CloseButton({ reviewId, closed }: { reviewId: string; closed: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="border-t border-line pt-3">
      <button
        className="btn w-full justify-center active:scale-[0.98]"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await setReviewClosed(reviewId, !closed);
            setError(res.error ?? null);
          })
        }
      >
        {closed ? "Reopen review" : "Close review"}
      </button>
      {error && <p className="mt-1 text-xs text-rose-500">{error}</p>}
    </div>
  );
}
