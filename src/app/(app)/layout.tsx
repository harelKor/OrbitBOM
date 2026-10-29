import { cookies } from "next/headers";
import { ROBOT_COOKIE } from "@/components/shell/mode";
import { Shell } from "@/components/shell/Shell";
import { requireMember } from "@/lib/auth";
import { listCategories } from "@/lib/data/categories";
import { listMaterialColors } from "@/lib/data/materialColors";
import { listMaterials } from "@/lib/data/materials";
import { listShellRobots } from "@/lib/data/shell";
import { getAccess } from "@/lib/mode";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const member = await requireMember();
  const [robots, access, jar, materialColors, categories, materials] = await Promise.all([
    listShellRobots(),
    getAccess(),
    cookies(),
    listMaterialColors(),
    listCategories(),
    listMaterials(),
  ]);

  return (
    <Shell
      robots={robots}
      lastRobotId={jar.get(ROBOT_COOKIE)?.value ?? null}
      categories={categories.map((c) => ({ id: c.id, label: c.label, group: c.group }))}
      mode={access.mode}
      editing={access.editing}
      materialColors={materialColors}
      materials={materials}
      member={{ name: member.name, email: member.email, isAdmin: member.isAdmin }}
    >
      {children}
    </Shell>
  );
}
