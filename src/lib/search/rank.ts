const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// How well a name matches a typed query, lower is better (Harel, 2026-11-01): 1 exact, 2 the query
// as a whole word, 3 the name starts with it, 4 a word starts with it, 5 anywhere else, 0 no match.
// So "pla" finds "PLA" before "Aluminum plate".
export function matchTier(name: string, query: string): number {
  const q = query.trim().toLowerCase();
  const n = name.toLowerCase();
  if (!q) return 5;
  if (n === q) return 1;
  if (!n.includes(q)) return 0;
  const e = escape(q);
  // Word edges are any non-letter/digit, so "3mm PLA-CF" and "(25*25)" still split into words.
  if (new RegExp(`(^|[^a-z0-9])${e}($|[^a-z0-9])`).test(n)) return 2;
  if (n.startsWith(q)) return 3;
  if (new RegExp(`(^|[^a-z0-9])${e}`).test(n)) return 4;
  return 5;
}

// Orders grouped options by match: groups by their best match (ties keep their order), and options
// inside a group by their own, so group headers stay together. `fallback` is the tier for an option
// that matched some other way (its group name).
export function rankGrouped<T>(items: T[], query: string, label: (t: T) => string, group: (t: T) => string | undefined, fallback = 6): T[] {
  const tier = items.map((t) => matchTier(label(t), query) || fallback);
  const best = new Map<string | undefined, number>();
  items.forEach((t, i) => best.set(group(t), Math.min(best.get(group(t)) ?? Infinity, tier[i])));
  const firstAt = new Map<string | undefined, number>();
  items.forEach((t, i) => firstAt.has(group(t)) || firstAt.set(group(t), i));
  return items
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const ga = group(a.t), gb = group(b.t);
      return best.get(ga)! - best.get(gb)! || firstAt.get(ga)! - firstAt.get(gb)! || tier[a.i] - tier[b.i] || a.i - b.i;
    })
    .map((x) => x.t);
}
