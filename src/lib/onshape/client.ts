import "server-only";
import { eq, gte, sql, sum } from "drizzle-orm";
import { db, schema } from "@/db";
import { decrypt, encrypt } from "@/lib/crypto";
import {
  BACKGROUND_SHARE,
  CALLS_BEFORE_COUNTING,
  MEMBER_DAILY_CALLS,
  TEAM_DAILY_CALLS,
  YEAR_BACKGROUND_STOP,
  YEAR_STARTS,
  YEARLY_CALLS,
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

// Onshape answers 402 once the OAuth app's yearly API allowance is used up. A private app's calls
// count against the account or company that owns the app, so every member's calls stop together.
export class QuotaError extends OnshapeError {
  constructor() {
    super(
      "Onshape stopped answering: OrbitBOM's Onshape app has used up its yearly API allowance. Files already downloaded once still work; new exports wait until an Onshape admin raises the allowance.",
      402,
    );
  }
}

// The OAuth app's credentials from Vercel, with stray spaces or line breaks from pasting removed.
export const onshapeClientId = () => process.env.ONSHAPE_CLIENT_ID?.trim() ?? "";
const onshapeClientSecret = () => process.env.ONSHAPE_CLIENT_SECRET?.trim() ?? "";

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number };

export async function requestToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${OAUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...params,
      client_id: onshapeClientId(),
      client_secret: onshapeClientSecret(),
    }),
  });
  if (!res.ok) throw new OnshapeError(`Onshape token request failed (${res.status})`, res.status);
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

// `fresh` skips the stored access token (Onshape rejected it before it expired). A refresh holds
// the member's token row: eight thumbnail workers reaching an expired token at once refresh it
// once, and the others take the new one (a second refresh with the used refresh token was
// refused, which disconnected the member mid-sync).
// A token sealed under an older ONSHAPE_TOKEN_KEY can't be opened (the key was replaced when the
// site moved off Vercel, 2026-11-07): the member counts as not connected and connects again.
function openSealed(sealed: string): string | null {
  try {
    return decrypt(sealed);
  } catch {
    return null;
  }
}

async function accessToken(memberId: string, fresh = false): Promise<string> {
  const [row] = await db
    .select()
    .from(schema.onshapeTokens)
    .where(eq(schema.onshapeTokens.memberId, memberId))
    .limit(1);
  if (!row) throw new NotConnectedError();
  const cached = !fresh && row.expiresAt.getTime() - Date.now() > 60_000 ? openSealed(row.accessTokenEnc) : null;
  if (cached) return cached;
  const result = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(schema.onshapeTokens).where(eq(schema.onshapeTokens.memberId, memberId)).for("update");
    if (!locked) return { gone: true as const, token: undefined };
    // Someone refreshed it while this one waited.
    const theirs = locked.accessTokenEnc !== row.accessTokenEnc && locked.expiresAt.getTime() - Date.now() > 60_000 ? openSealed(locked.accessTokenEnc) : null;
    if (theirs) return { token: theirs };
    const refreshToken = openSealed(locked.refreshTokenEnc);
    if (!refreshToken) return { gone: true as const, token: undefined };
    try {
      const t = await requestToken({ grant_type: "refresh_token", refresh_token: refreshToken });
      await tx
        .update(schema.onshapeTokens)
        .set({ accessTokenEnc: encrypt(t.access_token), refreshTokenEnc: encrypt(t.refresh_token), expiresAt: new Date(Date.now() + t.expires_in * 1000) })
        .where(eq(schema.onshapeTokens.memberId, memberId));
      return { token: t.access_token };
    } catch (err) {
      if (err instanceof OnshapeError && err.status && err.status < 500) return { gone: true as const, token: undefined };
      throw err;
    }
  });
  if (result.token !== undefined) return result.token;
  await disconnect(memberId);
  throw new NotConnectedError();
}

