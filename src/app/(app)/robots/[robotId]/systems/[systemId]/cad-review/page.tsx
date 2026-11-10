import { redirect } from "next/navigation";

// A system's CAD page is the robot's CAD page with that system isolated (Harel, 2026-11-10); old
// links land there.
export default async function SystemReviewPage({ params }: { params: Promise<{ robotId: string; systemId: string }> }) {
  const { robotId, systemId } = await params;
  redirect(`/robots/${robotId}/cad-review?system=${encodeURIComponent(systemId)}`);
}
