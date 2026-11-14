// Daily caps on outside APIs that cost credits or have a free quota (Harel: everything stays
// free). Counted in the database (api_usage), so a restart or deploy doesn't reset them.
// Serper's free plan is a one-off 2,500 credits: a web search is 2 (Shopping + Search), a Lens
// search 3. Gemini's key has no billing account, so past Google's free quota it only refuses;
// its cap stops a loop from spending the whole day's quota on one screen.
export const API_DAILY = {
  "serper-web": 40,
  "serper-lens": 60,
  gemini: 400,
} as const;

export type ApiService = keyof typeof API_DAILY;
