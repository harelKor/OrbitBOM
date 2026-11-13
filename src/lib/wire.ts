// JSON that keeps what a server action's reply keeps: Dates, Maps and Sets come back as
// themselves, so a read moved from a server action to a GET route returns the same values.
const DATE = "\u0000date";
const MAP = "\u0000map";
const SET = "\u0000set";

function encode(value: unknown): unknown {
  if (value instanceof Date) return { [DATE]: value.toISOString() };
  if (value instanceof Map) return { [MAP]: [...value].map(([k, v]) => [encode(k), encode(v)]) };
  if (value instanceof Set) return { [SET]: [...value].map(encode) };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = encode(v);
    return out;
  }
  return value;
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (DATE in o) return new Date(o[DATE] as string);
    if (MAP in o) return new Map((o[MAP] as [unknown, unknown][]).map(([k, v]) => [decode(k), decode(v)]));
    if (SET in o) return new Set((o[SET] as unknown[]).map(decode));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = decode(v);
    return out;
  }
  return value;
}

export const toWire = (value: unknown) => JSON.stringify(encode(value) ?? null);
export const fromWire = <T>(text: string) => decode(JSON.parse(text)) as T;
