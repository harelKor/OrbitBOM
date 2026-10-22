// Line icons on a 20px grid, drawn with the current text colour.
const PATHS = {
  home: "M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1z",
  gauge: "M10 17a7 7 0 1 1 7-7M10 10l3.5-3.5M3.5 13.5h3",
  fab: "M12.5 3.5a3.5 3.5 0 0 0-3.3 4.6L3.8 13.5a1.5 1.5 0 0 0 2.1 2.1l5.4-5.4a3.5 3.5 0 0 0 4.6-3.3l-2 2-2-.5-.5-2z",
  review: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM7 10.2l2 2 4-4.4",
  box: "M3.5 6.5 10 3l6.5 3.5v7L10 17l-6.5-3.5zM3.5 6.5 10 10l6.5-3.5M10 10v7",
  users: "M7.5 9a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5zM2.5 16.5c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5M13 4a2.5 2.5 0 0 1 0 4.8M14.5 12.2c1.8.4 3 1.9 3 4.3",
  user: "M10 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 16.5c0-3 2.7-5 6-5s6 2 6 5",
  download: "M10 3.5v9M6.5 9 10 12.5 13.5 9M4 16h12",
  locate: "M10 15.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM10 2v3M10 15v3M2 10h3M15 10h3M10 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  note: "M5 3.5h7l3 3v10H5zM12 3.5v3h3M7.5 10h5M7.5 13h3.5",
  gear: "M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4",
  chevron: "M7.5 5 12.5 10l-5 5",
  arrow: "M4 10h12M11 5l5 5-5 5",
  more: "M5 10h.01M10 10h.01M15 10h.01",
  sun: "M10 13.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM10 2v1.5M10 16.5V18M2 10h1.5M16.5 10H18M4.3 4.3l1.1 1.1M14.6 14.6l1.1 1.1M4.3 15.7l1.1-1.1M14.6 5.4l1.1-1.1",
  moon: "M16 12.5A6.5 6.5 0 0 1 7.5 4a6.5 6.5 0 1 0 8.5 8.5z",
  expand: "M3.5 8V3.5H8M12 3.5h4.5V8M16.5 12v4.5H12M8 16.5H3.5V12",
  shrink: "M8 3.5V8H3.5M16.5 8H12V3.5M12 16.5V12h4.5M3.5 12H8v4.5",
  close: "M5 5l10 10M15 5 5 15",
  spark: "M10 2.5 11.8 8.2 17.5 10 11.8 11.8 10 17.5 8.2 11.8 2.5 10 8.2 8.2z",
  drawing: "M3 4.5h14v11H3zM10 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M10 6v8M6 10h8",
  cube: "M10 2.5 16.5 6v8L10 17.5 3.5 14V6zM3.5 6 10 9.5 16.5 6M10 9.5v8",
  pencil: "M13.5 3.5l3 3-9 9H4.5v-3zM11.5 5.5l3 3",
  cart: "M2.5 3.5h2l2 9h8.5l1.5-6.5H5.5M8 16.5h.01M14 16.5h.01",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 3 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
