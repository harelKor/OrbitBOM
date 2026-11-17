"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/Toaster";
import type { MenuTarget } from "./picking";
import type { Gone, SceneTools } from "./types";

// A page's own items (Open part, Open system, Add comment here), for the parts the menu is on.
export type MenuItem = { label: string; run: () => void };

// A direction in Onshape's Z-up model frame, in the scene's Y-up frame (the model is turned -90°
// about X): what the camera's `look` takes.
const sceneDir = ([x, y, z]: [number, number, number]): [number, number, number] => [x, z, -y];
export type PageMenu = (keys: string[]) => MenuItem[];

// The 3D view's right-click / long-press menu, like Onshape's: on the part under the pointer (or
// every picked part when it's one of them), else on the view. No Select other (Harel, 2026-11-17).
// Closes on any choice, a press outside, Esc, the wheel or a resize.
export function ContextMenu({
  at,
  tools,
  hideCopy,
  names,
  page,
  onClose,
}: {
  at: MenuTarget;
  tools: SceneTools;
  hideCopy: (g: Gone) => void;
  names?: Map<string, string>;
  page?: PageMenu;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  const { keys, under, isolated } = at;
  const one = keys.length === 1 ? keys[0] : null;
  const name = (k: string) => names?.get(k) ?? "Placed in CAD, not on the BOM";
  const clear = keys.length > 0 && keys.every((k) => tools.isClear(k));

  // Kept inside the window (a long press near an edge on a phone).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // offsetWidth / offsetHeight: the menu's real size; its pop-in animation starts it scaled
    // down, so a measured box came out short and a menu low on the screen was cut off.
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    setPos({ left: Math.max(8, Math.min(at.x, window.innerWidth - width - 12)), top: Math.max(8, Math.min(at.y, window.innerHeight - height - 12)) });
    // No item is focused on open (that drew the focus outline round the first item, Harel
    // 2026-11-11); the arrow keys start from the top.
  }, [at]);

  useEffect(() => {
    const outside = (e: PointerEvent) => !box.current?.contains(e.target as Node) && onClose();
    // Esc closes the menu only (the page's Esc, which drops the picks, waits for the next one).
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = [...(box.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        items[i < 0 ? (e.key === "ArrowDown" ? 0 : items.length - 1) : (i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
      }
    };
    const close = () => onClose();
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("wheel", close, { passive: true });
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("wheel", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);

  const groups: MenuItem[][] = [];
  if (keys.length) {
    // Hide: the copy under the pointer (like Y), or every picked part's copies.
    const copy = one && under?.key === one ? under : null;
    const shownOthers = copy ? at.copies - 1 - at.hiddenCopies : 0;
    groups.push([
      { label: copy ? "Hide" : `Hide ${keys.length} parts`, run: () => (copy ? hideCopy(copy) : keys.forEach((k) => tools.hideKey(k))) },
      // Onshape's instance items, for a part placed more than once.
      ...(copy && at.copies > 1 ? [{ label: `Hide all ${at.copies} instances`, run: () => tools.hideKey(copy.key) }] : []),
      ...(copy && shownOthers > 0 ? [{ label: "Hide other instances", run: () => tools.hideOthers(copy) }] : []),
      ...(copy && at.hiddenCopies > 0 ? [{ label: "Show other instances", run: () => tools.showOthers(copy) }] : []),
      // Onshape's items, without Hide others and Zoom to (Harel, 2026-11-11). Isolate shows only
      // these parts; the ghosts come from the slider shown while isolated (GhostSlider).
      { label: "Isolate", run: () => tools.isolate(keys) },
      { label: clear ? "Make opaque" : "Make transparent", run: () => tools.setClear(keys, !clear) },
      // Onshape's Move (triad): the copy under the pointer, or every picked part's shown copies (S7).
      { label: "Move", run: () => tools.moveParts(copy ?? keys) },
      // View normal to looks straight at the flat face under the pointer (N), like Onshape's menu.
      ...(at.face ? [{ label: "View normal to", run: () => tools.look(sceneDir(at.face!.normal)) }] : []),
      // On a round face: along its axis, as Onshape does.
      ...(at.axis ? [{ label: "View normal to", run: () => tools.look(sceneDir(at.axis!)) }] : []),
    ]);
    const own = page?.(keys) ?? [];
    if (own.length) groups.push(own);
    if (one)
      groups.push([
        {
          label: "Copy name",
          run: () =>
            void navigator.clipboard.writeText(name(one)).then(
              () => toast("Name copied"),
              () => toast("Couldn't copy the name", true),
            ),
        },
      ]);
  }
  const view: MenuItem[] = [];
  if (at.hidden || isolated) view.push({ label: "Show all", run: () => tools.showAll() });
  // The section, always offered, on a part or on empty space (Harel, 2026-11-11), with the same
  // calls as the view cube's menu: Section view cuts on the flat face under the pointer, else
  // opens the panel on the default plane; with a section on, Edit and Turn off instead.
  if (tools.sectionNow())
    view.push({ label: "Edit section view", run: () => tools.sectionEdit() }, { label: "Turn off section view", run: () => tools.sectionShow(false) });
  // On a round face: a plane through its axis, cutting it lengthwise, like Onshape's (Harel, 2026-11-11).
  else view.push({ label: "Section view", run: () => (at.face ? tools.sectionFromFace(at.face.point, at.face.normal) : at.round ? tools.sectionFromRound(at.round) : tools.sectionShow(true)) });
  // Onshape's exploded view, on empty space (S7).
  if (!keys.length) view.push({ label: "Exploded view", run: () => tools.explodeShow(true) });
  // Show and Hide sketches on empty space, both listed as Onshape lists them (Harel, 2026-11-13),
  // when the model has Geometry sketches; the same as Shift+H.
  if (!keys.length && tools.hasSketches())
    view.push({ label: "Show sketches", run: () => tools.showSketches(true) }, { label: "Hide sketches", run: () => tools.showSketches(false) });
  groups.push(view);

  return (
    <div
      ref={box}
      role="menu"
      aria-label={one ? name(one) : keys.length ? `${keys.length} parts` : "View"}
      onContextMenu={(e) => e.preventDefault()}
      style={pos}
      className="fixed z-50 w-56 animate-pop overflow-hidden rounded-md border border-line bg-surface/95 py-1 text-sm shadow-lg backdrop-blur"
    >
      {keys.length > 0 && <p className="truncate border-b border-line px-3 pt-1 pb-1.5 text-xs font-semibold text-muted">{one ? name(one) : `${keys.length} picked parts`}</p>}
      {groups.map((items, g) => (
        <div key={g} className={g ? "mt-1 border-t border-line pt-1" : undefined}>
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              onClick={() => {
                onClose();
                item.run();
              }}
              className="press block w-full px-3 py-1.5 text-left text-fg-2 outline-none hover:bg-raised hover:text-fg focus-visible:bg-raised active:scale-[0.98] pointer-coarse:min-h-11"
            >
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
