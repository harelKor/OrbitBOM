import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Write tools preview first and apply only with the confirm_token from that preview (plan §6).
// The token is an HMAC over the member, the tool and its exact arguments, so it can't be reused
// for a different change, and it expires after 15 minutes. Stateless: nothing is stored.

const TTL_MS = 15 * 60 * 1000;

function key() {
  const secret = process.env.MCP_SECRET || process.env.CRON_SECRET;
  if (!secret) throw new Error("Set MCP_SECRET (any long random string) to use the MCP server.");
  return secret;
}

// Arguments in a stable order, without the confirmation fields themselves.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((k) => k !== "confirm_token" && k !== "confirm_large" && (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

const mac = (memberId: string, tool: string, args: unknown, exp: number) =>
  createHmac("sha256", key()).update(`${memberId}\n${tool}\n${exp}\n${canonical(args)}`).digest("base64url");

export function confirmToken(memberId: string, tool: string, args: unknown, now = Date.now()) {
  const exp = now + TTL_MS;
  return `${exp}.${mac(memberId, tool, args, exp)}`;
}

export function checkConfirmToken(token: string, memberId: string, tool: string, args: unknown, now = Date.now()) {
  const [expText, sig] = token.split(".");
  const exp = Number(expText);
  if (!sig || !Number.isFinite(exp) || exp < now) return false;
  const expected = Buffer.from(mac(memberId, tool, args, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
