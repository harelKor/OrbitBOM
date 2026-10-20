import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/SignOutButton";
import { db, schema } from "@/db";
import { getMember, getUser } from "@/lib/auth";

export default async function PendingPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/login");
  if (await getMember()) redirect("/");
  const { invite } = await searchParams;

  const [request] = await db
    .select()
    .from(schema.joinRequests)
    .where(eq(schema.joinRequests.userId, user.id))
    .limit(1);
  const denied = request?.status === "denied";

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink p-4">
      <div className="panel w-full max-w-md p-8">
        <h1 className="text-xl font-semibold text-slate-100">
          {denied ? "Request declined" : "Waiting for approval"}
        </h1>
        {invite === "invalid" && (
          <p className="mt-3 rounded-md bg-amber-950 p-3 text-sm text-amber-200">
            That invite link has expired or was already used.
          </p>
        )}
        <p className="mt-3 text-sm text-slate-300">
          {denied
            ? "An admin declined your request to join. Ask a team admin for an invite link."
            : `You're signed in as ${user.email}. An admin needs to approve your request, or you can open an invite link from a team admin.`}
        </p>
        <SignOutButton className="mt-6" />
      </div>
    </main>
  );
}
