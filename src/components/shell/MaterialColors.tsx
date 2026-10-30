"use client";

import { createContext, useContext } from "react";
import type { MaterialGroup } from "@/lib/data/materials";

// The team's material colours (changed ones only), for every 3D view's Material mode.
const MaterialColorsContext = createContext<Record<string, string>>({});
// The inventory items a part's material can be, by category (Raw Stock first), for every
// material picker.
const MaterialsContext = createContext<MaterialGroup[]>([]);

export function MaterialColorsProvider({ initial, materials, children }: { initial: Record<string, string>; materials: MaterialGroup[]; children: React.ReactNode }) {
  return (
    <MaterialsContext.Provider value={materials}>
      <MaterialColorsContext.Provider value={initial}>{children}</MaterialColorsContext.Provider>
    </MaterialsContext.Provider>
  );
}

export const useMaterialColors = () => useContext(MaterialColorsContext);
export const useMaterials = () => useContext(MaterialsContext);
