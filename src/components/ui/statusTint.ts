import { getCotsStatus } from "@/config/cots";
import { DEFAULT_STATUS, getStatus } from "@/config/statuses";

// A card washed in its status colour: a light fill and a stronger border, readable in both themes.
export const tint = (color: string | undefined): React.CSSProperties | undefined =>
  color ? { backgroundColor: `color-mix(in srgb, ${color} 14%, var(--color-surface))`, borderColor: `color-mix(in srgb, ${color} 60%, transparent)` } : undefined;

// Not Started keeps the plain card; COTS-only statuses use their COTS colour.
export const statusTint = (status: string | null) =>
  status && status !== DEFAULT_STATUS ? tint(getStatus(status)?.color ?? getCotsStatus(status)?.color) : undefined;
