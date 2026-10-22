import { Icon } from "./Icon";

// The arrow of a collapsible section, in a roomy hit area so a click on or near it always folds
// the section. Put it inside the section's toggle.
export function Chevron({ open, small = false, className = "" }: { open: boolean; small?: boolean; className?: string }) {
  return (
    <span className={`-m-1 inline-flex shrink-0 items-center justify-center rounded-md p-1 text-subtle hover:bg-raised hover:text-fg ${small ? "h-7 w-7" : "h-9 w-9"} ${className}`}>
      <Icon name="chevron" className={`transition-transform duration-150 ${open ? "rotate-90" : ""} ${small ? "h-4 w-4" : "h-6 w-6"}`} />
    </span>
  );
}