// This allowance year's calls (config/onshapeBudget.ts), read at most once a minute per server.
let yearCache: { at: number; calls: number } | null = null;
export async function yearCalls(): Promise<number> {
  if (yearCache && Date.now() - yearCache.at < 60_000) return yearCache.calls;
  const [row] = await db.select({ n: sum(schema.onshapeUsage.calls) }).from(schema.onshapeUsage).where(gte(schema.onshapeUsage.day, YEAR_STARTS));
  yearCache = { at: Date.now(), calls: CALLS_BEFORE_COUNTING + Number(row?.n ?? 0) };
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

// Counts one call against the team's and the member's budgets; throws when either is spent.
async function countCall(memberId: string, background: boolean) {
  await countTeamCall(background);
  const today = new Date().toISOString().slice(0, 10);
  const [row] = await db
    .update(schema.onshapeTokens)
    .set({
      callsToday: sql`case when ${schema.onshapeTokens.callsDay} = ${today} then ${schema.onshapeTokens.callsToday} + 1 else 1 end`,
      callsDay: today,
    })
    .where(eq(schema.onshapeTokens.memberId, memberId))
    .returning({ calls: schema.onshapeTokens.callsToday });
  if (!row) throw new NotConnectedError();
  if (row.calls > DAILY_CALL_BUDGET) throw new BudgetError();
}

export type OnshapeClient = {
  json<T = unknown>(path: string, init?: RequestInit): Promise<T>;
  // Binary responses (thumbnails, exports). Takes an API path or an absolute Onshape URL.
  raw(pathOrUrl: string, init?: RequestInit): Promise<Response>;
  calls: number;
};

// A client bound to one member and one Onshape host (cad.onshape.com or the Enterprise domain).
// `background`: work nobody is waiting on (thumbnails after a sync, previews re-made when opened),
// which stops first when the team's calls run low.
export function onshapeClient(memberId: string, baseUrl: string, { background = false }: { background?: boolean } = {}): OnshapeClient {
  async function call(pathOrUrl: string, init: RequestInit, accept: string) {
    const url = /^https:\/\//.test(pathOrUrl) ? pathOrUrl : `${baseUrl}/api/v10/${pathOrUrl}`;
    // Never send the member's token anywhere but their Onshape host.
    if (new URL(url).origin !== new URL(baseUrl).origin) throw new OnshapeError("Unexpected Onshape link.");
    await countCall(memberId, background);
    client.calls++;
    const send = async (fresh: boolean) => {
      const headers = {
        Accept: accept,
        // A file upload (FormData) sets its own multipart type.
        ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${await accessToken(memberId, fresh)}`,
        ...init.headers,
      };
      // Exports and thumbnails answer with a redirect, sometimes to another Onshape host. fetch drops
      // the token when following a redirect to another host, so follow Onshape redirects by hand.
      let res = await fetch(url, { ...init, headers, redirect: "manual" });
      for (let hops = 0; hops < 3 && res.status >= 300 && res.status < 400; hops++) {
        const next = new URL(res.headers.get("location") ?? "", url);
        if (next.protocol !== "https:" || !/(^|\.)onshape\.com$/i.test(next.hostname)) {
          throw new OnshapeError("Unexpected Onshape link.");
        }
        res = await fetch(next, { headers, redirect: "manual" });
      }
      return res;
    };
    let res = await send(false);
    // Onshape can drop an access token before its expiry (a new sign-in, a revoked grant):
    // refresh it once and try again.
    if (res.status === 401) res = await send(true);
    const name = url.replace(/^https:\/\/[^/]+/, "").split("?")[0];
    // A rejected request is not a lost connection: only a failed token refresh disconnects.
    if (res.status === 401) throw new OnshapeError(`Onshape rejected ${name} (401). Try again, or reconnect Onshape on your profile.`, 401);
    if (res.status === 403 || res.status === 404) {
      throw new OnshapeError("Onshape refused access to this document. Check that your account can open it.", res.status);
    }
    if (res.status === 429) throw new BudgetError();
    if (res.status === 402) throw new QuotaError();
    if (!res.ok) throw new OnshapeError(`Onshape returned ${res.status} for ${name}`, res.status);
    return res;
  }

  const client: OnshapeClient = {
    calls: 0,
    async json<T>(path: string, init: RequestInit = {}): Promise<T> {
      return (await call(path, init, "application/json")).json() as Promise<T>;
    },
    raw: (pathOrUrl, init = {}) => call(pathOrUrl, init, "*/*"),
  };
  return client;
}
