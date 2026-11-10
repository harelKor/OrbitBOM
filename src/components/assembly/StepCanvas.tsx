"use client";

import { useCallback, useEffect, useState } from "react";
import { ModelCanvas, type SceneTools, type ViewerMode, type ViewerModel } from "@/components/dashboard/ModelCanvas";
import type { StepCamera } from "@/db/schema";

const noop = () => {};

// The Assembly page's 3D views: ModelCanvas with the parts it is given, put at the step's saved
// camera once loaded (framed on its parts when there is none).
export function StepCanvas({
  model,
  colors,
  mode = "status",
  camera,
  names,
  selected,
  onPick,
  onHover,
  onTools,
  cube = true,
}: {
  model: ViewerModel;
  colors: Map<string, string>;
  mode?: ViewerMode;
  camera?: StepCamera | null;
  names?: Map<string, string>;
  selected?: readonly string[] | null;
  onPick?: (key: string | null) => void;
  onHover?: (key: string | null) => void;
  onTools?: (tools: SceneTools | null) => void;
  cube?: boolean;
}) {
  const [tools, setTools] = useState<SceneTools | null>(null);
  const take = useCallback(
    (t: SceneTools | null) => {
      setTools(t);
      onTools?.(t);
    },
    [onTools],
  );
  useEffect(() => {
    if (tools && camera) tools.setPose(camera, false);
  }, [tools, camera]);
  return (
    <ModelCanvas
      model={model}
      colors={colors}
      mode={mode}
      locateKey={null}
      onLocated={noop}
      names={names}
      selectedKey={selected ?? null}
      onPick={onPick}
      onHover={onHover}
      onTools={take}
      onHidden={noop}
      cube={cube}
    />
  );
}
