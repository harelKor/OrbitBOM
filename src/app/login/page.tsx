import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { safeNext } from "@/lib/safeNext";
import { SignInButton } from "./SignInButton";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  if (await getUser()) redirect(safeNext(next));

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink p-4">
      <div className="panel w-full max-w-sm p-8">
        <h1 className="text-2xl font-semibold text-fg">OrbitMech</h1>
        <p className="mt-1 text-sm text-muted">Team 1690 bill of materials and inventory</p>
        {error && (
          <p className="mt-4 rounded-md bg-rose-50 p-3 text-sm text-rose-700">
            Sign-in failed. Please try again.
          </p>
        )}
        <div className="mt-6">
          <SignInButton next={safeNext(next)} />
        </div>
      </div>
    </main>
  );
}
