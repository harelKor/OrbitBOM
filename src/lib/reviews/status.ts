// CAD comment statuses (Harel, 2026-11-13), like a BOM part's: a coloured pill that opens the
// statuses its member may pick. Open → On it → To check (a mentor's to approve) → Done. Shared by
// the server's checks (comments.ts) and the pills in the browser.

export type CommentStatus = "open" | "on_it" | "to_check" | "done";

export const COMMENT_STATUSES: { key: CommentStatus; label: string; color: string; hint: string }[] = [
  { key: "open", label: "Open", color: "#f59e0b", hint: "Nobody has taken it yet" },
  { key: "on_it", label: "On it", color: "#3b82f6", hint: "Someone is working on it" },
  { key: "to_check", label: "To check", color: "#8b5cf6", hint: "Ready for a mentor to check" },
  { key: "done", label: "Done", color: "#10b981", hint: "A mentor approved it" },
];

export const statusOf = (s: string) => COMMENT_STATUSES.find((x) => x.key === s) ?? COMMENT_STATUSES[0];

// Still to act on: in the comments list, counted on badges, offered to the Commit window.
export const isActive = (s: string) => s === "open" || s === "on_it";

// `team`: CAD Team or mentor; `approver`: a mentor, or an admin in Edit mode; `author`: wrote it.
// The CAD Team and the author move a comment between Open, On it and To check; only approvers set
// Done or take a Done one back, and set any status (Done straight from Open too).
export type Who = { team: boolean; approver: boolean; author: boolean };

export function allowedStatuses(from: CommentStatus, who: Who): CommentStatus[] {
  if (who.approver) return COMMENT_STATUSES.map((s) => s.key).filter((k) => k !== from);
  if (!(who.team || who.author) || from === "done") return [];
  return (["open", "on_it", "to_check"] as const).filter((k) => k !== from);
}

// A mentor sending a To check comment back writes why (it shows under the comment).
export const needsNote = (from: CommentStatus, to: CommentStatus, who: { mentor: boolean }) => who.mentor && from === "to_check" && (to === "open" || to === "on_it");
