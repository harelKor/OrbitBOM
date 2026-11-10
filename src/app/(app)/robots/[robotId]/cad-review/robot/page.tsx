import { redirect } from "next/navigation";

// The whole robot's CAD page is CAD's main page now (Harel, 2026-11-10); old links land there.
export default async function RobotReviewPage({ params }: { params: Promise<{ robotId: string }> }) {
  const { robotId } = await params;
  redirect(`/robots/${robotId}/cad-review`);
}
