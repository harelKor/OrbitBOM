"use client";

import { createContext, useContext } from "react";

export type InventoryName = { id: string; name: string };

// What every field in a BOM view may need, provided once by BomView: the inventory items for
// the Material menu's INVENTORY group, whether the viewer is an admin (deleting files), and
// the robot, for Locate in the robot dashboard.
type Bom = { inventory: InventoryName[]; isAdmin: boolean; robotId?: string };

const BomContext = createContext<Bom>({ inventory: [], isAdmin: false });

export const BomProvider = BomContext.Provider;
export const useBom = () => useContext(BomContext);
