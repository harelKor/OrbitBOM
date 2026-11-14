import "server-only";
import { and, eq, gte, or, sql, sum } from "drizzle-orm";
import { db, schema } from "@/db";
import { decrypt, encrypt } from "@/lib/crypto";
import {
  BACKGROUND_SHARE,
  CALLS_BEFORE_COUNTING,
  COUNTING_STARTED,
  MEMBER_DAILY_CALLS,
  TEAM_DAILY_CALLS,
  YEAR_BACKGROUND_STOP,
  YEARLY_CALLS,
  allowanceYearStart,
} from "@/config/onshapeBudget";

// Onshape API access on a member's own OAuth connection (plan §4). Tokens never leave the
// server. Every call is counted per account and for the whole team (config/onshapeBudget.ts);
// past a budget, calls stop and the app reads from its own data instead.

export const OAUTH_BASE = "https://oauth.onshape.com";
export const DAILY_CALL_BUDGET = MEMBER_DAILY_CALLS;
export const STATE_COOKIE = "onshape_oauth_state";

export class OnshapeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
export class NotConnectedError extends OnshapeError {
  constructor() {
    super("Connect your Onshape account first (Profile → Connect Onshape).");
  }
}
export class BudgetError extends OnshapeError {
  constructor() {
    super(`Your Onshape account reached today's ${DAILY_CALL_BUDGET}-call budget. Try again tomorrow.`);
  }
}

// The team's own limits (config/onshapeBudget.ts), reached before Onshape's: today's calls for the
// whole team, or the year's allowance nearly gone. Not a BudgetError: another member's account
// wouldn't help.
export class TeamBudgetError extends OnshapeError {
  constructor(what: "day" | "year", background: boolean) {
    super(
      what === "year"
        ? background
          ? "The team has used most of this year's Onshape calls, so automatic thumbnails and previews are off. Update BOM still works."
          : "The team has used this year's Onshape calls. Ask an admin before anything else calls Onshape."
        : background
          ? "The team's Onshape calls for today are kept for Update BOM, so new thumbnails and previews wait until tomorrow."
          : "The team reached today's Onshape call limit. Try again tomorrow.",
      429,
    );
  }
}

// Onshape answered 429 (too many requests) even after waiting once: its own rate limit, not
// the team's budget, so a minute later it works again.
export class RateLimitError extends OnshapeError {
  constructor(readonly retryAfterSeconds: number | null) {
    super(`Onshape is getting too many requests right now. Try again in ${retryAfterSeconds && retryAfterSeconds > 60 ? `${Math.ceil(retryAfterSeconds / 60)} minutes` : "a minute"}.`, 429);
  }
}

// Onshape couldn't be reached or didn't answer in time (an outage, a slow network).
export class UnreachableError extends OnshapeError {
  constructor() {
    super("Onshape didn't answer. Try again in a minute; if it keeps happening, check status.onshape.com.", 503);
  }
}

// Onshape answers 402 once the OAuth app's yearly API allowance is used up. A private app's calls
// count against the account or company that owns the app, so every member's calls stop together.
export class QuotaError extends OnshapeError {
  constructor() {
    super(
      "Onshape stopped answering: OrbitParts's Onshape app has used up its yearly API allowance. Files already downloaded once still work; new exports wait until an Onshape admin raises the allowance.",
      402,
    );
  }
}

// The OAuth app's credentials from the server's env, with stray spaces or line breaks from pasting removed.
export const onshapeClientId = () => process.env.ONSHAPE_CLIENT_ID?.trim() ?? "";
const onshapeClientSecret = () => process.env.ONSHAPE_CLIENT_SECRET?.trim() ?? "";

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number };

const TOKEN_MS = 15_000;
const API_MS = 90_000;

// A fetch that turns a network failure or a timeout into UnreachableError.
async function reach(url: string | URL, init: RequestInit, ms: number): Promise<Response> {
  const timeout = AbortSignal.timeout(ms);
  try {
    return await fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  } catch (err) {
    // The caller's own abort stays an abort.
    if (init.signal?.aborted) throw err;
    throw new UnreachableError();
  }
}

// `code` is OAuth's error code from the answer ("invalid_grant": the refresh token is dead).
export class TokenError extends OnshapeError {
  constructor(
    status: number,
    readonly code: string | null,
  ) {
    super(`Onshape token request failed (${status}${code ? ` ${code}` : ""})`, status);
  }
}

