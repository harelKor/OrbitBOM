"use client";

import { createContext, useContext } from "react";

export type InventoryName = { id: string; name: string };

// Inventory items for the Material menu's INVENTORY group, provided once by BomView.
const InventoryContext = createContext<InventoryName[]>([]);

export const InventoryProvider = InventoryContext.Provider;
export const useInventoryNames = () => useContext(InventoryContext);
