import { redirect } from "next/navigation";

// "Main" (every part of the robot) now lives on the robot dashboard.
export default async function MainPage({ params }: { params: Promise<{ robotId: string }> }) {
  const { robotId } = await params;
  redirect(`/robots/${robotId}`);
}
