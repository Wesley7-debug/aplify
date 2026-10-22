import { connection, NextRequest, NextResponse } from "next/server";
import {
  countDailyContacts,
  countRecentSearches,
  getSeenIds,
  recordDailyContacts,
  recordSearchEvent,
} from "@/lib/db";
import {
  ipUserKey,
  isAdminRequest,
  isOwnerEmail,
  normalizeUserEmail,
} from "@/lib/identity";
import { runSearch } from "@/lib/search";

/**
 * Database-backed search.
 *
 * Everything is answered from SQLite/Turso. There is deliberately no live
 * Overpass fallback here: a slow network call in the request path is exactly
 * what this architecture removes.
 *
 * Every search returns 10 contacts. The public daily allowance is tied to the
 * caller's IP address so it cannot be reset by clearing local storage or
 * cookies. The owner email and signed-in admins are exempt from the daily cap.
 */

const GUEST_SEARCHES_PER_MINUTE = 10;
const DAILY_CONTACT_LIMIT = 10;
const SEARCH_RESULT_LIMIT = 10;

export async function GET(request: NextRequest) {
  await connection();

  const { searchParams } = new URL(request.url);
  const audience = (searchParams.get("audience") ?? "").trim();
  const location = (searchParams.get("location") ?? "").trim();
  const page = Number(searchParams.get("page") ?? "1");

  if (audience.length < 2) {
    return NextResponse.json(
      { error: { message: "Enter a business type to search for.", field: "audience" } },
      { status: 400 },
    );
  }
  if (location.length < 2) {
    return NextResponse.json(
      { error: { message: "Enter a location to search in.", field: "location" } },
      { status: 400 },
    );
  }

  const seen = [searchParams.get("seen"), searchParams.get("exclude")]
    .filter(Boolean)
    .join(",");
  const seenIds = seen
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 300);

  const userEmail = normalizeUserEmail(searchParams.get("user"));
  const admin = await isAdminRequest(request);
  const owner = admin || isOwnerEmail(userEmail);
  const userKey = ipUserKey(request);

  try {
    if (!owner) {
      const recent = await countRecentSearches(userKey, 60);
      if (recent >= GUEST_SEARCHES_PER_MINUTE) {
        return NextResponse.json(
          {
            error: {
              message: "Too many searches. Please wait a minute and try again.",
            },
            outcome: "rate_limited",
          },
          { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
        );
      }
    }

    const dailyUsed = owner ? 0 : await countDailyContacts(userKey);

    if (!owner && dailyUsed >= DAILY_CONTACT_LIMIT) {
      return NextResponse.json(
        {
          error: {
            message: "You've reached your daily contact limit. View your history or come back tomorrow.",
          },
          outcome: "daily_limit",
          allowance: {
            limit: SEARCH_RESULT_LIMIT,
            owner: false,
            excludedSeen: 0,
            dailyLimit: DAILY_CONTACT_LIMIT,
            dailyUsed,
            dailyRemaining: 0,
          },
        },
        { status: 429, headers: { "Cache-Control": "no-store" } },
      );
    }

    await recordSearchEvent(userKey);
    const excludeIds = await getSeenIds(userKey);

    const result = await runSearch({
      audience,
      location,
      limit: SEARCH_RESULT_LIMIT,
      page: Number.isFinite(page) ? page : 1,
      seenIds,
      excludeIds,
      maxLimit: SEARCH_RESULT_LIMIT,
    });

    // Record the fetched businesses so they appear on the IP's history page.
    const usedAfter = await recordDailyContacts(
      userKey,
      result.leads.map((lead) => lead.id),
    );
    const remainingAfter = owner
      ? null
      : Math.max(0, DAILY_CONTACT_LIMIT - usedAfter);

    const finalResult =
      remainingAfter === 0
        ? {
            ...result,
            hasMore: false,
            exhausted: true,
            message: "Daily limit reached. View your history or come back tomorrow.",
            hint: "Daily limit reached. View your history or come back tomorrow.",
          }
        : result;

    return NextResponse.json(
      {
        ...finalResult,
        allowance: {
          limit: SEARCH_RESULT_LIMIT,
          owner,
          excludedSeen: excludeIds.length,
          dailyLimit: owner ? null : DAILY_CONTACT_LIMIT,
          dailyUsed: owner ? 0 : usedAfter,
          dailyRemaining: remainingAfter,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    console.error("[search] database error", cause);
    return NextResponse.json(
      {
        error: {
          message:
            "The business database is unavailable right now. Please try again shortly.",
        },
        outcome: "service_error",
      },
      { status: 500 },
    );
  }
}
