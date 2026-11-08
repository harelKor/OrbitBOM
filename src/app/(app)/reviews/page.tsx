import { redirect } from "next/navigation";

// CAD Review moved under the robot (/robots/<robot>/cad-review); old links land there.
export default function OldReviews() {
  redirect("/go/cad-review");
}
