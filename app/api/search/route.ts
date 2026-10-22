import { connection, NextRequest, NextResponse } from "next/server";
import {
  countDailyContacts,
  countRecentSearches,
  getSeenExclusions,
  markSeen,
  recordDailyContacts,
  recordSearchEvent,
} from "@/lib/db";
import {
  emailUserKey,
  isAdminRequest,
  isOwnerEmail,
} from "@/lib/identity";
import { runSearch } from "@/lib/search";
import {
  authenticatedEmail,
  dailyLimitFor,
  searchLimitFor,
} from "@/lib/user-auth";

/**
 * Database-backed search.
 *
 * Everything is answered from SQLite/Turso. There is deliberately no live
 * Overpass fallback here: a slow network call in the request path is exactly
 * what this architecture removes.
 *
 * The caller must have an email session. Normal users get 10 fresh contacts per
 * search and per UTC day; the configured owner/admin email gets 30. Delivered
 * businesses are marked as seen, so the same lead is never shown again.
 */

const SEARCHES_PER_MINUTE = 10;

export async function GET(request: NextRequest) {
  await connection();

  const email = await authenticatedEmail(request);
  if (!email) {
    return NextResponse.json(
      {
        error: { message: "Enter your email to continue." },
        outcome: "auth_required",
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

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

  const admin = await isAdminRequest(request);
  const owner = admin || isOwnerEmail(email);
  const userKey = emailUserKey(email);
  const dailyLimit = dailyLimitFor(owner);
  const searchLimit = searchLimitFor(owner);

  try {
    if (!owner) {
      const recent = await countRecentSearches(userKey, 60);
      if (recent >= SEARCHES_PER_MINUTE) {
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

    const dailyUsed = await countDailyContacts(userKey);
    const remainingBefore = Math.max(0, dailyLimit - dailyUsed);

    if (remainingBefore === 0) {
      return NextResponse.json(
        {
          error: {
            message:
              "You've reached your daily contact limit. View your history or come back tomorrow.",
          },
          outcome: "daily_limit",
          allowance: {
            limit: searchLimit,
            owner,
            excludedSeen: 0,
            dailyLimit,
            dailyUsed,
            dailyRemaining: 0,
          },
        },
        { status: 429, headers: { "Cache-Control": "no-store" } },
      );
    }

    await recordSearchEvent(userKey);
    const seenBefore = await getSeenExclusions(userKey);

    const result = await runSearch({
      audience,
      location,
      limit: Math.min(searchLimit, remainingBefore),
      page: Number.isFinite(page) ? page : 1,
      seenIds,
      excludeIds: seenBefore.ids,
      excludeEmails: seenBefore.emails,
      maxLimit: searchLimit,
    });

    // Both tables are intentional:
    // - daily_contacts powers the daily quota and history page.
    // - seen_businesses permanently withholds delivered leads from future runs.
    const usedAfter = await recordDailyContacts(
      userKey,
      result.leads.map((lead) => lead.id),
    );
    await markSeen(
      userKey,
      result.leads.map((lead) => ({ id: lead.id, email: lead.email })),
    );

    const remainingAfter = Math.max(0, dailyLimit - usedAfter);
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
          limit: searchLimit,
          owner,
          excludedSeen: seenBefore.ids.length,
          dailyLimit,
          dailyUsed: usedAfter,
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
