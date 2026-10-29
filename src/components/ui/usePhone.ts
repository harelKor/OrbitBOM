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
