"use client";

import { createContext, useContext } from "react";
import type { VersionTags } from "@/lib/versions/tags";

export type InventoryName = { id: string; name: string };

// What every field in a BOM view may need, provided once by BomView: the inventory items for
// the Material menu's INVENTORY group, whether the viewer is an admin (deleting files), and
// the robot, for Locate in the robot dashboard, and on a system page the parts' version tags.
type Bom = { inventory: InventoryName[]; isAdmin: boolean; robotId?: string; versions?: VersionTags };

const BomContext = createContext<Bom>({ inventory: [], isAdmin: false });

export const BomProvider = BomContext.Provider;
export const useBom = () => useContext(BomContext);
