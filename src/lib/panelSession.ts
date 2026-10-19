import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// The sign-in of the panel inside Onshape. Browsers don't send the Supabase cookie to an iframe
// on another site, so the panel keeps its own signed cookie, partitioned to Onshape (CHIPS).
export const PANEL_COOKIE = "orbit_panel";
const MAX_AGE = 60 * 60 * 24 * 60; // 60 days

export const panelCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "none",
  partitioned: true,
  path: "/",
  maxAge: MAX_AGE,
} as const;

// Derived from ONSHAPE_TOKEN_KEY so the panel needs no extra setting in Vercel.
function signingKey(): Buffer | null {
  const secret = process.env.ONSHAPE_TOKEN_KEY?.trim() ?? "";
  if (secret.length < 32) return null;
  return createHmac("sha256", secret).update("orbitbom panel session").digest();
}

function sign(payload: string, key: Buffer) {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function panelSessionValue(memberId: string): string {
  const key = signingKey();
  if (!key) throw new Error("ONSHAPE_TOKEN_KEY must be a random string of at least 32 characters.");
  const payload = `${memberId}.${Math.floor(Date.now() / 1000) + MAX_AGE}`;
  return `${payload}.${sign(payload, key)}`;
}

// The member id in a valid, unexpired panel cookie, or null.
export function readPanelSession(value: string | undefined): string | null {
  const key = signingKey();
  const [memberId, exp, mac] = value?.split(".") ?? [];
  if (!key || !memberId || !exp || !mac) return null;
  const expected = Buffer.from(sign(`${memberId}.${exp}`, key));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return Number(exp) * 1000 > Date.now() ? memberId : null;
}

export const newPanelCode = () => randomBytes(24).toString("base64url");
export const hashPanelCode = (code: string) => createHash("sha256").update(code).digest("hex");
