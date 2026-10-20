import { cookies } from "next/headers";
import { ROBOT_COOKIE } from "@/components/shell/mode";
import { Shell } from "@/components/shell/Shell";
import { requireMember } from "@/lib/auth";
import { listShellRobots } from "@/lib/data/shell";
import { getMode } from "@/lib/mode";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const member = await requireMember();
  const [robots, mode, jar] = await Promise.all([listShellRobots(), getMode(), cookies()]);

  return (
    <Shell
      robots={robots}
      lastRobotId={jar.get(ROBOT_COOKIE)?.value ?? null}
      mode={mode}
      member={{ name: member.name, email: member.email, isAdmin: member.isAdmin }}
    >
      {children}
    </Shell>
  );
}
