"use client";

import { createContext, useContext } from "react";

// Which of the shell's side columns are on screen as columns (not drawers, not collapsed), for
// pages that lay themselves out differently when both take room (the robot dashboard's Status box).
export const SidePanelsContext = createContext({ left: false, right: false });
export const useSidePanels = () => useContext(SidePanelsContext);
