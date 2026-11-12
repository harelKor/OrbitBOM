"use client";

import { Children, isValidElement, useState } from "react";
import { Icon } from "@/components/ui/Icon";

// The Members page's team list with a search bar over it: rows (each an <li> with a `data-search`
// of its name, email, team and system) are kept or hidden as the member types (Harel, 2026-11-12).
export function MemberSearch({ total, children }: { total: number; children: React.ReactNode }) {
  const [q, setQ] = useState("");
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = Children.toArray(children).filter((row) => {
    if (!words.length || !isValidElement<{ "data-search"?: string }>(row)) return true;
    const text = row.props["data-search"] ?? "";
    return words.every((w) => text.includes(w));
  });

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="font-medium">
          Team ({words.length ? `${rows.length} of ${total}` : total})
        </h2>
        <label className="ml-auto flex min-h-10 w-full items-center gap-2 rounded-lg border border-line-strong bg-raised px-3 focus-within:border-sky-400 sm:w-72">
          <Icon name="search" className="h-4 w-4 shrink-0 text-subtle" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQ("")}
            placeholder="Search members"
            aria-label="Search members"
            className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-subtle"
          />
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="panel px-4 py-3 text-sm text-subtle">No members match &ldquo;{q.trim()}&rdquo;.</p>
      ) : (
        <ul className="panel divide-y divide-line">{rows}</ul>
      )}
    </section>
  );
}
