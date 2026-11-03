// The team's Onshape API allowance (2026-11-03). Onshape's Enterprise plan gives the team's OAuth
// app 10,000 calls a year, shared by every member, and answers 402 once they're gone: then
// Update BOM, previews and exports stop for everyone. The app counts every call and stops
// itself well before that. Edit here.

// Onshape's yearly allowance and the day it renews (set this to the subscription's renewal date).
export const YEARLY_CALLS = 10_000;
export const YEAR_STARTS = "2026-01-01";
// Calls Onshape's dashboard showed when the app started counting team-wide (2026-11-03): this
// year's total starts from here.
export const CALLS_BEFORE_COUNTING = 300;

// A day's calls for the whole team. Automatic work (part thumbnails after a sync, 3D previews
// re-made when opened) stops at BACKGROUND_SHARE of it, so Update BOM, Commit and exports
// a member asks for still work on a busy day.
export const TEAM_DAILY_CALLS = 500;
export const BACKGROUND_SHARE = 0.6;
// One member's account in a day.
export const MEMBER_DAILY_CALLS = 400;
// From this share of the year's allowance, automatic work stops for the rest of the year;
// at all of it, every call does.
export const YEAR_BACKGROUND_STOP = 0.9;
