import { notFound } from "next/navigation";
import { SandboxMap } from "./SandboxMap";

// The shop map on made-up zones and drawn pictures, since local dev has no R2 (plan: the shop map
// redesign, Harel 2026-11-14). Development only, no sign-in.
export default function DevShopMapPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SandboxMap />;
}
