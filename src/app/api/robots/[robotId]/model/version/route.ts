import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import type { ModelKind } from "@/db/schema";
import { getMember } from "@/lib/auth";
import { DENIED, hasCapability } from "@/lib/mode";
import type { ModelOwner } from "@/lib/model/build";
import { buildSnapshot, versionModel, type VersionEntry } from "@/lib/model/snapshots";
import { OnshapeError } from "@/lib/onshape/client";
import { StorageNotConfiguredError } from "@/lib/storage/r2";
import { isUuid } from "@/lib/uuid";

// A version's 3D model (plan/cad-versions.md, Harel 2026-11-17). Each `e` is one owner at one
// fixed Onshape state: "<systemId>|v|<versionId>", "<systemId>|m|<microversion>", or "robot|v|…"
// for the robot's own Basepart. GET reads the kept snapshots (no Onshape calls); POST builds one
// entry's snapshot a step at a time, on the member's Onshape account, for a version made before
// snapshots were kept.

const kindOf = (url: URL): ModelKind => (url.searchParams.get("model") === "basepart" ? "basepart" : "final");

function parseEntries(robotId: string, url: URL): { owner: ModelOwner; ref: VersionEntry["ref"] }[] | null {
  const raw = url.searchParams.getAll("e");
  if (!raw.length || raw.length > 40) return null;
  const out: { owner: ModelOwner; ref: VersionEntry["ref"] }[] = [];
  for (const e of raw) {
    const [who, wvm, wvmid] = e.split("|");
    if ((wvm !== "v" && wvm !== "m") || !/^[0-9a-f]{24}$/i.test(wvmid ?? "")) return null;
    if (who === "robot") out.push({ owner: { robotId }, ref: { wvm, wvmid } });
    else if (isUuid(who)) out.push({ owner: { systemId: who }, ref: { wvm, wvmid } });
    else return null;
  }
  return out;
}

export async function GET(request: Request, { params }: { params: Promise<{ robotId: string }> }) {
  if (!(await getMember())) return new NextResponse("Sign in first.", { status: 401 });
  const { robotId } = await params;
  const url = new URL(request.url);
  const parsed = isUuid(robotId) ? parseEntries(robotId, url) : null;
  if (!parsed) return NextResponse.json({ state: "error", error: "Unknown version." }, { status: 400 });
  const ids = parsed.flatMap((p) => ("systemId" in p.owner ? [p.owner.systemId] : []));
  const [rows, [robot]] = await Promise.all([
    ids.length ? db.select({ id: schema.systems.id, name: schema.systems.name }).from(schema.systems).where(and(eq(schema.systems.robotId, robotId), inArray(schema.systems.id, ids))) : [],
    db.select({ name: schema.robots.name }).from(schema.robots).where(eq(schema.robots.id, robotId)),
  ]);
  const names = new Map(rows.map((r) => [r.id, r.name]));
  if (!robot || ids.some((id) => !names.has(id))) return NextResponse.json({ state: "error", error: "Unknown version." }, { status: 404 });
  const entries = parsed.map((p) => ({ ...p, name: "systemId" in p.owner ? names.get(p.owner.systemId)! : robot.name }));
  return NextResponse.json(await versionModel(robotId, kindOf(url), entries));
}

export async function POST(request: Request, { params }: { params: Promise<{ robotId: string }> }) {
  const started = Date.now();
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!(await hasCapability("sync"))) return NextResponse.json({ error: DENIED.sync }, { status: 403 });
  if (!member.onshapeConnected) return NextResponse.json({ error: "Connect your Onshape account first (Profile → Connect Onshape)." }, { status: 403 });
  const { robotId } = await params;
  const url = new URL(request.url);
  const parsed = isUuid(robotId) ? parseEntries(robotId, url) : null;
  if (!parsed || parsed.length !== 1) return NextResponse.json({ error: "Unknown version." }, { status: 400 });
  const [{ owner, ref }] = parsed;
  if ("systemId" in owner) {
    const [s] = await db.select({ id: schema.systems.id }).from(schema.systems).where(and(eq(schema.systems.id, owner.systemId), eq(schema.systems.robotId, robotId)));
    if (!s) return NextResponse.json({ error: "Unknown system." }, { status: 404 });
  }
  try {
    return NextResponse.json(await buildSnapshot(robotId, kindOf(url), owner, ref, member.id, started + 150_000));
  } catch (err) {
    if (err instanceof OnshapeError || err instanceof StorageNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("Version model build failed", err);
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `The export failed: ${reason.slice(0, 300)}` }, { status: 500 });
  }
}
