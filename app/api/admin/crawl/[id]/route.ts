import { connection } from "next/server";
import { getActiveCrawl } from "@/lib/crawler";
import { getCrawlJob } from "@/lib/db";

/** Poll a crawl job. `live` carries in-memory progress; `job` is persisted. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await connection();
  const { id } = await params;

  try {
    const [job, live] = await Promise.all([getCrawlJob(id), Promise.resolve(getActiveCrawl(id))]);
    if (!job) {
      return Response.json({ error: { message: "Crawl job not found." } }, { status: 404 });
    }
    return Response.json(
      { job, live },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    return Response.json(
      { error: { message: cause instanceof Error ? cause.message : "Could not read the job." } },
      { status: 500 },
    );
  }
}
