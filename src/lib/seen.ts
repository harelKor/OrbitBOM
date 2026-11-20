// The new parts glow (Harel, 2026-11-05): a part that arrives in a page's list glows for members
// who haven't opened that page since, in the side panel, on the home boxes and on the page itself.
// "Arriving" is moving into a status the page lists: Shop Fab's Released, In process and Post
// Processing; a team printer's Released (and Reproduction); a factory's Released; COTS Released
// and the Order List. parts.stage_at holds when it last arrived; page_seen when a member last
// opened each page. No browser-only code here: the server and the pages share it.

import { computeStatus, factoryOf, isBought, orderStatus, printerOf, statusMachine, type StatusInput } from "@/lib/status";

const SHOP: readonly string[] = ["Released", "Reproduction", "Gcoded", "In Process 1", "Released P2+", "In Process 2+", "Post Processing"];
const PRINT: readonly string[] = ["Released", "Reproduction"];

type Arrival = { page: string; machine?: string };

// The page a part is listed on in its current status, keyed per robot ("fab:<robot>",
// "print:<robot>:<printer>", "factory:<robot>:<factory>", "cots:released", "cots:order"), or
// null when no tracked page lists it. Shop Fab is one page; `machine` says which of its tabs.
export function arrivalPage(part: StatusInput, robotId: string | null): Arrival | null {
  const status = computeStatus(part);
  // A bought part (COTS, or bought as its Process 1) on the COTS page and Order List.
  if (isBought(part) && (part.classification === "cots" || status === orderStatus(part))) {
    const order = orderStatus(part);
    return order === "Released" ? { page: "cots:released" } : order === "In Order List" ? { page: "cots:order" } : null;
  }
  if (!robotId) return null;
  const factory = factoryOf(part);
  if (factory) return status === "Released" ? { page: `factory:${robotId}:${factory}` } : null;
  const printer = printerOf(part);
  if (printer) return PRINT.includes(status) ? { page: `print:${robotId}:${printer}` } : null;
  const machine = statusMachine(part);
  return machine && SHOP.includes(status) ? { page: `fab:${robotId}`, machine } : null;
}

// Whether a change makes the part arrive somewhere: it's listed after it, in another status or on
// another page than before (back to Released after Reproduction counts too).
export function arrives(before: StatusInput, after: StatusInput): boolean {
  const now = arrivalPage(after, "r");
  if (!now) return false;
  return computeStatus(before) !== computeStatus(after) || arrivalPage(before, "r")?.page !== now.page;
}

// Arrived after the member last opened the page. A page they never opened shows nothing new: it
// starts counting from their first visit.
export const isNewSince = (stageAt: Date | string | null | undefined, seenAt: Date | string | null | undefined) =>
  !!stageAt && !!seenAt && new Date(stageAt).getTime() > new Date(seenAt).getTime();
