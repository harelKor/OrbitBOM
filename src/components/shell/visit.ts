// A page visit: its id and the page's path, kept in a cookie so the server actions it makes
// can record them with their changes (see VisitTracker and lib/visits).
export const VISIT_COOKIE = "orbit-visit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeVisit(id: string, page: string) {
  return `${id}|${encodeURIComponent(page)}`;
}

export function decodeVisit(value: string | undefined): { id: string; page: string } | null {
  if (!value) return null;
  const [id, raw] = value.split("|");
  try {
    const page = decodeURIComponent(raw ?? "");
    if (!UUID.test(id) || !page.startsWith("/") || page.startsWith("//") || page.length > 500) return null;
    return { id, page };
  } catch {
    return null;
  }
}
