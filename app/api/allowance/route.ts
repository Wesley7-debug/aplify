import { connection, NextRequest, NextResponse } from "next/server";
import { countDailyContacts } from "@/lib/db";
import {
  ipUserKey,
  isAdminRequest,
  isOwnerEmail,
  normalizeUserEmail,
} from "@/lib/identity";

const DAILY_CONTACT_LIMIT = 10;

/** Read-only quota lookup so the page can disable the button at the daily cap. */
export async function GET(request: NextRequest) {
  await connection();

  const { searchParams } = new URL(request.url);
  const userEmail = normalizeUserEmail(searchParams.get("user"));
  const admin = await isAdminRequest(request);
  const owner = admin || isOwnerEmail(userEmail);
  const userKey = ipUserKey(request);

  const dailyUsed = owner ? 0 : await countDailyContacts(userKey);

  return NextResponse.json(
    {
      limit: DAILY_CONTACT_LIMIT,
      owner,
      dailyLimit: owner ? null : DAILY_CONTACT_LIMIT,
      dailyUsed,
      dailyRemaining: owner
        ? null
        : Math.max(0, DAILY_CONTACT_LIMIT - dailyUsed),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
