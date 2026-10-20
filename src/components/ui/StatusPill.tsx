import { getStatus } from "@/config/statuses";
import { textOn } from "@/components/bom/options";

// A part status in its config colour.
export function StatusPill({ status, size = "sm" }: { status: string; size?: "sm" | "md" }) {
  const color = getStatus(status)?.color ?? "#cbd5e1";
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold whitespace-nowrap ${size === "md" ? "px-3 py-1 text-xs" : "px-2 py-0.5 text-[11px]"}`}
      style={{ background: color, color: textOn(color) }}
    >
      {status}
    </span>
  );
}
