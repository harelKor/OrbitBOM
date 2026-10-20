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
  cube: "M10 2.5 16.5 6v8L10 17.5 3.5 14V6zM3.5 6 10 9.5 16.5 6M10 9.5v8",
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
