import { connection, NextRequest, NextResponse } from "next/server";
import { listLatestContactBatch } from "@/lib/db";
import { emailUserKey } from "@/lib/identity";
import { leadFromRow } from "@/lib/search";
import { authenticatedEmail } from "@/lib/user-auth";
import type { Lead } from "@/lib/types";

interface RecentItem {
  day: string;
  shownAt: string;
  lead: Lead;
}

/**
 * The contacts from the signed-in email's most recent fetch. Used by the home
 * page to restore the visible result set after a reload or full navigation.
 */
export async function GET(request: NextRequest) {
  await connection();

  const email = await authenticatedEmail(request);
  if (!email) {
    return NextResponse.json(
      { authenticated: false, error: { message: "Enter your email to continue." } },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const rows = await listLatestContactBatch(emailUserKey(email), 30);
    const items: RecentItem[] = [];
    for (const row of rows) {
      const lead = leadFromRow(row);
      if (lead) items.push({ day: row.day, shownAt: row.shown_at, lead });
    }
    return NextResponse.json(
      { items },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    console.error("[recent] database error", cause);
    return NextResponse.json(
      { error: { message: "Could not restore your last fetched contacts." } },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
