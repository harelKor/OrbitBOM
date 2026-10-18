import { requireMember } from "@/lib/auth";

export default async function HomePage() {
  const member = await requireMember();
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Robots</h1>
      <p className="mt-1 text-sm text-slate-500">Welcome, {member.name.split(" ")[0]}.</p>
      <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        No robots yet.
      </div>
    </div>
  );
}
