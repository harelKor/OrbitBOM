import { cookies } from "next/headers";
import { ROBOT_COOKIE } from "@/components/shell/mode";
import { Shell } from "@/components/shell/Shell";
import { requireMember } from "@/lib/auth";
import { listCategories } from "@/lib/data/categories";
import { listMaterialColors } from "@/lib/data/materialColors";
import { listNewest, listSeen } from "@/lib/data/seen";
import { listShellRobots } from "@/lib/data/shell";
import { getMode } from "@/lib/mode";

// When this render happened: a new value on every server render of the layout.
const renderStamp = () => Date.now();

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const member = await requireMember();
  const [robots, mode, jar, materialColors, categories, newest, seen] = await Promise.all([
    listShellRobots(),
    getMode(),
    cookies(),
    listMaterialColors(),
    listCategories(),
    // The new parts glow: the newest arrival per page and when this member last opened each.
    listNewest(member.id),
    listSeen(member.id),
  ]);

  return (
    <Shell
      robots={robots}
      lastRobotId={jar.get(ROBOT_COOKIE)?.value ?? null}
      categories={categories.map((c) => ({ id: c.id, label: c.label, group: c.group }))}
      mode={mode}
      materialColors={materialColors}
      // A new render (a save, a refresh) has the material pickers fetch their list again.
      materialsStamp={renderStamp()}
      member={{ name: member.name, email: member.email, isAdmin: member.isAdmin }}
      arrivals={{ newest, seen }}
    >
      {children}
    </Shell>
  );
}
