import type { CardPart } from "./types";

// The small part image in table rows and Kanban cards.
export function Thumb({ part, size = 32 }: { part: Pick<CardPart, "thumbUrl">; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded bg-slate-800/60"
      style={{ width: size, height: size }}
    >
      {part.thumbUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
        <img src={part.thumbUrl} alt="" loading="lazy" className="h-full w-full object-contain" />
      )}
    </span>
  );
}
