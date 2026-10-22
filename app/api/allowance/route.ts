import { connection, NextRequest, NextResponse } from "next/server";
import { countDailyContacts } from "@/lib/db";
import { emailUserKey, isAdminRequest, isOwnerEmail } from "@/lib/identity";
import {
  authenticatedEmail,
  dailyLimitFor,
  searchLimitFor,
} from "@/lib/user-auth";

/** Read-only quota lookup so the page can disable the button at the daily cap. */
export async function GET(request: NextRequest) {
  await connection();

  const email = await authenticatedEmail(request);
  if (!email) {
    return NextResponse.json(
      { authenticated: false, error: { message: "Enter your email to continue." } },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const admin = await isAdminRequest(request);
  const owner = admin || isOwnerEmail(email);
  const dailyLimit = dailyLimitFor(owner);
  const dailyUsed = await countDailyContacts(emailUserKey(email));

  return NextResponse.json(
    {
      authenticated: true,
      limit: searchLimitFor(owner),
      owner,
      dailyLimit,
      dailyUsed,
      dailyRemaining: Math.max(0, dailyLimit - dailyUsed),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
