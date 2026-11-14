"use client";

import { useSyncExternalStore } from "react";

// Phone width (under Tailwind's `sm`): windows open as bottom sheets and dropdowns take the whole
// width. False on the server.
const QUERY = "(max-width: 639.98px)";
const subscribe = (on: () => void) => {
  const mq = matchMedia(QUERY);
  mq.addEventListener("change", on);
  return () => mq.removeEventListener("change", on);
};
export const usePhone = () => useSyncExternalStore(subscribe, () => matchMedia(QUERY).matches, () => false);

// A computer's screen (Tailwind's `lg` and up): Inventory keeps the shop map docked at the top.
const WIDE = "(min-width: 1024px)";
const subscribeWide = (on: () => void) => {
  const mq = matchMedia(WIDE);
  mq.addEventListener("change", on);
  return () => mq.removeEventListener("change", on);
};
export const useDesktop = () => useSyncExternalStore(subscribeWide, () => matchMedia(WIDE).matches, () => false);
