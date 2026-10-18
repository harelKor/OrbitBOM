import { NavLink } from "@/components/NavLink";
import { SignOutButton } from "@/components/SignOutButton";
import { requireMember } from "@/lib/auth";

// Navigation follows the plan (§2): Build · Shop · Team. Items appear as each screen ships.
const NAV = [
  { section: "Build", items: [{ href: "/", label: "Home" }] },
  { section: "Shop", items: [{ href: "/inventory", label: "Inventory" }] },
  {
    section: "Team",
    items: [
      { href: "/members", label: "Members" },
      { href: "/profile", label: "Profile" },
    ],
  },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const member = await requireMember();

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-slate-800 bg-slate-900 md:w-56 md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-4 py-4 md:block">
          <div className="text-lg font-semibold">OrbitBOM</div>
          <div className="text-xs text-slate-400 md:mt-0.5">Team 1690</div>
        </div>
        <nav className="flex gap-4 overflow-x-auto px-2 pb-3 md:block md:space-y-4">
          {NAV.map((group) => (
            <div key={group.section}>
              <div className="px-3 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                {group.section}
              </div>
              {group.items.map((item) => (
                <NavLink key={item.href} href={item.href}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="hidden border-t border-slate-800 px-4 py-3 md:block">
          <div className="truncate text-sm font-medium">{member.name}</div>
          <div className="truncate text-xs text-slate-400">
            {member.email}
            {member.isAdmin && " · Admin"}
          </div>
          <SignOutButton className="mt-2" />
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
