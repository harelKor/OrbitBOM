import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SandboxAssembly } from "./SandboxAssembly";

// The Assembly page on the 3D sandbox's made-up robot (plan/assembly-guides.md), since local dev
// has no Onshape and no R2. Development only, no sign-in; saving steps or ticks needs a database.
export default function DevAssemblyPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense>
      <SandboxAssembly />
    </Suspense>
  );
}
