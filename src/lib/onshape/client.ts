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

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number };

export async function requestToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${OAUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...params,
      client_id: process.env.ONSHAPE_CLIENT_ID!,
      client_secret: process.env.ONSHAPE_CLIENT_SECRET!,
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

async function accessToken(memberId: string): Promise<string> {
  const [row] = await db
    .select()
    .from(schema.onshapeTokens)
    .where(eq(schema.onshapeTokens.memberId, memberId))
    .limit(1);
  if (!row) throw new NotConnectedError();
  if (row.expiresAt.getTime() - Date.now() > 60_000) return decrypt(row.accessTokenEnc);
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
  calls: number;
};

// A client bound to one member and one Onshape host (cad.onshape.com or the Enterprise domain).
export function onshapeClient(memberId: string, baseUrl: string): OnshapeClient {
  const client: OnshapeClient = {
    calls: 0,
    async json<T>(path: string, init: RequestInit = {}): Promise<T> {
      await countCall(memberId);
      client.calls++;
      const res = await fetch(`${baseUrl}/api/v10/${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${await accessToken(memberId)}`,
          ...init.headers,
        },
      });
      if (res.status === 401) {
        await disconnect(memberId);
        throw new NotConnectedError();
      }
      if (res.status === 403 || res.status === 404) {
        throw new OnshapeError("Onshape refused access to this document. Check that your account can open it.", res.status);
      }
      if (res.status === 429) throw new BudgetError();
      if (!res.ok) throw new OnshapeError(`Onshape returned ${res.status} for ${path.split("?")[0]}`, res.status);
      return res.json() as Promise<T>;
    },
  };
  return client;
}
