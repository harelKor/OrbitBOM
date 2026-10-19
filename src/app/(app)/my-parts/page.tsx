import { BomView } from "@/components/bom/BomView";
import { requireMember } from "@/lib/auth";
import { listInventoryNames } from "@/lib/data/inventory";
import { listMemberNames, listMyParts } from "@/lib/data/parts";

// My Parts (plan §2): every part where I'm the designer or a fabricator, across active robots.
export default async function MyPartsPage() {
  const member = await requireMember();
  const [parts, memberNames, inventory] = await Promise.all([
    listMyParts(member.name),
    listMemberNames(),
    listInventoryNames(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">My Parts</h1>
        <div className="text-sm text-slate-400">
          Parts where {member.name} is the designer or a fabricator, on every active robot.
        </div>
      </div>
      {parts.length ? (
        <BomView parts={parts} memberNames={memberNames} inventory={inventory} isAdmin={member.isAdmin} showSystem allowBulkEdit={false} />
      ) : (
        <div className="panel p-6 text-sm text-slate-400">
          Nothing assigned to you yet. On a part card, set Designer or a fabricator to your name and the part shows up here.
        </div>
      )}
    </div>
  );
}
