"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { backUpNow, downloadBackup, restoreFromBackup } from "@/app/(app)/storage-actions";
import { Dialog } from "@/components/Dialog";
import { LocalTime } from "@/components/ui/LocalTime";
import { BACKUP_DAYS } from "@/config/storage";
import type { BackupFile } from "@/lib/storage/backup";
import { Notice } from "@/components/ui/Notice";
import { safeAction } from "@/lib/safeAction";

export type ScopeInfo = { id: string; label: string; text: string };

const size = (n: number) => (n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
// "before-restore" copies are the ones a restore saved first.
const isSafetyCopy = (b: BackupFile) => b.name.includes("-before-restore-");

// Settings → Backups: the nightly copies in R2, a download for each, Back up now, and (admins)
// Restore, which puts the inventory, the BOM or both back the way a copy has them.
export function BackupsSettings({ backups, scopes, isAdmin }: { backups: BackupFile[]; scopes: ScopeInfo[]; isAdmin: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ message?: string; error?: string }>({});
  const [restoring, setRestoring] = useState<BackupFile | null>(null);
  const run = (fn: () => Promise<{ message?: string; error?: string }>, then?: () => void) =>
    start(async () => {
      const r = await safeAction(() => fn());
      setResult(r);
      if (!r.error) {
        then?.();
        router.refresh();
      }
    });

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted">
        Every night the whole BOM and inventory is saved to file storage; the last {BACKUP_DAYS} days are kept. Download one to keep your own copy, or
        restore one to put things back the way they were that night.
      </p>
      {result.error && <Notice tone="error">{result.error}</Notice>}
      {result.message && (
        <Notice tone="success">{result.message}</Notice>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn min-h-11 active:scale-[0.98]" disabled={pending} onClick={() => run(backUpNow)}>
          Back up now
        </button>
        <span className="text-xs text-subtle">
          <span className="font-mono tabular-nums">{backups.length}</span> {backups.length === 1 ? "backup" : "backups"} kept
        </span>
      </div>

      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {backups.map((b) => (
          <li key={b.key} className="flex flex-wrap items-center gap-2 px-3 py-2.5 transition-colors duration-150 hover:bg-raised">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                <LocalTime at={b.at} style="full" />
                {isSafetyCopy(b) && <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[0.6875rem] font-semibold text-amber-600 dark:text-amber-300">Before a restore</span>}
              </span>
              <span className="block truncate font-mono text-xs text-subtle tabular-nums">
                {b.name} · {size(b.bytes)}
              </span>
            </span>
            <button
              type="button"
              className="btn h-9 active:scale-[0.98]"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await safeAction(() => downloadBackup(b.key));
                  if (r.url) window.location.assign(r.url);
                  else setResult({ error: r.error });
                })
              }
            >
              Download
            </button>
            {isAdmin && (
              <button type="button" className="btn h-9 active:scale-[0.98]" disabled={pending} onClick={() => setRestoring(b)}>
                Restore…
              </button>
            )}
          </li>
        ))}
        {!backups.length && <li className="px-3 py-3 text-sm text-muted">No backup yet. The first one is saved tonight, or press Back up now.</li>}
      </ul>
      {!isAdmin && <p className="text-xs text-subtle">Only admins can restore a backup.</p>}

      {restoring && (
        <RestoreDialog
          backup={restoring}
          scopes={scopes}
          pending={pending}
          onClose={() => setRestoring(null)}
          onRestore={(chosen, removeAdded) => run(() => restoreFromBackup(restoring.key, chosen, removeAdded), () => setRestoring(null))}
        />
      )}
    </div>
  );
}

function RestoreDialog({
  backup,
  scopes,
  pending,
  onClose,
  onRestore,
}: {
  backup: BackupFile;
  scopes: ScopeInfo[];
  pending: boolean;
  onClose: () => void;
  onRestore: (scopes: string[], removeAdded: boolean) => void;
}) {
  const [chosen, setChosen] = useState<string[]>([scopes[0].id]);
  const [removeAdded, setRemoveAdded] = useState(false);
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  return (
    <Dialog open onClose={onClose} title="Restore from backup" width="w-[min(34rem,calc(100vw-2rem))]">
      <div className="space-y-4 text-sm">
        <p>
          Put things back the way they were on <span className="font-semibold"><LocalTime at={backup.at} style="full" /></span>.
        </p>
        <div className="space-y-2">
          {scopes.map((s) => (
            <label key={s.id} className="panel flex cursor-pointer items-start gap-3 p-3 transition-colors duration-150 hover:border-sky-400/40">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-sky-500" checked={chosen.includes(s.id)} onChange={() => toggle(s.id)} />
              <span>
                <span className="block font-semibold">{s.label}</span>
                <span className="block text-xs text-muted">{s.text}</span>
              </span>
            </label>
          ))}
        </div>
        <label className="flex cursor-pointer items-start gap-3 px-1">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-rose-500" checked={removeAdded} onChange={(e) => setRemoveAdded(e.target.checked)} />
          <span>
            <span className="block font-semibold">Also remove what was added since</span>
            <span className="block text-xs text-muted">Robots, systems, parts and items created after the backup are deleted, with their history and versions.</span>
          </span>
        </label>
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          Everything changed since then in what you pick goes back{removeAdded ? ", and anything added since is removed" : "; anything added since stays"}. A copy of
          how things are now is saved first, so you can restore that copy to undo this.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn min-h-11 active:scale-[0.98]" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn min-h-11 border-rose-500/60 bg-rose-500/10 font-semibold text-rose-600 active:scale-[0.98] dark:text-rose-300"
            disabled={pending || !chosen.length}
            onClick={() => onRestore(chosen, removeAdded)}
          >
            {pending ? "Restoring…" : "Restore"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
