import { GroupsView } from "@/components/groups/GroupsView";
import { requireMember } from "@/lib/auth";
import { listGroups } from "@/lib/data/groups";

export default async function GroupsPage() {
  const member = await requireMember();
  const groups = await listGroups();
  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Build</div>
        <h1 className="text-3xl font-semibold">Part Groups</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Bundles of parts that are made together, for example everything cut from one CNC program. Groups never
          collapse rows; they just bundle parts. Make one from a system&apos;s BOM with Group parts.
        </p>
      </div>
      <GroupsView groups={groups} isAdmin={member.isAdmin} />
    </div>
  );
}
