// The round check that pops in on a selected card.
export function CheckBadge({ checked, className = "" }: { checked: boolean; className?: string }) {
  if (!checked) return null;
  return (
    <span className={`flex h-7 w-7 animate-pop items-center justify-center rounded-full bg-accent text-white shadow-lg ${className}`}>
      <CheckIcon className="h-4 w-4" />
    </span>
  );
}

export function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}
