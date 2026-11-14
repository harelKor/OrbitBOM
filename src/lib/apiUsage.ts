import "server-only";
import { sql } from "drizzle-orm";
import { API_DAILY, type ApiService } from "@/config/apiLimits";
import { db, schema } from "@/db";

const today = () => new Date().toISOString().slice(0, 10);

// Takes one of today's calls for `service`: true when it was still under its daily cap (and is
// now counted), false when the cap is reached. One statement, so two requests can't both take
// the last call. If the count can't be read the call is refused: a cap that fails open isn't one.
export async function takeApiCall(service: ApiService): Promise<boolean> {
  const { apiUsage } = schema;
  try {
    const rows = await db
      .insert(apiUsage)
      .values({ day: today(), service, calls: 1 })
      .onConflictDoUpdate({
        target: [apiUsage.day, apiUsage.service],
        set: { calls: sql`${apiUsage.calls} + 1` },
        setWhere: sql`${apiUsage.calls} < ${API_DAILY[service]}`,
      })
      .returning({ calls: apiUsage.calls });
    return rows.length > 0;
  } catch (err) {
    console.error(`api_usage ${service} failed`, err);
    return false;
  }
}
