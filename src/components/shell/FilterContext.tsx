"use client";

import { createContext, useContext, useEffect, useState } from "react";

// The top bar's search and filter pills. They live in the app shell, so they stay set while
// moving between pages, and in sessionStorage, so a reload keeps them.
export type DateFilter = "" | "today" | "week" | "month";
export type Filters = { q: string; material: string; process: string; date: DateFilter };

const EMPTY: Filters = { q: "", material: "", process: "", date: "" };
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore after hydration
      if (saved) setState({ ...EMPTY, ...JSON.parse(saved) });
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

const DAY = 86_400_000;
export const DATE_OPTIONS: { value: DateFilter; label: string; days: number }[] = [
  { value: "today", label: "Today", days: 1 },
  { value: "week", label: "This week", days: 7 },
  { value: "month", label: "This month", days: 30 },
];

// Date filters on when the part was last changed.
export function matchesDate(lastModifiedAt: Date, date: DateFilter, now = Date.now()) {
  const opt = DATE_OPTIONS.find((o) => o.value === date);
  return !opt || now - lastModifiedAt.getTime() < opt.days * DAY;
}
