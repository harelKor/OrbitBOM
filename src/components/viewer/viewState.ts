// The whole view as data (S6 in plan/cad-3d-viewer.md): the camera (pose and projection), hidden
// and isolated parts, the section, the render mode and the page's part colours. Written to the URL
// hash (`#v=…`, so a reload keeps it and "Copy view link" shares it), saved with each comment and
// as Onshape's Named views, and put back from them. No three.js here: the server checks a view a
// browser sent with `cleanView` before saving it.
import type { ViewPose } from "./camera";
import type { DisplayMode } from "./paint";
import type { Section } from "./sectionMath";
import type { SceneTools } from "./types";
import type { VisibilityState } from "./visibility";

export type ViewState = {
  pose: ViewPose;
  vis?: VisibilityState; // left out when nothing is hidden, isolated or see-through
  section?: Section | null;
  display?: DisplayMode;
  colors?: string; // the page's part colours ("cad", "compare"), when it has a choice
};

// A view as one string can carry it: the JSON with numbers rounded to 0.01 mm (positions are in
// metres; directions to 1e-5), in base64url.
const round = (x: unknown): unknown => {
  if (typeof x === "number") return Number.isFinite(x) ? Math.round(x * 1e5) / 1e5 : 0;
  if (Array.isArray(x)) return x.map(round);
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined).map(([k, v]) => [k, round(v)]));
  return x;
};

export function encodeView(v: ViewState): string {
  const bytes = new TextEncoder().encode(JSON.stringify(round(v)));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeView(text: string): ViewState | null {
  try {
    const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return cleanView(JSON.parse(new TextDecoder().decode(Uint8Array.from(s, (c) => c.charCodeAt(0)))));
  } catch {
    return null;
  }
}

// paint.ts's render modes (not imported: it brings three.js, and the server checks views too).
const DISPLAYS: DisplayMode[] = ["shadedEdges", "shaded", "shadedHidden", "hiddenRemoved", "hiddenVisible", "translucent"];
const MAX_JSON = 40_000; // a few hundred hidden parts; a view is normally well under 1 kB
const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);
const v3 = (x: unknown): x is [number, number, number] => Array.isArray(x) && x.length === 3 && x.every(num);
const keys = (x: unknown, max = 2000) => Array.isArray(x) && x.length <= max && x.every((k) => typeof k === "string" && k.length <= 300);

// A view from outside (a link, the database, a browser, an MCP client), checked field by field;
// null when it isn't one. Unknown fields are dropped.
export function cleanView(x: unknown): ViewState | null {
  if (!x || typeof x !== "object" || JSON.stringify(x).length > MAX_JSON) return null;
  const o = x as Record<string, unknown>;
  const p = o.pose as Record<string, unknown> | undefined;
  if (!p || !v3(p.target) || !v3(p.dir) || !num(p.half) || !((p.half as number) > 0)) return null;
  const view: ViewState = { pose: { target: p.target, dir: p.dir, half: p.half as number, projection: p.projection === "perspective" ? "perspective" : "ortho" } };
  const vis = o.vis as Record<string, unknown> | undefined;
  if (vis && typeof vis === "object") {
    const hidden = Array.isArray(vis.hidden) ? vis.hidden.filter((h): h is { key: string; at: [number, number, number] } => !!h && typeof h.key === "string" && h.key.length <= 300 && v3(h.at)).slice(0, 2000) : [];
    view.vis = {
      hidden: hidden.map(({ key, at }) => ({ key, at })),
      isolated: keys(vis.isolated) ? (vis.isolated as string[]) : null,
      ghost: vis.ghost === true,
      clear: keys(vis.clear) ? (vis.clear as string[]) : [],
    };
  }
  const sec = o.section as Record<string, unknown> | null | undefined;
  if (sec && Array.isArray(sec.planes) && sec.planes.length && sec.planes.length <= 3 && sec.planes.every((c) => c && typeof c === "object")) {
    // The cuts' own fields are sectionMath's; kept as sent (numbers only, checked by size above).
    const field = (v: unknown) => num(v) || typeof v === "boolean" || (typeof v === "string" && v.length <= 20) || (Array.isArray(v) && v.length <= 3 && v.every(num));
    const ok = sec.planes.every((c) => Object.values(c as object).every(field));
    if (ok) view.section = { planes: sec.planes as Section["planes"], open: false };
  }
  if (DISPLAYS.includes(o.display as DisplayMode)) view.display = o.display as DisplayMode;
  if (typeof o.colors === "string" && o.colors.length <= 40) view.colors = o.colors;
  return view;
}

// The view now, from the viewer's tools.
export function captureView(tools: SceneTools, colors?: string): ViewState {
  const vis = tools.visibilityState();
  const section = tools.sectionNow();
  const busy = vis.hidden.length || vis.isolated || vis.clear.length;
  return {
    pose: tools.pose(),
    vis: busy ? vis : undefined,
    section: section?.planes.length ? { planes: section.planes, open: false } : undefined,
    display: tools.display(),
    colors,
  };
}

// Puts a view back: the camera at once (animated with `animate`), the hidden parts and the cut
// once every part file is in (a hidden part still on its way couldn't be found yet).
export function applyView(tools: SceneTools, v: ViewState, animate: boolean) {
  tools.setPose(v.pose, animate);
  if (v.display) tools.setDisplay(v.display);
  void tools.whenLoaded().then(() => {
    tools.setVisibilityState(v.vis ?? { hidden: [], isolated: null, ghost: false, clear: [] });
    tools.section(v.section?.planes.length ? { planes: v.section.planes, open: false } : null);
  });
}

// The URL hash: `#v=…` (other hash parts are kept).
export function viewFromHash(hash = location.hash): ViewState | null {
  const m = /(?:^#|&)v=([A-Za-z0-9_-]+)/.exec(hash);
  return m ? decodeView(m[1]) : null;
}

export function hashWithView(v: ViewState | null, hash = location.hash): string {
  const rest = hash.replace(/^#/, "").split("&").filter((p) => p && !p.startsWith("v="));
  if (v) rest.push(`v=${encodeView(v)}`);
  return rest.length ? `#${rest.join("&")}` : "";
}
