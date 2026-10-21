"use client";

import { createContext, useContext } from "react";
import { DEFAULT_MATERIAL_COLORS, MATERIAL_COLOR_GROUPS, NO_MATERIAL, materialColorGroup } from "@/config/materialColors";

// The team's material colours (changed ones only), for every 3D view's Material mode and a
// part thumbnail's material tint.
const MaterialColorsContext = createContext<Record<string, string>>({});

export function MaterialColorsProvider({ initial, children }: { initial: Record<string, string>; children: React.ReactNode }) {
  return (
    <MaterialColorsContext.Provider value={initial}>
      <TintFilters overrides={initial} />
      {children}
    </MaterialColorsContext.Provider>
  );
}

export const useMaterialColors = () => useContext(MaterialColorsContext);

// Thumbnails come from Onshape in the CAD's own appearance. Each filter repaints one in a
// material's colour: grey shading is mapped from black through the colour to white, so the
// part keeps its shading and a white or see-through background stays as it is.
const tintId = (group: string) => `material-tint-${MATERIAL_COLOR_GROUPS.indexOf(group)}`;

function TintFilters({ overrides }: { overrides: Record<string, string> }) {
  return (
    <svg aria-hidden width="0" height="0" className="absolute">
      {MATERIAL_COLOR_GROUPS.filter((g) => g !== NO_MATERIAL).map((group) => {
        const hex = overrides[group] ?? DEFAULT_MATERIAL_COLORS[group];
        const [r, g, b] = [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3));
        return (
          <filter key={group} id={tintId(group)} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values="0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0" />
            <feComponentTransfer>
              <feFuncR type="table" tableValues={`0 ${r} ${r} 1`} />
              <feFuncG type="table" tableValues={`0 ${g} ${g} 1`} />
              <feFuncB type="table" tableValues={`0 ${b} ${b} 1`} />
            </feComponentTransfer>
          </filter>
        );
      })}
    </svg>
  );
}

// The CSS filter that tints a part's thumbnail in its material's colour (none without a material),
// for the card's material button.
export function materialTint(material: string | null | undefined, onshapeMaterial?: string | null): string | undefined {
  const group = materialColorGroup(material, onshapeMaterial);
  return group === NO_MATERIAL ? undefined : `url(#${tintId(group)})`;
}
