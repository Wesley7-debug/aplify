import { connection } from "next/server";
import { getStats } from "@/lib/db";
import { getActiveCrawl } from "@/lib/crawler";

/** Dashboard data: totals, breakdowns, recent jobs and live progress. */
export async function GET() {
  await connection();

  try {
    const stats = await getStats();
    return Response.json(
      { stats, live: getActiveCrawl() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    return Response.json(
      {
        error: {
          message: cause instanceof Error ? cause.message : "Could not read database stats.",
        },
      },
      { status: 500 },
    );
  }
}
