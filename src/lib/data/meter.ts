// Supabase egress per query, measured where it happens (audit 2026-11-25 PERF-10): every result row
// Postgres sends is counted by its wire length under the query's shape, in memory only. The server
// log gets a summary every 15 minutes and the day's totals when the UTC day turns; the full health
// report shows today's. Nothing is written to the database, so measuring costs no egress.
//
// A shape is the SQL text with its placeholder lists folded (`in ($1, $2, $3)` → `in ($n)`), so one
// loader is one line however many ids it asks for. Its label is the first table it reads plus a
// short hash; the first time a label is seen the log prints its SQL so the label can be traced.

type Line = { label: string; queries: number; rows: number; bytes: number };
type Window = { since: number; lines: Map<string, Line>; queries: number; bytes: number; connections: number };

const FLUSH_MS = 15 * 60_000;
const TOP = 12;
const SQL_SHOWN = 220;

const fresh = (): Window => ({ since: Date.now(), lines: new Map(), queries: 0, bytes: 0, connections: 0 });
let recent = fresh();
let day = fresh();
let dayName = new Date().toISOString().slice(0, 10);
const labelOf = new Map<string, string>();
const shown = new Set<string>();

export function shapeOf(sql: string): string {
  return sql
    .replace(/\s+/g, " ")
    .replace(/\$\d+(\s*,\s*\$\d+)*/g, "$n")
    .trim();
}

function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36).slice(0, 5);
}

export function labelFor(sql: string): string {
  const known = labelOf.get(sql);
  if (known) return known;
  const shape = shapeOf(sql);
  const verb = /^\s*(insert|update|delete|with)\b/i.exec(shape)?.[1]?.toLowerCase();
  const table = /\bfrom "?([\w.]+)"?/i.exec(shape)?.[1] ?? /\b(?:into|update) "?([\w.]+)"?/i.exec(shape)?.[1] ?? "sql";
  const label = `${verb && verb !== "with" ? `${verb}:` : ""}${table}#${hash(shape)}`;
  if (labelOf.size < 5000) labelOf.set(sql, label);
  if (!shown.has(label) && shown.size < 2000) {
    shown.add(label);
    console.log(`egress db label ${label} = ${shape.slice(0, SQL_SHOWN)}${shape.length > SQL_SHOWN ? "…" : ""}`);
  }
  return label;
}

function add(w: Window, label: string, rows: number, bytes: number) {
  const line = w.lines.get(label) ?? { label, queries: 0, rows: 0, bytes: 0 };
  line.queries++;
  line.rows += rows;
  line.bytes += bytes;
  w.lines.set(label, line);
  w.queries++;
  w.bytes += bytes;
}

const mb = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(2)} MB` : `${(bytes / 1e3).toFixed(1)} KB`);

export function topLines(w: Window = day, n = TOP): Line[] {
  return [...w.lines.values()].sort((a, b) => b.bytes - a.bytes).slice(0, n);
}

function summary(name: string, w: Window, n: number): string {
  const top = topLines(w, n).map((l) => `${l.label} ${mb(l.bytes)} ${l.queries}× ${l.rows} rows`);
  return `egress db ${name}: ${mb(w.bytes)} in ${w.queries} queries, ${w.connections} new connections; top: ${top.join(" · ")}`;
}

function maybeFlush(now: number) {
  const today = new Date(now).toISOString().slice(0, 10);
  if (today !== dayName) {
    if (day.queries) console.log(summary(`day ${dayName}`, day, 25));
    day = fresh();
    dayName = today;
  }
  if (now - recent.since >= FLUSH_MS) {
    if (recent.queries) console.log(summary(`${Math.round((now - recent.since) / 60_000)}m`, recent, TOP));
    recent = fresh();
  }
}

// One finished query: its SQL, the rows that came back and their wire bytes.
export function recordQuery(sql: string, rows: number, bytes: number) {
  const now = Date.now();
  maybeFlush(now);
  const label = labelFor(sql);
  add(recent, label, rows, bytes);
  add(day, label, rows, bytes);
}

export function recordConnection() {
  recent.connections++;
  day.connections++;
}

// For the full health report: today's totals and the biggest lines.
export function meterReport() {
  return {
    day: dayName,
    since: new Date(day.since).toISOString(),
    bytes: day.bytes,
    queries: day.queries,
    connections: day.connections,
    top: topLines(day, 25),
  };
}

// For tests.
export function resetMeter() {
  recent = fresh();
  day = fresh();
  labelOf.clear();
  shown.clear();
}
