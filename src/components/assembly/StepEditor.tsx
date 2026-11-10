"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { saveAssemblyStep } from "@/app/(app)/robots/[robotId]/assembly/actions";
import type { SceneTools, ViewerModel } from "@/components/dashboard/ModelCanvas";
import { Dialog } from "@/components/Dialog";
import { Checkbox } from "@/components/ui/Checkbox";
import { toast } from "@/components/ui/Toaster";
import { subColor, type Place } from "@/lib/assembly/groups";
import { earlierKeys, stepKeys, subModel, type Book } from "@/lib/assembly/view";
import type { AssemblyData, AssemblyStep } from "@/lib/data/assembly";
import { NEW_PART, OLD_PART, REST_PART } from "./colors";
import { StepCanvas } from "./StepCanvas";

export type EditorTarget = { kind: "step" | "sub"; step?: AssemblyStep; before?: string };

// Writing a step (CAD): set up the 3D, tap the parts this step adds (or tick them in the list),
// write a title and a few words. Saving keeps the camera and a still of the step as builders see it
// (the parts it doesn't use left out). A sub-assembly step picks one of the system's sub-assemblies.
export function StepEditor({
  robotId,
  book,
  data,
  place,
  list,
  model,
  target,
  onClose,
}: {
  robotId: string;
  book: Book;
  data: AssemblyData;
  place: Place;
  list: AssemblyStep[];
  model: ViewerModel | null;
  target: EditorTarget;
  onClose: () => void;
}) {
  const router = useRouter();
  const step = target.step;
  const isSub = target.kind === "sub";
  const sys = book.systems.find((s) => s.id === place.systemId)!;
  const placed = new Set(list.flatMap((s) => (s.kind === "sub" && s.subRef && s.id !== step?.id ? [s.subRef] : [])));
  const [subRef, setSubRef] = useState<string | null>(step?.subRef ?? sys.subs.find((x) => !placed.has(x.code))?.code ?? sys.subs[0]?.code ?? null);
  const [title, setTitle] = useState(step?.title ?? "");
  const [body, setBody] = useState(step?.body ?? "");
  const [critical, setCritical] = useState(step?.critical ?? false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(step?.kind === "step" ? step.partKeys : []));
  const [busy, setBusy] = useState(false);
  const [tools, setTools] = useState<SceneTools | null>(null);
  const area = useRef<HTMLDivElement>(null);

  // Where the step sits: the steps before it give the parts already on.
  const index = step ? list.indexOf(step) : target.before ? Math.max(0, list.findIndex((s) => s.id === target.before)) : list.length;
  const before = useMemo(() => earlierKeys(book, list, index), [book, list, index]);
  const placeKeys = useMemo(() => {
    const all = book.keys(place);
    // A system's own column: its loose parts and what earlier steps showed; sub-assemblies are placed whole.
    return place.sub ? all : all.filter((k) => !book.subOfKey.has(k) || before.includes(k));
  }, [book, place, before]);
  const subKeys = useMemo(() => (isSub && subRef ? book.keys({ systemId: place.systemId, sub: subRef }) : []), [isSub, subRef, book, place.systemId]);
  const own = useMemo(() => (isSub ? subKeys : [...picked]), [isSub, subKeys, picked]);
  const ownSet = useMemo(() => new Set(own), [own]);
  const rest = useMemo(() => (isSub ? [] : placeKeys.filter((k) => !ownSet.has(k) && !before.includes(k))), [isSub, placeKeys, ownSet, before]);

  const allKeys = useMemo(() => [...new Set([...before, ...placeKeys, ...subKeys])], [before, placeKeys, subKeys]);
  const shown = useMemo(() => (model ? subModel(model, allKeys) : null), [model, allKeys]);
  const colors = useMemo(() => {
    const m = new Map<string, string>();
    for (const k of allKeys) m.set(k, REST_PART);
    for (const k of before) m.set(k, OLD_PART);
    for (const k of own) m.set(k, isSub && subRef ? subColor(subRef) : NEW_PART);
    return m;
  }, [allKeys, before, own, isSub, subRef]);
  // Parts the step doesn't use stay see-through, so the new ones are easy to find and tap.
  useEffect(() => {
    if (!tools) return;
    tools.setClear(allKeys, false);
    tools.setClear(rest, true);
  }, [tools, allKeys, rest]);
  const names = useMemo(() => new Map(data.parts.map((p) => [p.key, p.name])), [data.parts]);
  const toggle = (key: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const onPick = (key: string | null) => {
    if (!key || isSub || before.includes(key)) return;
    toggle(key);
  };

  // The list: parts no step uses yet first (a reminder, not every part needs a step).
  const usedElsewhere = useMemo(() => new Set(list.filter((s) => s.id !== step?.id).flatMap((s) => stepKeys(book, s))), [list, step, book]);
  const partByKey = useMemo(() => new Map(data.parts.map((p) => [p.key, p])), [data.parts]);
  const choices = placeKeys.filter((k) => !before.includes(k)).flatMap((k) => partByKey.get(k) ?? []);
  const fresh = choices.filter((p) => !usedElsewhere.has(p.key) || picked.has(p.key));
  const other = choices.filter((p) => usedElsewhere.has(p.key) && !picked.has(p.key));
  const [showOther, setShowOther] = useState(false);

  const save = async () => {
    if (isSub && !subRef) return toast("Pick a sub-assembly.", true);
    if (!isSub && !title.trim()) return toast("Give the step a title.", true);
    setBusy(true);
    const camera = tools?.pose() ?? step?.camera ?? null;
    let imageKey = step?.imageKey ?? null;
    if (tools && area.current) {
      // The still: as builders see it, without the parts it doesn't use.
      rest.forEach((k) => tools.hideKey(k));
      const bg = getComputedStyle(area.current).backgroundColor;
      const shot = tools.snapshot({ x: 0, y: 0, w: area.current.clientWidth, h: area.current.clientHeight }, bg);
      tools.showAll();
      tools.setClear(rest, true);
      const uploaded = shot && (await uploadStill(shot.dataUrl));
      if (uploaded) imageKey = uploaded;
    }
    const r = await saveAssemblyStep(robotId, {
      id: step?.id ?? null,
      systemId: place.systemId,
      subCode: place.sub,
      kind: target.kind,
      subRef: isSub ? subRef : null,
      title: title.trim() || (isSub && subRef ? book.subName(place.systemId, subRef) : ""),
      body,
      critical,
      partKeys: isSub ? [] : [...picked],
      camera,
      imageKey,
      before: step ? null : (target.before ?? null),
    });
    setBusy(false);
    if (r.error) return toast(r.error, true);
    router.refresh();
    onClose();
  };

  return (
    <Dialog open onClose={onClose} title={step ? "Edit step" : isSub ? "New sub-assembly step" : "New step"} width="w-[min(1200px,96vw)]">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          <div ref={area} className="relative aspect-[4/3] overflow-hidden rounded-md border border-line bg-surface">
            {shown ? (
              <StepCanvas model={shown} colors={colors} camera={step?.camera} names={names} onPick={onPick} onTools={setTools} />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted">{model === null ? "No 3D model yet: the step saves without a view." : "Loading the 3D view…"}</div>
            )}
          </div>
          <p className="mt-1.5 text-xs text-subtle">
            {isSub ? "Turn the view the way builders should see the sub-assembly; Save keeps it." : "Tap parts to add them to this step (orange). Grey: from earlier steps. Turn the view the way builders should see it; Save keeps it."}
          </p>
        </div>
        <div className="space-y-3">
          {isSub && (
            <label className="block">
              <span className="label">Sub-assembly</span>
              <select className="input mt-1 w-full" value={subRef ?? ""} onChange={(e) => setSubRef(e.target.value)}>
                {sys.subs.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.name}
                    {placed.has(x.code) ? " (already placed)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className="label">Title{isSub ? " (optional)" : ""}</span>
            <input className="input mt-1 w-full" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={isSub && subRef ? book.subName(place.systemId, subRef) : "Press bearings into the side plates"} autoFocus />
          </label>
          <label className="block">
            <span className="label">What to do</span>
            <textarea className="input mt-1 min-h-28 w-full" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} placeholder="Short and clear: order, orientation, torque, Loctite…" />
          </label>
          <Checkbox checked={critical} onChange={setCritical}>
            <span className="font-semibold text-rose-600">⚠ Critical step</span>
          </Checkbox>
          {!isSub && (
            <div>
              <p className="label mb-1">
                Parts in this step <span className="text-subtle tabular-nums">· {picked.size}</span>
              </p>
              <ul className="max-h-60 space-y-0.5 overflow-y-auto rounded-md border border-line p-1">
                {fresh.map((p) => (
                  <PartRow key={p.key} name={p.name} number={p.number} qty={p.qty} on={picked.has(p.key)} onChange={() => toggle(p.key)} />
                ))}
                {!fresh.length && <li className="px-2 py-1.5 text-xs text-subtle">Every part here is in a step already.</li>}
                {other.length > 0 && (
                  <li>
                    <button className="press w-full px-2 py-1.5 text-left text-xs font-semibold text-muted hover:text-fg" onClick={() => setShowOther((v) => !v)}>
                      {showOther ? "▾" : "▸"} In other steps · {other.length}
                    </button>
                  </li>
                )}
                {showOther && other.map((p) => <PartRow key={p.key} name={p.name} number={p.number} qty={p.qty} on={false} onChange={() => toggle(p.key)} />)}
              </ul>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn h-10 px-4" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn-primary h-10 px-5" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save step"}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function PartRow({ name, number, qty, on, onChange }: { name: string; number: string | null; qty: number; on: boolean; onChange: () => void }) {
  return (
    <li>
      <button onClick={onChange} className={`press flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm pointer-coarse:min-h-10 ${on ? "bg-accent/10" : "hover:bg-raised"}`}>
        <span className={`h-3 w-3 shrink-0 rounded-sm border ${on ? "border-transparent" : "border-line-strong"}`} style={on ? { background: NEW_PART } : undefined} />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {number && <span className="shrink-0 font-mono text-[11px] text-subtle">{number}</span>}
        <span className="shrink-0 text-xs text-fg-2 tabular-nums">×{qty}</span>
      </button>
    </li>
  );
}

// The still, made smaller (about 960 px wide) and uploaded; null when storage isn't set up or it fails.
async function uploadStill(dataUrl: string): Promise<string | null> {
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const k = Math.min(1, 960 / img.width);
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.82));
    if (!blob) return null;
    const form = new FormData();
    form.append("file", blob, "still.jpg");
    const res = await fetch("/api/assembly-stills", { method: "POST", body: form });
    const r = (await res.json().catch(() => ({}))) as { path?: string };
    return res.ok && r.path ? r.path : null;
  } catch {
    return null;
  }
}
