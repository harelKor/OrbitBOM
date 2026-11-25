// A server action called from a tap: a thrown error (offline, a dropped connection, a refused
// permission) comes back as `{ error }` instead of crashing the page, so the caller shows "Not
// saved" and its optimistic change drops when the transition ends. The failure keeps the answer's
// shape (its other fields unset), so callers read `r.url` or `r.id` as they would on the action's own.
export async function safeAction<T extends { error?: string }>(run: () => Promise<T>): Promise<T | (Partial<T> & { error: string })> {
  try {
    return await run();
  } catch (err) {
    return { error: notSavedMessage(err) } as Partial<T> & { error: string };
  }
}

export function notSavedMessage(err: unknown): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "Not saved: you're offline.";
  const text = err instanceof Error && err.message && !/fetch|network|load failed|unexpected response|server components|production/i.test(err.message) ? ` ${err.message}` : "";
  return `Not saved.${text || " Check the connection and try again."}`;
}
