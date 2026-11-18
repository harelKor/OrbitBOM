import { notFound } from "next/navigation";
import { CadSandbox } from "./CadSandbox";

// The CAD page's screen (ReviewScreen) on the 3D sandbox robot with made-up comments, so the
// comments column, the Add comment window and the 3D comment tags can be tried locally with no
// database (plan/cad-design-review.md). Saving does nothing here. Development only.
export default function DevCadReviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CadSandbox />;
}
