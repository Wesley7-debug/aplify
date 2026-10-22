import { connection, NextRequest, NextResponse } from "next/server";
import { countWindowContacts } from "@/lib/db";
import { isAdminRequest } from "@/lib/identity";
import {
  authenticatedEmail,
  quotaKeysFor,
  searchLimitFor,
  USER_DAILY_LIMIT,
} from "@/lib/user-auth";

/**
 * Read-only quota lookup so the page can disable the search button before the
 * 11th contact. Admin sessions always report null remaining (unlimited).
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

  const admin = await isAdminRequest(request);
  if (admin) {
    return NextResponse.json(
      {
        authenticated: true,
        limit: searchLimitFor(true),
        owner: true,
        dailyLimit: null,
        dailyUsed: 0,
        dailyRemaining: null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const counts = await Promise.all(
    quotaKeysFor(request, email).map((key) => countWindowContacts(key)),
  );
  const dailyUsed = Math.max(0, ...counts);

  return NextResponse.json(
    {
      authenticated: true,
      limit: searchLimitFor(false),
      owner: false,
      dailyLimit: USER_DAILY_LIMIT,
      dailyUsed,
      dailyRemaining: Math.max(0, USER_DAILY_LIMIT - dailyUsed),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
