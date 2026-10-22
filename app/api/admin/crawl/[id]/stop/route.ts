import { NextResponse } from "next/server";
import { stopCrawl } from "@/lib/crawler";
import { getCrawlJob } from "@/lib/db";

/** Ask a running crawl to stop at the next safe point. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const job = await getCrawlJob(id);
    if (!job) {
      return NextResponse.json({ error: { message: "Crawl job not found." } }, { status: 404 });
    }
    if (job.status !== "running") {
      return NextResponse.json({ job, message: "Job already finished." });
    }
    await stopCrawl(id);
    const updated = await getCrawlJob(id);
    return NextResponse.json({ ok: true, job: updated });
  } catch (cause) {
    return NextResponse.json(
      { error: { message: cause instanceof Error ? cause.message : "Could not stop the job." } },
      { status: 500 },
    );
  }
}
