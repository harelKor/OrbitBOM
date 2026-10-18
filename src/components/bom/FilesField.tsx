"use client";

import { useRef, useState } from "react";
import { PART_FILE_TYPES } from "@/config/fileTypes";
import { deleteFile, finishUpload, startUpload, type FileOwner } from "@/app/(app)/files-actions";
import { useBom } from "./BomContext";
import { Popover } from "./Popover";
import { ownerPartId, type CardPart } from "./types";

const COLORS: Record<string, string> = {
  drawing: "text-sky-300 border-sky-700",
  gcode: "text-amber-300 border-amber-700",
  image: "text-emerald-300 border-emerald-700",
  flattened: "text-fuchsia-300 border-fuchsia-700",
};

// Upload a file straight to R2 with a presigned URL, then record it.
async function upload(owner: FileOwner, type: string, file: File): Promise<string | null> {
  const start = await startUpload(owner, type, file.name, file.size);
  if ("error" in start) return start.error;
  const res = await fetch(start.url, { method: "PUT", body: file }).catch(() => null);
  if (!res?.ok) return "The upload failed. Check your connection and try again.";
  const done = await finishUpload(owner, type, start.key, file.name, file.type);
  return done.error ?? null;
}

// The FILES cell / card row (ref §2c): Drawing, Gcode, Image and Flattened, one file each.
export const FILE_COLORS = COLORS;

export function FilesField({ part }: { part: CardPart }) {
  const { isAdmin } = useBom();
  const byType = new Map(part.files.map((f) => [f.type, f]));
  const has = (t: string) => byType.has(t) || (t === "drawing" && !!part.drawingUrl);

  return (
    <Popover
      trigger={
        PART_FILE_TYPES.some((t) => has(t.id)) ? (
          <span className="flex gap-1">
            {PART_FILE_TYPES.filter((t) => has(t.id)).map((t) => (
              <span key={t.id} title={t.label} className={`rounded border px-1 text-[10px] ${COLORS[t.id]}`}>
                {t.label[0]}
              </span>
            ))}
          </span>
        ) : (
          <span className="whitespace-nowrap text-slate-500">Add files</span>
        )
      }
    >
      {() => <FileList owner={{ kind: "part", id: ownerPartId(part) }} files={part.files} isAdmin={isAdmin} drawingUrl={part.drawingUrl} />}
    </Popover>
  );
}

// One row per file type: open, upload or replace, download, and (admins) delete.
export function FileList({
  owner,
  files,
  isAdmin,
  drawingUrl = null,
}: {
  owner: FileOwner;
  files: { id: string; type: string; filename: string }[];
  isAdmin: boolean;
  drawingUrl?: string | null;
}) {
  const byType = new Map(files.map((f) => [f.type, f]));
  return (
    <ul className="space-y-1.5 text-xs">
      {PART_FILE_TYPES.map((t) => (
        <FileRow
          key={t.id}
          owner={owner}
          type={t}
          file={byType.get(t.id)}
          isAdmin={isAdmin}
          drawingUrl={t.id === "drawing" ? drawingUrl : null}
        />
      ))}
    </ul>
  );
}

function FileRow({
  owner,
  type,
  file,
  isAdmin,
  drawingUrl,
}: {
  owner: FileOwner;
  type: { id: string; label: string };
  file?: { id: string; filename: string };
  isAdmin: boolean;
  drawingUrl: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(task: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    setError(await task());
    setBusy(false);
  }

  return (
    <li className="rounded-md border border-slate-800 p-1.5">
      <div className="flex items-center gap-2">
        <span className={`w-16 shrink-0 font-medium ${COLORS[type.id].split(" ")[0]}`}>{type.label}</span>
        <span className="min-w-0 flex-1 truncate">
          {file ? (
            <a href={`/api/files/${file.id}`} target="_blank" rel="noreferrer" className="text-slate-200 hover:underline" title={file.filename}>
              {file.filename}
            </a>
          ) : drawingUrl ? (
            <a href={drawingUrl} target="_blank" rel="noreferrer" className="text-slate-200 hover:underline">
              Linked drawing ↗
            </a>
          ) : (
            <span className="text-slate-500">None</span>
          )}
        </span>
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="text-indigo-300 hover:text-indigo-200 disabled:opacity-50">
          {busy ? "…" : file ? "Replace" : "Upload"}
        </button>
        {file && (
          <a href={`/api/files/${file.id}?download=1`} className="text-slate-400 hover:text-slate-100" aria-label={`Download ${type.label}`}>
            ⤓
          </a>
        )}
        {file && isAdmin && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              confirm(`Delete ${file.filename}?`) && run(async () => (await deleteFile(owner.kind, file.id)).error ?? null)
            }
            className="text-rose-400 hover:text-rose-200"
            aria-label={`Delete ${type.label}`}
          >
            ✕
          </button>
        )}
        <input
          ref={input}
          type="file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) run(() => upload(owner, type.id, f));
          }}
        />
      </div>
      {error && <div className="mt-1 text-rose-300">{error}</div>}
    </li>
  );
}
