"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StatusCount } from "@/lib/stats";
import { Icon } from "@/components/ui/Icon";
import { buildModel } from "@/components/viewer/buildModel";
import { drawPictures } from "@/components/viewer/pictures";
import type { ViewerMode, ViewerModel } from "./ModelCanvas";
import { ModelToggle, rememberModel, startModel, type ModelKind } from "./ModelToggle";
import { PickedPart } from "./PickedPart";
import {
  BULK_ASK_EVENT,
  BULK_SELECTION_EVENT,
  BULK_TOGGLE_EVENT,
  MODEL_STALE_EVENT,
  OPEN_PART_EVENT,
  OPEN_PART_PENDING,
  type BulkSelectionDetail,
  type BulkToggleDetail,
  type ModelStaleDetail,
  type OpenPartDetail,
} from "./modelEvents";

const ModelCanvas = dynamic(() => import("./ModelCanvas").then((m) => m.ModelCanvas), { ssr: false });

// A BOM part as the viewer knows it: its key in the model, status colour, and where its card is.
export type ViewerPart = { key: string; color: string; id: string; systemId: string; name: string; fab: boolean };

// The 3D robot stage. The model is built from the systems' Onshape assemblies on demand
// (Edit mode's Update 3D model) and kept in R2; viewing it costs no Onshape calls. On the page it
// sits in a thin outline on the page's own background that glows on hover, and a click beside the
// model (not on a part, which picks it, nor a drag, which turns it) opens it large over the page, leaving the side panels and a
// margin of background (Harel, 2026-11-07). The
// Subsystems button shows and hides subsystems (open by default when large). On a system page
// (systemId) it shows only that subsystem. A click on a part highlights it; a second click on it
// opens its details window over the viewer, which stays as it is behind it (from a page without the
// part's card, it goes to the system page and opens it there). (Locate opens a part's own window
// from its card: PartStage.)
export function RobotViewer({
  robotId,
  systemId,
  statuses,
  parts,
  builtAt,
  hasAssembly,
  edit,
  basepart = null,
  initialModel,
}: {
  robotId: string;
  systemId?: string;
  statuses: StatusCount[];
  parts: ViewerPart[]; // BOM parts by Onshape identity
  builtAt: string | null;
  hasAssembly: boolean;
  edit: boolean;
  // The Basepart model (Harel, 2026-11-12): when it was built, and whether a Basepart is linked.
  // With both, a Basepart | Final toggle; with only a Basepart, that.
  basepart?: { builtAt: string | null; linked: boolean } | null;
  initialModel?: ModelKind;
}) {
  const hasFinal = hasAssembly || !!builtAt;
  const hasBasepart = !!basepart && (basepart.linked || !!basepart.builtAt);
  const [kind, setKind] = useState<ModelKind>(() => startModel(initialModel, hasFinal, hasBasepart));
  const isBasepart = kind === "basepart";
  // Parts look as Onshape draws them, with a light wash of their BOM status colour; no Status / CAD
  // switch any more (Harel, 2026-11-13). The Basepart isn't on the BOM: plain CAD colours.
  const colors: ViewerMode = isBasepart ? "cad" : "tint";
  const router = useRouter();
  const [large, setLarge] = useState(false);
  const [bar, setBar] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [hiddenGroups, setHiddenGroups] = useState<Set<number>>(() => new Set());
  const [versions, setVersions] = useState<Record<ModelKind, string | null>>({ final: builtAt, basepart: basepart?.builtAt ?? null });
  const version = versions[kind];
  // undefined while loading, null when there is no model to show.
  const [model, setModel] = useState<ViewerModel | null | undefined>(version ? undefined : null);
  const pickKind = (k: ModelKind) => {
    if (k === kind) return;
    setKind(k);
    setSelected(null);
    setHiddenGroups(new Set());
    setMessage(null);
    setModel(versions[k] ? undefined : null);
    rememberModel(k);
  };
  const [building, setBuilding] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const colorMap = useMemo(() => new Map(parts.map((p) => [p.key, p.color])), [parts]);
  const legend = !isBasepart ? statuses.filter((s) => s.count > 0) : [];
  const onLocated = useCallback(() => {}, []);
  const partByKey = useMemo(() => new Map(parts.map((p) => [p.key, p])), [parts]);
  const nameByKey = useMemo(() => new Map(parts.map((p) => [p.key, p.name])), [parts]);
  const picked = selected ? partByKey.get(selected) : undefined;
  // The page's Bulk edit selection (part ids), while it's on: drawn in green, and a click on a
  // part adds it or takes it out instead of picking it (Harel, 2026-11-10).
  const [bulk, setBulk] = useState<string[] | null>(null);
  useEffect(() => {
    const onBulk = (e: Event) => {
      const { ids } = (e as CustomEvent<BulkSelectionDetail>).detail;
      setBulk(ids);
      if (ids) setSelected(null);
    };
    window.addEventListener(BULK_SELECTION_EVENT, onBulk);
    window.dispatchEvent(new Event(BULK_ASK_EVENT)); // Bulk edit may be on already
    return () => window.removeEventListener(BULK_SELECTION_EVENT, onBulk);
  }, []);
  const bulkKeys = useMemo(() => {
    if (!bulk) return null;
    const keyOf = new Map(parts.map((p) => [p.id, p.key]));
    return bulk.flatMap((id) => keyOf.get(id) ?? []);
  }, [bulk, parts]);
  const openLarge = () => {
    setBar(true);
    setLarge(true);
  };
  // A click on a part picks it, and one more click on it opens it. With a part picked, a click
  // anywhere else only clears it; with none, a click beside the small model opens it large
  // (Harel, 2026-11-07).
  const onPick = (key: string | null) => {
    if (bulk) {
      const part = key ? partByKey.get(key) : undefined;
      if (part) window.dispatchEvent(new CustomEvent<BulkToggleDetail>(BULK_TOGGLE_EVENT, { detail: { partId: part.id } }));
      else if (!key && !large) openLarge();
      return;
    }
    if (key && key === selected) onOpen(key);
    else if (key || selected) setSelected(key);
    else if (!large) openLarge();
  };
  const onOpen = (key: string) => {
    setSelected(key);
    const part = partByKey.get(key);
    if (!part) return; // placed in CAD but not on the BOM
    const detail: OpenPartDetail = { partId: part.id, taken: false };
    window.dispatchEvent(new CustomEvent(OPEN_PART_EVENT, { detail }));
    if (detail.taken) return;
    try {
      sessionStorage.setItem(OPEN_PART_PENDING, part.id);
    } catch {}
    setLarge(false);
    router.push(`/robots/${robotId}/systems/${part.systemId}#part-${part.id}`);
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

  // Esc first clears the picked part, then closes the large view (Harel, 2026-11-07). Not while a
  // window is open over it: that Esc is the window's.
  useEffect(() => {
    if (!large && !selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return;
      e.preventDefault(); // used here, so the shell doesn't also collapse a side column
      if (selected) setSelected(null);
      else setLarge(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [large, selected]);

  useEffect(() => {
    if (!version) return;
    let cancelled = false;
    const q = new URLSearchParams({ ...(systemId ? { system: systemId } : {}), ...(isBasepart ? { model: "basepart" } : {}) }).toString();
    fetch(`/api/robots/${robotId}/model${q ? `?${q}` : ""}`)
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
  }, [robotId, systemId, version, isBasepart]);

  const buildRef = useRef(build);
  useEffect(() => {
    buildRef.current = build;
  });
  useEffect(() => {
    const onStale = (e: Event) => {
      const detail = (e as CustomEvent<ModelStaleDetail | undefined>).detail;
      if (detail) detail.taken = true;
      void buildRef.current().finally(() => detail?.resolve());
    };
    window.addEventListener(MODEL_STALE_EVENT, onStale);
    return () => window.removeEventListener(MODEL_STALE_EVENT, onStale);
  }, []);

  async function build() {
    setMessage(null);
    setBuilding("Checking Onshape…");
    try {
      const built = kind;
      const r = await buildModel(robotId, setBuilding, built);
      if (!r.ok) return setMessage({ text: r.error, error: true });
      const calls = r.calls;
      const what = built === "basepart" ? "Basepart 3D model" : "3D model";
      setMessage({
        text: r.unchanged
          ? `The ${what} is up to date (${calls} Onshape call${calls === 1 ? "" : "s"}).`
          : `${what} updated: ${r.parts} parts (${calls} Onshape calls).`,
      });
      if (!r.unchanged) setVersions((v) => ({ ...v, [built]: new Date().toISOString() }));
      // Pictures come from the Final model only.
      if (built === "basepart") return;
      // The pictures the new model changed, drawn from it (no Onshape calls).
      setBuilding("Drawing the pictures…");
      if (await drawPictures(robotId, systemId)) router.refresh();
    } finally {
      setBuilding(null);
    }
  }

  // Pictures still missing (a model built on the server, like a first sync from the Onshape
  // panel), drawn once per page by a CAD member's browser, quietly.
  const pictured = useRef(false);
  useEffect(() => {
    if (!edit || !model || isBasepart || pictured.current) return;
    pictured.current = true;
    void drawPictures(robotId, systemId).then((n) => n && router.refresh());
  }, [edit, model, isBasepart, robotId, systemId, router]);

  return (
    <>
      {large && (
        <button
          aria-label="Back to the dashboard"
          onClick={() => setLarge(false)}
          className="fixed inset-y-0 right-[var(--shell-right)] left-[var(--shell-left)] z-[29] cursor-default modal-backdrop"
        />
      )}
      <section
        id="viewer"
        tabIndex={large ? undefined : 0}
        aria-label={large ? undefined : "3D view: open large"}
        title={large ? undefined : "Open large"}
        onClick={(e) => {
          // The canvas reports its own clicks (onPick) so a drag can turn the model; the controls
          // keep theirs.
          const target = e.target as HTMLElement;
          if (large || target.tagName === "CANVAS" || target.closest("button, a, input, label, [role=radiogroup], [role=status]")) return;
          if (selected) setSelected(null);
          else openLarge();
        }}
        onKeyDown={(e) => {
          if (!large && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            openLarge();
          }
        }}
        className={
          large
            ? "fixed inset-y-6 right-[calc(var(--shell-right)+1.5rem)] left-[calc(var(--shell-left)+1.5rem)] z-30 modal flex flex-col overflow-hidden"
            : "stage-frame stage-glow flex min-h-80 flex-1 cursor-pointer flex-col overflow-hidden"
        }
      >
        <div className={`flex cursor-auto flex-wrap items-center gap-3 px-4 py-3 ${large ? "border-b border-line" : ""}`}>
          <Icon name="cube" className="h-4 w-4 text-accent-hover" />
          <h2 className="text-sm font-semibold">{systemId ? "3D View" : "3D Assembly Status View"}</h2>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {hasFinal && hasBasepart && <ModelToggle value={kind} onChange={pickKind} />}
            {edit && (isBasepart ? hasBasepart : hasAssembly) && (
              <button className="btn h-8 text-xs" onClick={build} disabled={!!building}>
                {building ?? "Update 3D model"}
              </button>
            )}
            {!systemId && groups.length > 1 && (
              <button className="btn h-8 text-xs" aria-pressed={bar} onClick={() => setBar(!bar)}>
                Subsystems{hiddenGroups.size ? ` ${groups.length - hiddenGroups.size}/${groups.length}` : ""}
              </button>
            )}
            {large && (
              <button
                onClick={() => {
                  setBar(false);
                  setLarge(false);
                }}
                className="btn h-8 w-8 justify-center px-0"
                aria-label="Back to the dashboard"
                title="Back to the dashboard (Esc)"
              >
                <Icon name="shrink" />
              </button>
            )}
          </div>
        </div>
        <div className="relative min-h-72 flex-1 overflow-hidden">
          {model ? (
            <ModelCanvas
              model={model}
              colors={colorMap}
              mode={colors}
              locateKey={null}
              onLocated={onLocated}
              hidden={hidden}
              selectedKey={bulkKeys ?? selected}
              onPick={onPick}
              names={nameByKey}
              panelLeft={bar && !systemId && groups.length > 0 ? 244 : undefined}
              cube // the view cube and its menu, as on CAD's pages (Harel, 2026-11-11)
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
                    : isBasepart
                      ? edit
                        ? "Press Update 3D model to export the Basepart from Onshape."
                        : "The Basepart shows here once it's exported from Onshape by the CAD Team."
                      : !hasAssembly
                      ? edit
                        ? "Link this robot's systems to their Onshape assemblies (from the Onshape panel or a system's gear), then press Update 3D model."
                        : "The robot model shows here once its systems are linked to Onshape."
                      : edit
                        ? "Press Update 3D model to export the robot from Onshape."
                        : "The robot model shows here once it's exported from Onshape by the CAD Team."}
                </p>
              </div>
            </>
          )}
          {bulk ? (
            <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 animate-pop rounded-md border border-accent/40 bg-surface/95 px-3 py-1.5 text-xs font-medium whitespace-nowrap text-fg-2 shadow-sm backdrop-blur">
              Bulk edit: tap parts to select them
            </div>
          ) : picked || selected ? (
            <PickedPart
              name={picked?.name ?? null}
              onOpen={picked && (() => onOpen(picked.key))}
              // Not on the part's own system page: it's already there.
              systemHref={picked && picked.systemId !== systemId ? `/robots/${robotId}/systems/${picked.systemId}` : undefined}
              onSystem={() => setLarge(false)}
              onClear={() => setSelected(null)}
            />
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
                  : "This subsystem shows here once the robot's 3D model is updated by the CAD Team."}
              </p>
            </div>
          )}
          {message && (
            <div
              role="status"
              // Under the view cube when the model shows.
              className={`absolute ${model ? "top-33" : "top-3"} right-3 max-w-72 animate-pop rounded-md border bg-surface/95 px-3 py-2 text-xs shadow-sm backdrop-blur ${
                message.error ? "border-rose-400/60 text-rose-500" : "border-line text-fg-2"
              }`}
            >
              {message.text}
            </div>
          )}
          {legend.length > 0 && (
            <div
              className={`pointer-events-none absolute right-3 bottom-3 ${bar && !systemId && groups.length > 0 ? "left-62" : "left-3"} flex flex-wrap gap-x-3 gap-y-1 text-[0.6875rem] text-fg-2`}
            >
              {legend.map((s) => (
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
