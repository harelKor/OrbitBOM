import { notFound } from "next/navigation";
import { FlatSandbox } from "./FlatSandbox";
import { Sandbox } from "./Sandbox";

// The local 3D sandbox (plan/cad-3d-viewer.md S0): the CAD viewer on a synthetic robot, since local
// dev has no Onshape and no R2. Development only; no sign-in (src/lib/supabase/proxy.ts).
// ?flat=1: the part window's preview of a sheet metal part instead (Open flatten).
export default async function DevViewerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  return (await searchParams).flat === "1" ? <FlatSandbox /> : <Sandbox />;
}
