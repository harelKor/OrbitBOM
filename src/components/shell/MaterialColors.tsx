"use client";

import { createContext, useContext } from "react";
import { MATERIALS, type MaterialList } from "@/config/materials";

// The team's material colours (changed ones only), for every 3D view's Material mode.
const MaterialColorsContext = createContext<Record<string, string>>({});
// The team's material list by category (edited on the Settings page), for every material picker.
const MaterialsContext = createContext<MaterialList>(MATERIALS);

export function MaterialColorsProvider({ initial, materials, children }: { initial: Record<string, string>; materials: MaterialList; children: React.ReactNode }) {
  return (
    <MaterialsContext.Provider value={materials}>
      <MaterialColorsContext.Provider value={initial}>{children}</MaterialColorsContext.Provider>
    </MaterialsContext.Provider>
  );
}

export const useMaterialColors = () => useContext(MaterialColorsContext);
export const useMaterials = () => useContext(MaterialsContext);
