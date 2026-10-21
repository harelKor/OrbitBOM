// Scrolls to a part's card or row (anything marked data-part with its id), opening any
// collapsed section around it, and flashes it. Waits a little for the page to render.
export function focusPart(partId: string, tries = 20) {
  const el = document.querySelector<HTMLElement>(`[data-part~="${CSS.escape(partId)}"]`);
  if (!el) {
    if (tries > 0) setTimeout(() => focusPart(partId, tries - 1), 150);
    return;
  }
  for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("focus-flash");
  void el.offsetWidth; // restart the animation
  el.classList.add("focus-flash");
}
