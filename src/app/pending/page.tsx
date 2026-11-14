import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/SignOutButton";
import { db, schema } from "@/db";
import { getMember, getUser } from "@/lib/auth";
import { Notice } from "@/components/ui/Notice";

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
        <h1 className="text-xl font-semibold text-fg">
          {denied ? "Request declined" : "Waiting for approval"}
        </h1>
        {invite === "invalid" && (
          <Notice tone="warning" className="mt-3">
            That invite link has expired or was already used.
          </Notice>
        )}
        <p className="mt-3 text-sm text-fg-2">
          {denied
            ? "An admin declined your request to join. Ask a team admin for an invite link."
            : `You're signed in as ${user.email}. An admin needs to approve your request, or you can open an invite link from a team admin.`}
        </p>
        <SignOutButton className="mt-6" />
      </div>
    </main>
  );
}
