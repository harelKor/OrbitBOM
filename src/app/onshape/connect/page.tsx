import { and, eq, gt, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireMember } from "@/lib/auth";
import { hashPanelCode } from "@/lib/panelSession";
import { CloseWindow } from "./CloseWindow";

// The popup the Onshape panel opens: the member, signed in here as usual, approves the panel's code.
export default async function ConnectPanelPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; done?: string }>;
}) {
  const member = await requireMember();
  const { code, done } = await searchParams;

  async function approve() {
    "use server";
    const approver = await requireMember();
    const { panelLogins } = schema;
    await db
      .update(panelLogins)
      .set({ memberId: approver.id })
      .where(
        and(
          eq(panelLogins.codeHash, hashPanelCode(code ?? "")),
          isNull(panelLogins.memberId),
          gt(panelLogins.createdAt, new Date(Date.now() - 10 * 60_000)),
        ),
      );
    redirect("/onshape/connect?done=1");
  }

  return (
    <main className="mx-auto max-w-sm space-y-4 p-8 text-center">
      <h1 className="text-xl font-semibold">OrbitBOM in Onshape</h1>
      {done ? (
        <>
          <p className="text-sm text-fg-2">Signed in. You can close this window.</p>
          <CloseWindow />
        </>
      ) : code ? (
        <form action={approve} className="space-y-4">
          <p className="text-sm text-fg-2">
            Sign in to the OrbitBOM panel in Onshape as <b>{member.name}</b>? Only continue if you opened this
            window from that panel.
          </p>
          <button className="btn-primary w-full">Sign in to the panel</button>
        </form>
      ) : (
        <p className="text-sm text-fg-2">Open this from the OrbitBOM panel in Onshape.</p>
      )}
    </main>
  );
}
