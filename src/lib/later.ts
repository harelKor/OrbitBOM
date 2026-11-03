import "server-only";
import { after } from "next/server";

// Work the member doesn't need to wait for (auto-link after a commit): it runs once the answer
// has gone out. Outside a request (tests, scripts) there is no "after", so it runs right away.
export async function afterResponse(task: () => Promise<unknown>) {
  try {
    after(async () => {
      try {
        await task();
      } catch (err) {
        console.error("Background task failed", err);
      }
    });
  } catch {
    await task();
  }
}
