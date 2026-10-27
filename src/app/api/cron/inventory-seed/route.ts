import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { enrichShopSeed, importShopSeed } from "@/lib/inventory/shopSeed";

export const maxDuration = 60;

// The one-off import of the shop spreadsheet (lib/inventory/shopSeed.ts). ?step=import adds the
// items, ?step=enrich (call it until remaining is 0) links products and saves their pictures.
// Both are safe to call again. Callers send CRON_SECRET, or the import key whose hash is below.
const KEY_SHA256 =
  "9e07a8d9fc3529859bf68cb4ad417e30f10fdab9bb8640cc2fc65fbd30d67f9a";

function allowed(request: NextRequest) {
  if (
    process.env.CRON_SECRET &&
    request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`
  )
    return true;
  const key = request.nextUrl.searchParams.get("key");
  if (!key) return false;
  const a = createHash("sha256").update(key).digest();
  return timingSafeEqual(a, Buffer.from(KEY_SHA256, "hex"));
}

export async function GET(request: NextRequest) {
  if (!allowed(request))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const started = Date.now();
  const step = request.nextUrl.searchParams.get("step");
  if (step === "import")
    return NextResponse.json({
      ...(await importShopSeed()),
      ms: Date.now() - started,
    });
  if (step === "enrich")
    return NextResponse.json({
      ...(await enrichShopSeed(started + 55_000)),
      ms: Date.now() - started,
    });
  return NextResponse.json(
    { error: "step must be import or enrich" },
    { status: 400 },
  );
}
