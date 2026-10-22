import { getStatus } from "@/config/statuses";

// A card washed in its status colour: a light fill and a stronger border, readable in both themes.
export const tint = (color: string | undefined): React.CSSProperties | undefined =>
  color ? { backgroundColor: `color-mix(in srgb, ${color} 14%, var(--color-surface))`, borderColor: `color-mix(in srgb, ${color} 60%, transparent)` } : undefined;

export const statusTint = (status: string | null) => tint(status ? getStatus(status)?.color : undefined);
