import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  cleanupShopSeed,
  enrichShopSeed,
  importShopSeed,
  relinkInventory,
  searchPreview,
} from "@/lib/inventory/shopSeed";
import { auditInventory, backfillSpecs } from "@/lib/inventory/specBackfill";

export const maxDuration = 60;

// The one-off import of the shop spreadsheet (lib/inventory/shopSeed.ts). ?step=import adds the
// items, ?step=enrich (call it until remaining is 0) links products and saves their pictures.
// Round 2 (2026-10-28): ?step=cleanup empties Released and the Order List and shortens names,
// ?step=relink (until remaining is 0; &dry=1 only lists its picks, &retry=1
// tries the not-found ones again) links COTS, electrical and tool
// items, ?step=search&q= shows what a store search returns. All are safe to call again.
// Callers send CRON_SECRET, or the import key whose hash is below.
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
  if (step === "cleanup")
    return NextResponse.json({
      ...(await cleanupShopSeed()),
      ms: Date.now() - started,
    });
  if (step === "relink")
    return NextResponse.json({
      ...(await relinkInventory(
        started + 55_000,
        request.nextUrl.searchParams.get("dry") === "1",
        request.nextUrl.searchParams.get("retry") === "1",
      )),
      ms: Date.now() - started,
    });
  if (step === "audit") return NextResponse.json(await auditInventory());
  if (step === "specs")
    return NextResponse.json(
      await backfillSpecs(request.nextUrl.searchParams.get("dry") === "1"),
    );
  if (step === "search")
    return NextResponse.json(
      await searchPreview(request.nextUrl.searchParams.get("q") ?? ""),
    );
  return NextResponse.json(
    { error: "step must be import, enrich, cleanup, relink or search" },
    { status: 400 },
  );
}
