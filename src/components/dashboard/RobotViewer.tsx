"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { StatusCount } from "@/lib/stats";
import { Segmented } from "@/components/ui/Segmented";
import { Icon } from "@/components/ui/Icon";
import type { ViewerModel } from "./ModelCanvas";

const ModelCanvas = dynamic(() => import("./ModelCanvas").then((m) => m.ModelCanvas), { ssr: false });

type BuildAnswer =
  | { state: "done"; unchanged: boolean; parts: number; calls: number }
  | { state: "working"; done: number; total: number; calls: number }
  | { error: string };

// A BOM part as the viewer knows it: its key in the model, status colour, and where its card is.
export type ViewerPart = { key: string; color: string; id: string; systemId: string; name: string; fab: boolean };

// The 3D robot stage. The model is built from the systems' Onshape assemblies on demand
// (Edit mode's Update 3D model) and kept in R2; viewing it costs no Onshape calls. The expand
// button opens it large over the page, leaving the side panels and a margin of background. The
// Subsystems button shows and hides subsystems (open by default when large). On a system page
// (systemId) it shows only that subsystem. A click on a part highlights it; a second click goes
// to its card, or offers To Fab or the system page when the part is in To Fab. (Locate opens a
// part's own window from its card: PartStage.)
export function RobotViewer({
  robotId,
  systemId,
  statuses,
  parts,
  builtAt,
  hasAssembly,
  edit,
}: {
  robotId: string;
  systemId?: string;
  statuses: StatusCount[];
  parts: ViewerPart[]; // BOM parts by Onshape identity
  builtAt: string | null;
  hasAssembly: boolean;
  edit: boolean;
}) {
  const [colors, setColors] = useState<"status" | "plain">("status");
  const router = useRouter();
  const [large, setLarge] = useState(false);
  const [bar, setBar] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [hiddenGroups, setHiddenGroups] = useState<Set<number>>(() => new Set());
  const [version, setVersion] = useState(builtAt);
  // undefined while loading, null when there is no model to show.
  const [model, setModel] = useState<ViewerModel | null | undefined>(builtAt ? undefined : null);
  const [building, setBuilding] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const colorMap = useMemo(() => new Map(parts.map((p) => [p.key, p.color])), [parts]);
  const onLocated = useCallback(() => {}, []);
  const partByKey = useMemo(() => new Map(parts.map((p) => [p.key, p])), [parts]);
  const picked = selected ? partByKey.get(selected) : undefined;
  const cardHref = (p: ViewerPart) => `/robots/${robotId}/systems/${p.systemId}#part-${p.id}`;
  const openCard = (p: ViewerPart) => {
    setLarge(false);
    setChoosing(false);
    if (systemId === p.systemId) window.location.hash = `part-${p.id}`;
    else router.push(cardHref(p));
  };
  const onPick = (key: string | null) => {
    setChoosing(false);
    if (!key || key !== selected) return setSelected(key);
    const part = partByKey.get(key);
    if (!part) return; // placed in CAD but not on the BOM
    if (part.fab) setChoosing(true);
    else openCard(part);
  };
  const groups = useMemo(() => model?.groups ?? [], [model]);
  // A system page draws only the groups its system is in.
  const ownGroups = useMemo(
    () => (systemId ? groups.flatMap((g, i) => (g.systemIds.includes(systemId) ? [i] : [])) : null),
    [groups, systemId],
  );
  const hidden = useMemo(
    () => (ownGroups ? new Set(groups.map((_, i) => i).filter((i) => !ownGroups.includes(i))) : hiddenGroups),
    [ownGroups, groups, hiddenGroups],
  );
  const toggleGroup = (i: number) =>
    setHiddenGroups((h) => {
      const next = new Set(h);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  useEffect(() => {
    if (!large) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setLarge(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [large]);

  useEffect(() => {
    if (!version) return;
    let cancelled = false;
    fetch(`/api/robots/${robotId}/model`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { model: ViewerModel | null } | null) => !cancelled && setModel(d?.model ?? null))
      .catch(() => {
        if (cancelled) return;
        setModel(null);
        setMessage({ text: "The 3D model couldn't load. Try reloading the page.", error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [robotId, version]);

  async function build() {
    setMessage(null);
    setBuilding("Checking Onshape…");
    let calls = 0;
    try {
      for (let round = 0; round < 30; round++) {
        const res = await fetch(`/api/robots/${robotId}/model`, { method: "POST" });
        const a = (await res.json().catch(() => ({ error: `The export failed (${res.status}).` }))) as BuildAnswer;
        if ("error" in a) return setMessage({ text: a.error, error: true });
        calls += a.calls;
        if (a.state === "working") {
          setBuilding(`Exporting part studios ${a.done}/${a.total}…`);
          continue;
        }
        setMessage({
          text: a.unchanged
            ? `The 3D model is up to date (${calls} Onshape call${calls === 1 ? "" : "s"}).`
            : `3D model updated: ${a.parts} parts (${calls} Onshape calls).`,
        });
        if (!a.unchanged) setVersion(new Date().toISOString());
        return;
      }
      setMessage({ text: "Onshape is still exporting. Press Update 3D model again to continue.", error: true });
    } catch {
      setMessage({ text: "The export stopped. Press Update 3D model again to continue.", error: true });
    } finally {
      setBuilding(null);
    }
  }

  return (
    <>
      {large && (
        <button
          aria-label="Back to the dashboard"
          onClick={() => setLarge(false)}
          className="fixed inset-y-0 right-[var(--shell-right)] left-[var(--shell-left)] z-[29] cursor-default bg-black/30"
        />
      )}
      <section
        id="viewer"
        className={
          large
            ? "fixed inset-y-6 right-[calc(var(--shell-right)+1.5rem)] left-[calc(var(--shell-left)+1.5rem)] z-30 flex flex-col overflow-hidden rounded-xl border border-line-strong bg-surface shadow-2xl"
            : "panel flex min-h-80 flex-1 flex-col overflow-hidden"
        }
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Icon name="cube" className="h-4 w-4 text-accent-hover" />
          <h2 className="text-sm font-semibold">{systemId ? "3D View" : "3D Assembly Status View"}</h2>
          <div className="ml-auto flex items-center gap-2">
            {edit && hasAssembly && (
              <button className="btn h-8 text-xs" onClick={build} disabled={!!building}>
                {building ?? "Update 3D model"}
              </button>
            )}
            <Segmented
              label="Part colours"
              value={colors}
              onChange={setColors}
              options={[
                { value: "status", label: "Status" },
                { value: "plain", label: "Plain" },
              ]}
            />
            {!systemId && groups.length > 1 && (
              <button className="btn h-8 text-xs" aria-pressed={bar} onClick={() => setBar(!bar)}>
                Subsystems{hiddenGroups.size ? ` ${groups.length - hiddenGroups.size}/${groups.length}` : ""}
              </button>
            )}
            <button
              onClick={() => {
                setBar(!large);
                setLarge(!large);
              }}
              className="btn h-8 w-8 justify-center px-0"
              aria-label={large ? "Back to the dashboard" : "Open large"}
              title={large ? "Back to the dashboard (Esc)" : "Open large"}
            >
              <Icon name={large ? "shrink" : "expand"} />
            </button>
          </div>
        </div>
        <div className="relative min-h-72 flex-1 overflow-hidden bg-[radial-gradient(ellipse_at_50%_35%,var(--color-surface)_0%,var(--color-raised)_75%)]">
          {model ? (
            <ModelCanvas
              model={model}
              colors={colorMap}
              mode={colors}
              locateKey={null}
              onLocated={onLocated}
              hidden={hidden}
              selectedKey={selected}
              onPick={onPick}
            />
          ) : (
            <>
              {/* Grid floor in perspective. */}
              <div
                aria-hidden
                className="absolute inset-x-[-50%] bottom-[-10%] h-[70%] [transform:perspective(500px)_rotateX(62deg)] opacity-60"
                style={{
                  backgroundImage:
                    "linear-gradient(rgba(0,0,204,0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,204,0.14) 1px, transparent 1px)",
                  backgroundSize: "36px 36px",
                  maskImage: "linear-gradient(to top, black 30%, transparent)",
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                <p className="max-w-72 text-sm text-muted">
                  {model === undefined
                    ? "Loading the robot…"
                    : !hasAssembly
                      ? edit
                        ? "Link this robot's systems to their Onshape assemblies (from the Onshape panel or a system's gear), then press Update 3D model."
                        : "The robot model shows here once its systems are linked to Onshape."
                      : edit
                        ? "Press Update 3D model to export the robot from Onshape."
                        : "The robot model shows here once it's exported from Onshape in Edit mode."}
                </p>
              </div>
            </>
          )}
          {picked || selected ? (
            <div className="absolute top-3 left-1/2 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 animate-pop flex-wrap items-center justify-center gap-2 rounded-md border border-accent/50 bg-surface/95 px-3 py-2 text-xs shadow-sm backdrop-blur">
              <span className="min-w-0 truncate font-semibold text-fg">{picked?.name ?? "Placed in CAD, not on the BOM"}</span>
              {choosing && picked ? (
                <>
                  <Link href={`/robots/${robotId}/fab`} className="btn-primary h-7 px-2.5 text-xs">
                    To Fab
                  </Link>
                  <button className="btn h-7 px-2.5 text-xs" onClick={() => openCard(picked)}>
                    System page
                  </button>
                </>
              ) : (
                picked && <span className="text-subtle">Click it again to open its card</span>
              )}
              <button onClick={() => onPick(null)} className="press text-muted hover:text-fg" aria-label="Clear selection">
                ✕
              </button>
            </div>
          ) : null}
          {bar && !systemId && groups.length > 0 && (
            <div className="absolute top-3 bottom-3 left-3 flex w-56 flex-col overflow-hidden rounded-md border border-line bg-surface/95 text-sm shadow-sm backdrop-blur">
              <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs font-semibold text-muted">
                Subsystems
                <button
                  onClick={() => setHiddenGroups(hiddenGroups.size ? new Set() : new Set(groups.map((_, i) => i)))}
                  className="press font-medium text-accent-hover hover:underline"
                >
                  {hiddenGroups.size ? "Show all" : "Hide all"}
                </button>
              </div>
              <ul className="flex-1 overflow-y-auto p-1">
                {groups.map((g, i) => (
                  <li key={i}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-raised">
                      <input
                        type="checkbox"
                        checked={!hiddenGroups.has(i)}
                        onChange={() => toggleGroup(i)}
                        className="accent-[var(--color-accent)]"
                      />
                      <span className={`min-w-0 flex-1 truncate ${hiddenGroups.has(i) ? "text-subtle" : "text-fg"}`}>{g.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {model && systemId && !ownGroups?.length && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
              <p className="max-w-72 rounded-md bg-surface/90 p-3 text-sm text-muted">
                {edit
                  ? "This subsystem isn't in the robot's 3D model yet. Press Update 3D model."
                  : "This subsystem shows here once the robot's 3D model is updated in Edit mode."}
              </p>
            </div>
          )}
          {message && (
            <div
              role="status"
              className={`absolute top-3 right-3 max-w-72 animate-pop rounded-md border bg-surface/95 px-3 py-2 text-xs shadow-sm backdrop-blur ${
                message.error ? "border-rose-400/60 text-rose-500" : "border-line text-fg-2"
              }`}
            >
              {message.text}
            </div>
          )}
          {colors === "status" && statuses.length > 0 && (
            <div
              className={`pointer-events-none absolute right-3 bottom-3 ${bar && !systemId && groups.length > 0 ? "left-62" : "left-3"} flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-fg-2`}
            >
              {statuses.map((s) => (
                <span key={s.name} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  {s.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
