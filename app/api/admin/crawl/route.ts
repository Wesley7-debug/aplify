import { NextResponse } from "next/server";
import { CrawlAlreadyRunningError, getActiveCrawl, startCrawl } from "@/lib/crawler";
import { getRunningJob } from "@/lib/db";

export const maxDuration = 300;

/** Start a background crawl. Returns the job id immediately. */
export async function POST(request: Request) {
  let body: { city?: unknown; trade?: unknown; maxMinutes?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const city = typeof body.city === "string" && body.city.trim() ? body.city.trim() : null;
  const trade = typeof body.trade === "string" && body.trade.trim() ? body.trade.trim() : null;
  const minutes = Number(body.maxMinutes);
  const maxMinutes = Number.isFinite(minutes) ? Math.min(Math.max(minutes, 0.5), 20) : 8;

  try {
    const job = await startCrawl({ maxMinutes, city, trade });
    return NextResponse.json({ job, live: getActiveCrawl(job.id) }, { status: 202 });
  } catch (cause) {
    if (cause instanceof CrawlAlreadyRunningError) {
      return NextResponse.json(
        {
          error: { message: "A crawl is already running. Stop it or wait for it to finish." },
          job: cause.job ?? (await getRunningJob()),
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error: {
          message: cause instanceof Error ? cause.message : "Could not start the crawler.",
        },
      },
      { status: 500 },
    );
  }
}
