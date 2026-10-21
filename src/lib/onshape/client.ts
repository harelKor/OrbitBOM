import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { decrypt, encrypt } from "@/lib/crypto";

// Onshape API access on a member's own OAuth connection (plan §4). Tokens never leave the
// server. Every call is counted per account per day; past the budget, calls stop and the
// app reads from its own data instead.

export const OAUTH_BASE = "https://oauth.onshape.com";
export const DAILY_CALL_BUDGET = 2200;
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

// `fresh` skips the stored access token (Onshape rejected it before it expired).
async function accessToken(memberId: string, fresh = false): Promise<string> {
  const [row] = await db
    .select()
    .from(schema.onshapeTokens)
    .where(eq(schema.onshapeTokens.memberId, memberId))
    .limit(1);
  if (!row) throw new NotConnectedError();
  if (!fresh && row.expiresAt.getTime() - Date.now() > 60_000) return decrypt(row.accessTokenEnc);
  try {
    const t = await requestToken({ grant_type: "refresh_token", refresh_token: decrypt(row.refreshTokenEnc) });
    await saveTokens(memberId, t);
    return t.access_token;
  } catch (err) {
    if (err instanceof OnshapeError && err.status && err.status < 500) {
      await disconnect(memberId);
      throw new NotConnectedError();
    }
    throw err;
  }
}

// Counts one call against today's budget; throws when the budget is spent.
async function countCall(memberId: string) {
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
export function onshapeClient(memberId: string, baseUrl: string): OnshapeClient {
  async function call(pathOrUrl: string, init: RequestInit, accept: string) {
    const url = /^https:\/\//.test(pathOrUrl) ? pathOrUrl : `${baseUrl}/api/v10/${pathOrUrl}`;
    // Never send the member's token anywhere but their Onshape host.
    if (new URL(url).origin !== new URL(baseUrl).origin) throw new OnshapeError("Unexpected Onshape link.");
    await countCall(memberId);
    client.calls++;
    const send = async (fresh: boolean) => {
      const headers = {
        Accept: accept,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
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
