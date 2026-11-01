// Suggest's mark: a big four-point sparkle, a small one and a plus, filled with the text colour
// so it shows on light and dark backgrounds alike.
export function SuggestIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={`shrink-0 ${className}`} aria-hidden>
      <path d="M8 4.5Q8.7 10.3 14.5 11Q8.7 11.7 8 17.5Q7.3 11.7 1.5 11Q7.3 10.3 8 4.5z" />
      <path d="M15 1.5Q15.35 4.15 18 4.5Q15.35 4.85 15 7.5Q14.65 4.85 12 4.5Q14.65 4.15 15 1.5z" />
      <path d="M15.5 12.5v4.5M13.25 14.75h4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
