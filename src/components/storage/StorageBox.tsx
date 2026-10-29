"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { backUpNow, deletePreviews, downloadLatestBackup, loadStorage, recountAndClean } from "@/app/(app)/storage-actions";
import { Dialog } from "@/components/Dialog";
import { useManage } from "@/components/shell/ModeContext";
import { Icon } from "@/components/ui/Icon";
import { BACKUP_DAYS, DATABASE_LIMIT, STORAGE_CLEAN_UP, STORAGE_CLEAN_UP_TO, STORAGE_LIMIT, STORAGE_WARN } from "@/config/storage";
import type { StorageUsage } from "@/lib/storage/usage";

const GB = 1024 ** 3;
const size = (n: number) => (n >= GB ? `${(n / GB).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const KINDS: [keyof StorageUsage["byKind"], string][] = [
  ["studio", "3D model studios"],
  ["part", "Part 3D files"],
  ["preview", "Version previews"],
  ["thumb", "Thumbnails"],
  ["file", "Part files (G-code, DXF…)"],
  ["image", "Inventory photos"],
  ["backup", "Backups"],
  ["other", "Other"],
];

// The storage warning box (plan/system-versioning.md §5): shown on the dashboard above 6 GB of
// R2's 10 GB (or with ?storage=1). Its window shows what takes the space, each version's 3D
// previews with Delete, and the auto clean-up line.
export function StorageBox({ total }: { total: number }) {
  const params = useSearchParams();
  const asked = params.get("storage") === "1";
  const [open, setOpen] = useState(asked);
  if (total < STORAGE_WARN && !asked) return null;
  const warn = total >= STORAGE_WARN;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`card-interactive flex w-full items-center gap-4 px-5 py-3 text-left ${warn ? "border-amber-500/50 bg-amber-500/5" : ""}`}
      >
        <Icon name="box" className={`h-6 w-6 ${warn ? "text-amber-500" : "text-subtle"}`} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">
            File storage <span className="font-mono tabular-nums">{size(total)}</span> <span className="text-subtle">/ {size(STORAGE_LIMIT)}</span>
          </span>
          <span className="block text-xs text-subtle">
            {total >= STORAGE_CLEAN_UP
              ? "Old 3D previews are being cleaned up automatically."
              : warn
                ? "Getting full. Open to see what takes the space."
                : "Below the warning line."}
          </span>
        </span>
        <Bar used={total} className="hidden w-48 sm:block" />
      </button>
      {open && <StorageWindow onClose={() => setOpen(false)} />}
    </>
  );
}

function Bar({ used, className = "" }: { used: number; className?: string }) {
  const pct = (n: number) => `${Math.min(100, (n / STORAGE_LIMIT) * 100)}%`;
  return (
    <span className={`relative block h-2 overflow-hidden rounded-full bg-raised ${className}`}>
      <span
        className={`absolute inset-y-0 left-0 rounded-full ${used >= STORAGE_CLEAN_UP ? "bg-rose-500" : used >= STORAGE_WARN ? "bg-amber-500" : "bg-sky-500"}`}
        style={{ width: pct(used) }}
      />
      <span className="absolute inset-y-0 w-px bg-amber-500" style={{ left: pct(STORAGE_WARN) }} />
      <span className="absolute inset-y-0 w-px bg-rose-500" style={{ left: pct(STORAGE_CLEAN_UP) }} />
    </span>
  );
}

function StorageWindow({ onClose }: { onClose: () => void }) {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const edit = useManage();
  const router = useRouter();
  useEffect(() => {
    void loadStorage().then(setUsage);
  }, []);

  const run = (fn: () => Promise<{ message?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setMessage(r.error ? { text: r.error, error: true } : { text: r.message ?? "Done." });
      setUsage(await loadStorage());
      router.refresh();
    });

  return (
    <Dialog open onClose={onClose} title="File storage" width="w-[min(44rem,calc(100vw-2rem))]">
      {!usage ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">
                Cloudflare R2 <span className="font-mono tabular-nums">{size(usage.total)}</span> <span className="text-subtle">/ {size(STORAGE_LIMIT)}</span>
              </span>
              <span className="text-xs text-subtle tabular-nums">
                Database {size(usage.database)} / {size(DATABASE_LIMIT)}
              </span>
            </div>
            <Bar used={usage.total} />
            <p className="text-xs text-subtle">
              Warning at {size(STORAGE_WARN)}. Above {size(STORAGE_CLEAN_UP)}, the nightly clean-up frees space down to {size(STORAGE_CLEAN_UP_TO)}: unused 3D files first,
              then the oldest version previews. It never touches a system&apos;s 3 newest versions, versions parts are on, or named versions. Revert never needs these files;
              a deleted preview is made again from Onshape when opened.
            </p>
          </div>

          <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {KINDS.filter(([k]) => usage.byKind[k]).map(([k, label]) => (
              <li key={k} className="flex justify-between gap-2">
                <span className="text-muted">{label}</span>
                <span className="font-mono tabular-nums">{size(usage.byKind[k] ?? 0)}</span>
              </li>
            ))}
          </ul>

          <div className="panel flex flex-wrap items-center gap-3 px-3 py-2.5">
            <Icon name="download" className="h-5 w-5 text-accent" />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Backups</span>
              <span className="block text-xs text-subtle">
                {usage.backups.latest ? (
                  <>
                    Latest {new Date(usage.backups.latest.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                    <span className="font-mono tabular-nums">{size(usage.backups.latest.bytes)}</span> ·{" "}
                    <span className="font-mono tabular-nums">{usage.backups.count}</span> kept
                  </>
                ) : (
                  "No backup yet."
                )}{" "}
                The whole BOM and inventory as JSON, saved every night; the last {BACKUP_DAYS} days are kept.
              </span>
            </span>
            <button
              type="button"
              className="btn h-9 active:scale-[0.98]"
              disabled={pending || !usage.backups.latest}
              onClick={() =>
                start(async () => {
                  const r = await downloadLatestBackup();
                  if (r.url) window.location.assign(r.url);
                  else setMessage({ text: r.error ?? "No backup yet.", error: true });
                })
              }
            >
              Download latest backup
            </button>
            {edit && (
              <button type="button" className="btn h-9 active:scale-[0.98]" disabled={pending} onClick={() => run(backUpNow)}>
                Back up now
              </button>
            )}
          </div>

          <div className="space-y-2">
            <p className="label">Version previews by system</p>
            {usage.systems.length === 0 && <p className="text-muted">No committed versions yet.</p>}
            {usage.systems.map((s) => (
              <details key={s.id} className="panel">
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {s.name} <span className="font-normal text-subtle">· {s.robotName}</span>
                  </span>
                  <span className="font-mono text-xs tabular-nums">{size(s.bytes)}</span>
                </summary>
                <ul className="divide-y divide-line border-t border-line">
                  {s.versions.map((v) => (
                    <li key={v.id} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="rounded-md bg-accent/10 px-1.5 font-mono text-xs font-bold text-accent">{v.label}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted">
                        {v.name && v.name !== v.label ? `${v.name} · ` : ""}
                        {v.at ? new Date(v.at).toLocaleDateString(undefined, { dateStyle: "medium" }) : ""}
                        {v.protected && " · kept"}
                      </span>
                      <span className="font-mono text-xs tabular-nums">{size(v.bytes)}</span>
                      {edit && (
                        <button type="button" className="btn h-7 px-2 text-xs" disabled={pending || v.files === 0} onClick={() => run(() => deletePreviews(v.id))}>
                          Delete previews
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            {usage.unassigned > 0 && (
              <p className="text-xs text-subtle">
                Previews of changes never committed: <span className="font-mono tabular-nums">{size(usage.unassigned)}</span> (cleaned up first).
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            {edit && (
              <button type="button" className="btn" disabled={pending} onClick={() => run(recountAndClean)}>
                {pending ? "Working…" : "Recount now"}
              </button>
            )}
            {message && <span className={message.error ? "text-rose-600" : "text-emerald-600"}>{message.text}</span>}
          </div>
        </div>
      )}
    </Dialog>
  );
}