export async function requestToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await reach(
    `${OAUTH_BASE}/oauth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...params,
        client_id: onshapeClientId(),
        client_secret: onshapeClientSecret(),
      }),
    },
    TOKEN_MS,
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new TokenError(res.status, typeof body?.error === "string" ? body.error : null);
  }
  return res.json();
}

export async function saveTokens(memberId: string, t: TokenResponse) {
  const values = {
    accessTokenEnc: encrypt(t.access_token),
    refreshTokenEnc: encrypt(t.refresh_token),
    expiresAt: new Date(Date.now() + t.expires_in * 1000),
  };
  await db
    .insert(schema.onshapeTokens)
    .values({ memberId, ...values })
    .onConflictDoUpdate({ target: schema.onshapeTokens.memberId, set: values });
  await db.update(schema.members).set({ onshapeConnected: true }).where(eq(schema.members.id, memberId));
}

export async function disconnect(memberId: string) {
  await db.delete(schema.onshapeTokens).where(eq(schema.onshapeTokens.memberId, memberId));
  await db.update(schema.members).set({ onshapeConnected: false }).where(eq(schema.members.id, memberId));
}

// A token sealed under an older ONSHAPE_TOKEN_KEY can't be opened (the key was replaced when the
// site moved off Vercel, 2026-11-07): the member counts as not connected and connects again.
function openSealed(sealed: string): string | null {
  try {
    return decrypt(sealed);
  } catch {
    return null;
  }
}

const tokenRow = async (memberId: string) => (await db.select().from(schema.onshapeTokens).where(eq(schema.onshapeTokens.memberId, memberId)).limit(1))[0];
const live = (row: { expiresAt: Date }) => row.expiresAt.getTime() - Date.now() > 60_000;

// Refreshes running now, one per member: eight thumbnail workers reaching an expired token at
// once refresh it once and share the new one (a second refresh with the used refresh token was
// refused, which disconnected the member mid-sync). The site is one server process, so this is
// enough, and no row lock or pool connection is held while Onshape answers.
const refreshing = new Map<string, Promise<string>>();

// `rejected`: the access token Onshape just refused (a 401 before its expiry: a new sign-in, a
// revoked grant), so a new one is fetched unless someone already replaced it.
async function accessToken(memberId: string, rejected?: string): Promise<string> {
  const row = await tokenRow(memberId);
  if (!row) throw new NotConnectedError();
  const stored = live(row) ? openSealed(row.accessTokenEnc) : null;
  if (stored && stored !== rejected) return stored;
  let running = refreshing.get(memberId);
  if (!running) {
    running = refreshToken(memberId, row).finally(() => refreshing.delete(memberId));
    refreshing.set(memberId, running);
  }
  return running;
}

async function refreshToken(memberId: string, row: typeof schema.onshapeTokens.$inferSelect): Promise<string> {
  const refresh = openSealed(row.refreshTokenEnc);
  if (!refresh) {
    await disconnect(memberId);
    throw new NotConnectedError();
  }
  let t: TokenResponse;
  try {
    t = await requestToken({ grant_type: "refresh_token", refresh_token: refresh });
  } catch (err) {
    // Only a refresh token Onshape calls dead disconnects the member; an outage, a timeout or
    // another refusal leaves them connected for the next try.
    if (!(err instanceof TokenError) || err.code !== "invalid_grant") throw err instanceof TokenError ? new UnreachableError() : err;
    // Unless it was used by a refresh that already saved a newer token.
    const now = await tokenRow(memberId);
    const theirs = now && now.refreshTokenEnc !== row.refreshTokenEnc && live(now) ? openSealed(now.accessTokenEnc) : null;
    if (theirs) return theirs;
    await disconnect(memberId);
    throw new NotConnectedError();
  }
  const saved = await db
    .update(schema.onshapeTokens)
    .set({ accessTokenEnc: encrypt(t.access_token), refreshTokenEnc: encrypt(t.refresh_token), expiresAt: new Date(Date.now() + t.expires_in * 1000) })
    .where(eq(schema.onshapeTokens.memberId, memberId))
    .returning({ memberId: schema.onshapeTokens.memberId });
  // Disconnected while Onshape answered.
  if (!saved.length) throw new NotConnectedError();
  return t.access_token;
}

// This allowance year's calls (config/onshapeBudget.ts: from the last renewal day), read at
// most once a minute per server.
let yearCache: { at: number; start: string; calls: number } | null = null;
export async function yearCalls(): Promise<number> {
  const start = allowanceYearStart(new Date().toISOString().slice(0, 10));
  if (yearCache && yearCache.start === start && Date.now() - yearCache.at < 60_000) return yearCache.calls;
  const [row] = await db.select({ n: sum(schema.onshapeUsage.calls) }).from(schema.onshapeUsage).where(gte(schema.onshapeUsage.day, start));
  const before = start <= COUNTING_STARTED ? CALLS_BEFORE_COUNTING : 0;
  yearCache = { at: Date.now(), start, calls: before + Number(row?.n ?? 0) };
  return yearCache.calls;
}

// For the Profile page: the team's calls today and this allowance year.
export async function teamUsage() {
  const today = new Date().toISOString().slice(0, 10);
  const [[row], year] = await Promise.all([db.select({ calls: schema.onshapeUsage.calls }).from(schema.onshapeUsage).where(eq(schema.onshapeUsage.day, today)), yearCalls()]);
  return { today: row?.calls ?? 0, year };
}

// The team's count of one more call, refused (nothing counted) past today's cap or the year's.
async function countTeamCall(background: boolean) {
  const year = await yearCalls();
  if (year >= YEARLY_CALLS) throw new TeamBudgetError("year", false);
  if (background && year >= YEARLY_CALLS * YEAR_BACKGROUND_STOP) throw new TeamBudgetError("year", true);
  const cap = background ? Math.floor(TEAM_DAILY_CALLS * BACKGROUND_SHARE) : TEAM_DAILY_CALLS;
  const today = new Date().toISOString().slice(0, 10);
  const { onshapeUsage } = schema;
  const [row] = await db
    .insert(onshapeUsage)
    .values({ day: today, calls: 1, background: background ? 1 : 0 })
    .onConflictDoUpdate({
      target: onshapeUsage.day,
      set: { calls: sql`${onshapeUsage.calls} + 1`, background: sql`${onshapeUsage.background} + ${background ? 1 : 0}` },
      setWhere: sql`${onshapeUsage.calls} < ${cap}`,
    })
    .returning({ calls: onshapeUsage.calls });
  if (!row) throw new TeamBudgetError("day", background);
  if (yearCache) yearCache.calls++;
}

// Counts one call against the member's budget, then the team's; throws when either is spent.
// The member's comes first, so a call their own budget refuses isn't counted for the team, and
// one the team refuses is given back to the member.
async function countCall(memberId: string, background: boolean) {
  const today = new Date().toISOString().slice(0, 10);
  const { onshapeTokens } = schema;
  const [row] = await db
    .update(onshapeTokens)
    .set({
      callsToday: sql`case when ${onshapeTokens.callsDay} = ${today} then ${onshapeTokens.callsToday} + 1 else 1 end`,
      callsDay: today,
    })
    .where(and(eq(onshapeTokens.memberId, memberId), or(sql`${onshapeTokens.callsDay} is distinct from ${today}`, sql`${onshapeTokens.callsToday} < ${DAILY_CALL_BUDGET}`)))
    .returning({ calls: onshapeTokens.callsToday });
  if (!row) throw (await tokenRow(memberId)) ? new BudgetError() : new NotConnectedError();
  try {
    await countTeamCall(background);
  } catch (err) {
    await db
      .update(onshapeTokens)
      .set({ callsToday: sql`greatest(${onshapeTokens.callsToday} - 1, 0)` })
      .where(and(eq(onshapeTokens.memberId, memberId), eq(onshapeTokens.callsDay, today)));
    throw err;
  }
}

// Onshape's Retry-After in seconds (a number or an HTTP date), or null when it gives none.
function retryAfter(res: Response): number | null {
  const h = res.headers.get("retry-after");
  if (!h) return null;
  const n = Number(h);
  if (Number.isFinite(n)) return Math.max(0, n);
  const at = Date.parse(h);
  return Number.isFinite(at) ? Math.max(0, (at - Date.now()) / 1000) : null;
}
const RETRY_WAIT_MS = 10_000;

export type OnshapeClient = {
  json<T = unknown>(path: string, init?: RequestInit): Promise<T>;
  // Binary responses (thumbnails, exports). Takes an API path or an absolute Onshape URL.
  raw(pathOrUrl: string, init?: RequestInit): Promise<Response>;
  calls: number;
  // The same calls by kind of endpoint ("bom", "massproperties", "tessellatedfaces"…), for the
  // log line each flow writes (logCalls), so we see where the yearly allowance goes.
  kinds: Record<string, number>;
};

// What kind of Onshape endpoint a path is: its last word that isn't an id or a wvm letter.
export function callKind(path: string, method = "GET"): string {
  const words = path.replace(/^https:\/\/[^/]+/, "").split("?")[0].split("/").filter((w) => w && !/^[0-9a-f]{24}$/i.test(w) && !/^(api|v\d+|d|w|v|m|e|p|s|partid)$/i.test(w) && !/^\d+x\d+$/.test(w));
  const kind = words.at(-1) ?? "other";
  return method === "GET" ? kind : `${kind} ${method}`;
}

// One line in the server log (journalctl -u orbitparts) per flow: how many calls, by kind.
export function logCalls(flow: string, ...clients: (OnshapeClient | null | undefined)[]) {
  const kinds: Record<string, number> = {};
  let total = 0;
  for (const c of clients) {
    if (!c) continue;
    total += c.calls;
    for (const [k, n] of Object.entries(c.kinds)) kinds[k] = (kinds[k] ?? 0) + n;
  }
  if (!total) return;
  const list = Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(" ");
  console.info(`onshape calls flow=${flow} total=${total} ${list}`);
}

// A client bound to one member and one Onshape host (cad.onshape.com or the Enterprise domain).
// `background`: work nobody is waiting on (thumbnails after a sync, previews re-made when opened),
// which stops first when the team's calls run low.
export function onshapeClient(memberId: string, baseUrl: string, { background = false }: { background?: boolean } = {}): OnshapeClient {
  async function call(pathOrUrl: string, init: RequestInit, accept: string) {
    const url = /^https:\/\//.test(pathOrUrl) ? pathOrUrl : `${baseUrl}/api/v10/${pathOrUrl}`;
    // Never send the member's token anywhere but their Onshape host.
    if (new URL(url).origin !== new URL(baseUrl).origin) throw new OnshapeError("Unexpected Onshape link.");
    const kind = callKind(url, init.method ?? "GET");
    // Each request sent to Onshape is one call: the token comes first, so a missing connection
    // costs nothing, and a retry (after a 401 or a 429) is counted again.
    const send = async (rejected?: string) => {
      const token = await accessToken(memberId, rejected);
      await countCall(memberId, background);
      client.calls++;
      client.kinds[kind] = (client.kinds[kind] ?? 0) + 1;
      const headers = {
        Accept: accept,
        // A file upload (FormData) sets its own multipart type.
        ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
        ...init.headers,
      };
      // Exports and thumbnails answer with a redirect, sometimes to another Onshape host. fetch drops
      // the token when following a redirect to another host, so follow Onshape redirects by hand.
      let res = await reach(url, { ...init, headers, redirect: "manual" }, API_MS);
      for (let hops = 0; hops < 3 && res.status >= 300 && res.status < 400; hops++) {
        const next = new URL(res.headers.get("location") ?? "", url);
        if (next.protocol !== "https:" || !/(^|\.)onshape\.com$/i.test(next.hostname)) {
          throw new OnshapeError("Unexpected Onshape link.");
        }
        res = await reach(next, { headers, redirect: "manual", signal: init.signal }, API_MS);
      }
      return { res, token };
    };
    let { res, token } = await send();
    // Onshape can drop an access token before its expiry (a new sign-in, a revoked grant):
    // refresh it once and try again.
    if (res.status === 401) ({ res, token } = await send(token));
    // Onshape's own rate limit: wait as long as it asks (up to RETRY_WAIT_MS) and try once more.
    if (res.status === 429) {
      const wait = retryAfter(res) ?? 2;
      if (wait * 1000 <= RETRY_WAIT_MS) {
        await new Promise((r) => setTimeout(r, Math.max(wait * 1000, 500)));
        ({ res } = await send());
      }
      if (res.status === 429) throw new RateLimitError(retryAfter(res));
    }
    const name = url.replace(/^https:\/\/[^/]+/, "").split("?")[0];
    // A rejected request is not a lost connection: only a dead refresh token disconnects.
    if (res.status === 401) throw new OnshapeError(`Onshape rejected ${name} (401). Try again, or reconnect Onshape on your profile.`, 401);
    if (res.status === 403 || res.status === 404) {
      throw new OnshapeError("Onshape refused access to this document. Check that your account can open it.", res.status);
    }
    if (res.status === 402) throw new QuotaError();
    if (res.status === 502 || res.status === 503 || res.status === 504) throw new UnreachableError();
    if (!res.ok) throw new OnshapeError(`Onshape returned ${res.status} for ${name}`, res.status);
    return res;
  }

  const client: OnshapeClient = {
    calls: 0,
    kinds: {},
    async json<T>(path: string, init: RequestInit = {}): Promise<T> {
      return (await call(path, init, "application/json")).json() as Promise<T>;
    },
    raw: (pathOrUrl, init = {}) => call(pathOrUrl, init, "*/*"),
  };
  return client;
}
