"use client";

import { useCallback, useEffect, useState } from "react";
import type { MeasureInfo, SceneTools } from "./ModelCanvas";

const NONE: MeasureInfo = { picks: [], rows: [], parts: [] };

// The CAD page's picking on a BOM page's 3D view (Harel, 2026-11-17): points, edges and faces are
// picked at all times and measured in the MeasureBox; Open part / Open system live in the
// right-click menu, not a pop-up on a left click. Off (`on` false) while Bulk edit takes the
// clicks: then a click picks a whole part, as before.
export function useMeasurePicks(on = true) {
  const [tools, setTools] = useState<SceneTools | null>(null);
  const [measured, setMeasured] = useState<MeasureInfo>(NONE);
  useEffect(() => {
    tools?.measure(on ? "any" : null);
  }, [tools, on]);
  // Esc: drops every pick (measure(null) clears them, then picking goes on).
  const clear = useCallback(() => {
    if (!tools || !on) return;
    tools.measure(null);
    tools.measure("any");
  }, [tools, on]);
  return { tools, setTools, measured: tools ? measured : NONE, setMeasured, clear, picked: !!tools && measured.picks.length > 0 };
}
