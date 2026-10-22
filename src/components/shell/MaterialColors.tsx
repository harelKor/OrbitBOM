"use client";

import { createContext, useContext } from "react";

// The team's material colours (changed ones only), for every 3D view's Material mode.
const MaterialColorsContext = createContext<Record<string, string>>({});

export function MaterialColorsProvider({ initial, children }: { initial: Record<string, string>; children: React.ReactNode }) {
  return (
    <MaterialColorsContext.Provider value={initial}>
      {children}
    </MaterialColorsContext.Provider>
  );
}

export const useMaterialColors = () => useContext(MaterialColorsContext);
