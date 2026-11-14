import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string) => createHash("sha256").update(s).digest();

// Constant-time string comparison: both sides are hashed first, so different lengths don't leak.
export const sameSecret = (given: string, expected: string) => timingSafeEqual(digest(given), digest(expected));

// The server's own timers (deploy/setup.sh) send `Authorization: Bearer <CRON_SECRET>`. Fails
// closed: with CRON_SECRET unset or short, nothing passes (an unset secret used to let
// "Bearer undefined" through).
export function cronAllowed(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const header = request.headers.get("authorization");
  return !!header && sameSecret(header, `Bearer ${secret}`);
}
