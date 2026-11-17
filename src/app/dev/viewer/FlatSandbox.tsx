"use client";

import { useState } from "react";
import { PartModel, PartStage, type StageView } from "@/components/dashboard/PartStage";

const SOURCES: Partial<Record<StageView, string>> = { part: "/api/dev/viewer/sheet?model=folded", flat: "/api/dev/viewer/sheet?model=flat" };

// The part window's 3D preview on the sandbox's sheet metal bracket (/dev/viewer?flat=1): Open
// flatten on the small preview, and big (a click on it) with picking and the measure box, as in
// PartDetails. Stand-in files from /api/dev/viewer/sheet, no Onshape.
export function FlatSandbox() {
  const [view, setView] = useState<StageView>("part");
  const [big, setBig] = useState(false);
  return (
    <main className="mx-auto max-w-3xl space-y-3 p-4">
      <p className="text-xs font-semibold text-muted">3D sandbox · Open flatten on a bent part · not real data</p>
      {big && <PartStage partId="sandbox" robotId={null} modelKey={null} name="U-bracket (sandbox)" view={view} onView={setView} flat sources={SOURCES} onClose={() => setBig(false)} />}
      <div className="stage-frame stage-glow relative aspect-[4/3] cursor-pointer overflow-hidden rounded-xl">
        <PartModel partId="sandbox" robotId={null} modelKey={null} view={view} onView={setView} locateButton={false} flat sources={SOURCES} onExpand={() => setBig(true)} className="h-full w-full" />
      </div>
    </main>
  );
}
