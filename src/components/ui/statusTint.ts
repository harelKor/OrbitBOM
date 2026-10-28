import { getCotsStatus } from "@/config/cots";
import { DEFAULT_STATUS, getStatus } from "@/config/statuses";

// A card washed in its status colour: a light fill and a stronger border, readable in both themes.
export const tint = (color: string | undefined): React.CSSProperties | undefined =>
  color ? { backgroundColor: `color-mix(in srgb, ${color} 14%, var(--color-surface))`, borderColor: `color-mix(in srgb, ${color} 60%, transparent)` } : undefined;

// Not Started keeps the plain card; COTS-only statuses use their COTS colour.
const statusColor = (status: string | null) =>
  status && status !== DEFAULT_STATUS ? getStatus(status)?.color ?? getCotsStatus(status)?.color : undefined;

export const statusTint = (status: string | null) => tint(statusColor(status));

// The calmer wash inventory items wear for their standing: still red / orange / green at a
// glance, but half the fill and a muted border (Harel, 2026-10-28).
export const softStatusTint = (status: string | null): React.CSSProperties | undefined => {
  const color = statusColor(status);
  return color ? { backgroundColor: `color-mix(in srgb, ${color} 8%, var(--color-surface))`, borderColor: `color-mix(in srgb, ${color} 34%, transparent)` } : undefined;
};
