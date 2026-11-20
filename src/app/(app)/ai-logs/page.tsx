import { machineName } from "@/config/machines";
import { requireMember } from "@/lib/auth";
import { listAiLogs, type AiLog, type AiLogChange, type AiLogItemChange } from "@/lib/review/review";
import { RevertLogButton } from "./RevertLogButton";

const FIELDS: Record<string, string> = {
  classification: "Type",
  material: "Material",
  preProcess: "Pre-process",
  process1: "Process 1",
  process2: "Process 2",
  addedProcesses: "Processes after 1",
  designState: "Status",
  quantity: "Quantity",
  priority: "Priority",
  deadline: "Deadline",
  designerName: "Designer",
  note: "Notes",
  description: "Description",
};

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem", hour12: false }).format(new Date(iso));

const tool = (name: string) => {
  const words = name.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function value(field: string, v: unknown): string {
  if (v == null || v === "") return "none";
  if (["preProcess", "process1", "process2"].includes(field)) return machineName(String(v));
  if (field === "addedProcesses" && Array.isArray(v)) return v.map((p: { machine?: string }) => machineName(String(p.machine))).join(" → ") || "None";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// Changes of one part, in the order they were made.
function byPart(changes: AiLogChange[]) {
  const parts = new Map<string, { part: string; where: string; fields: AiLogChange[] }>();
  for (const c of changes) {
    const p = parts.get(c.partId) ?? { part: c.part, where: `${c.robot} › ${c.system}`, fields: [] };
    p.fields.push(c);
    parts.set(c.partId, p);
  }
  return [...parts.values()];
}

// Inventory changes of one item, in the order they were made.
function byItem(changes: AiLogItemChange[]) {
  const items = new Map<string, { item: string; category: string; fields: AiLogItemChange[] }>();
  for (const c of changes) {
    const i = items.get(c.itemId) ?? { item: c.item, category: c.category, fields: [] };
    i.fields.push(c);
    items.set(c.itemId, i);
  }
  return [...items.values()];
}

// AI logs: everything a member's Claude changed through the MCP server and every Suggest setup
// run, newest first, with what each one changed.
export default async function AiLogsPage() {
  await requireMember();
  const logs = await listAiLogs();

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="display text-3xl text-accent">AI logs</h1>
        <p className="mt-1 text-sm text-muted">Recent actions by a member&rsquo;s Claude or by Suggest setup. Revert change puts back everything one run changed, in parts and inventory.</p>
      </div>
      {logs.length ? (
        <ul className="space-y-2">
          {logs.map((log) => (
            <LogRow key={log.id} log={log} />
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-muted">
          Nothing yet. Changes made by Claude or by Suggest setup will be listed here.
        </div>
      )}
    </div>
  );
}

function LogRow({ log }: { log: AiLog }) {
  const parts = byPart(log.changes);
  const items = byItem(log.itemChanges);
  const more = log.changeCount - log.changes.length + log.itemChangeCount - log.itemChanges.length;
  const itemCount = new Set(log.itemChanges.map((c) => c.itemId)).size;
  return (
    <li className="panel">
      <details className="group">
        <summary className="press flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 p-3">
          <span className={`rounded-full px-2 py-0.5 text-[0.625rem] font-bold tracking-wide ${log.source === "ai" ? "bg-accent text-white" : "border border-line-strong bg-raised text-fg-2"}`}>
            {log.source === "ai" ? (log.aiName ?? "AI") : "RULE"}
          </span>
          <span className="font-semibold text-fg">{tool(log.tool)}</span>
          <span dir="auto" className="min-w-0 flex-1 truncate text-sm text-muted" title={log.summary}>
            {log.summary}
          </span>
          {log.itemChangeCount > 0 && (
            <span className="rounded-full bg-raised px-2 py-0.5 text-[0.6875rem] font-semibold text-fg-2 tabular-nums">
              <span className="font-mono">{log.itemChangeCount}</span> inventory {log.itemChangeCount === 1 ? "change" : "changes"}
              {itemCount > 1 ? ` on ${itemCount} items` : ""}
            </span>
          )}
          {log.waiting > 0 && <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[0.6875rem] font-semibold text-gold tabular-nums">{log.waiting} in AI review</span>}
          <span className="text-xs text-subtle tabular-nums">
            {log.memberName ? `${log.memberName}, ` : ""}
            {when(log.at)}
          </span>
          {log.revertedAt ? (
            <span className="rounded-full border border-line-strong px-2 py-0.5 text-[0.6875rem] font-semibold text-subtle">Reverted</span>
          ) : (
            log.batchId && <RevertLogButton batchId={log.batchId} what={`${tool(log.tool)} (${log.summary})`} />
          )}
        </summary>
        {(parts.length > 0 || items.length > 0) && (
          <div className="space-y-2 border-t border-line p-3 text-sm">
            {parts.map((p) => (
              <div key={p.part + p.where}>
                <div className="flex min-w-0 items-baseline gap-2">
                  <span dir="auto" className="truncate font-medium text-fg">{p.part}</span>
                  <span className="shrink-0 text-xs text-subtle">{p.where}</span>
                </div>
                <ul className="mt-0.5 space-y-0.5 text-xs text-fg-2">
                  {p.fields.map((c, i) => (
                    <li key={i}>
                      <span className="text-muted">{FIELDS[c.field] ?? c.field}:</span> <span className="text-faint line-through">{value(c.field, c.from)}</span>
                      {" → "}
                      <span className="font-medium">{value(c.field, c.to)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {items.map((i, n) => (
              <div key={n}>
                <div className="flex min-w-0 items-baseline gap-2">
                  <span dir="auto" className="truncate font-medium text-fg">{i.item}</span>
                  <span className="shrink-0 text-xs text-subtle">Inventory › {i.category}</span>
                </div>
                <ul className="mt-0.5 space-y-0.5 text-xs text-fg-2">
                  {i.fields.map((c, k) => (
                    <li key={k}>
                      <span className="text-muted">{c.label}:</span> {c.from != null && <span className="text-faint line-through">{c.from}</span>}
                      {c.from != null && " → "}
                      <span className="font-medium tabular-nums">{c.to ?? "none"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {more > 0 && <div className="text-xs text-subtle">and {more} more changes</div>}
          </div>
        )}
      </details>
    </li>
  );
}
