"use client";

import { createContext, useContext, useEffect, useState } from "react";

// The top bar's part search and the BOM's Material and Process pills. They live in the app shell,
// so they stay set while moving between pages, and in sessionStorage, so a reload keeps them.
export type Filters = { q: string; material: string; process: string };

const EMPTY: Filters = { q: "", material: "", process: "" };
const KEY = "orbit-filters";

const FilterContext = createContext<{ filters: Filters; setFilters: (f: Partial<Filters>) => void }>({
  filters: EMPTY,
  setFilters: () => {},
});

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const [filters, setState] = useState<Filters>(EMPTY);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(KEY);
      if (saved) {
        const { q, material, process } = { ...EMPTY, ...JSON.parse(saved) };
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restore after hydration
        setState({ q, material, process });
      }
    } catch {}
  }, []);
  const setFilters = (f: Partial<Filters>) =>
    setState((prev) => {
      const next = { ...prev, ...f };
      try {
        sessionStorage.setItem(KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  return <FilterContext.Provider value={{ filters, setFilters }}>{children}</FilterContext.Provider>;
}

export const useFilters = () => useContext(FilterContext);

