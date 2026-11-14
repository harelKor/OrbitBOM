import Link from "next/link";
import { OrbitFrame } from "@/components/shell/OrbitFrame";

// A link to a part, page or item that isn't there (deleted, or a typo): the Orbit frame with a way
// home, instead of Next's bare 404.
export default function NotFound() {
  return (
    <OrbitFrame title="Nothing here" text="This page doesn't exist, or what it showed was deleted.">
      <Link href="/" className="btn-primary min-h-11 px-6 active:scale-[0.98]">
        Go home
      </Link>
    </OrbitFrame>
  );
}
