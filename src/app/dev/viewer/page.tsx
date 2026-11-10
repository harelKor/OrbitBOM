import { notFound } from "next/navigation";
import { Sandbox } from "./Sandbox";

// The local 3D sandbox (plan/cad-3d-viewer.md S0): the CAD viewer on a synthetic robot, since local
// dev has no Onshape and no R2. Development only; no sign-in (src/lib/supabase/proxy.ts).
export default function DevViewerPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Sandbox />;
}
