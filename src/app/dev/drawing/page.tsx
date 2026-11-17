import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { notFound } from "next/navigation";
import { readBodies } from "@/lib/drawing/brep";
import { readPart } from "@/lib/drawing/read";
import { SandboxDrawing } from "./SandboxDrawing";

const KINDS = ["plate", "square-tube", "hex-shaft", "round-tube"] as const;

// The drawing editor on the engine's test parts (src/lib/drawing/fixtures, real Onshape answers),
// since local dev has no Onshape to make drawings from. Development only; edits stay in the browser.
export default function DevDrawingPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const dir = join(process.cwd(), "src/lib/drawing/fixtures");
  const fixture = (name: string, kind: string) => JSON.parse(gunzipSync(readFileSync(join(dir, `${name}.${kind}.json.gz`))).toString());
  const parts = KINDS.map((k) => ({ key: k, part: readPart(readBodies(fixture(k, "bodydetails"), fixture(k, "tessellatededges"))[0])! }));
  return <SandboxDrawing parts={parts} />;
}
