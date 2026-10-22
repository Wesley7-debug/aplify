import { connection, NextRequest, NextResponse } from "next/server";
import { listDailyContacts } from "@/lib/db";
import { ipUserKey } from "@/lib/identity";
import { leadFromRow } from "@/lib/search";
import type { Lead } from "@/lib/types";

export interface HistoryItem {
  day: string;
  shownAt: string;
  lead: Lead;
}

/** Contacts already fetched by this IP address, newest first. */
export async function GET(request: NextRequest) {
  await connection();

  const { searchParams } = new URL(request.url);
  const days = Number(searchParams.get("days") ?? "7");

  try {
    const rows = await listDailyContacts(
      ipUserKey(request),
      Number.isFinite(days) ? days : 7,
    );
    const items: HistoryItem[] = [];
    for (const row of rows) {
      const lead = leadFromRow(row);
      if (lead) items.push({ day: row.day, shownAt: row.shown_at, lead });
    }
    return NextResponse.json(
      { items },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    console.error("[history] database error", cause);
    return NextResponse.json(
      { error: { message: "Could not load your history right now." } },
      { status: 500 },
    );
  }
}
