import { connection, NextRequest, NextResponse } from "next/server";
import {
  countRecentSearches,
  countSeen,
  countWindowContacts,
  markSeen,
  recordDailyContacts,
  recordSearchEvent,
} from "@/lib/db";
import { emailUserKey, isAdminRequest } from "@/lib/identity";
import { runSearch } from "@/lib/search";
import {
  authenticatedEmail,
  quotaKeysFor,
  searchLimitFor,
  USER_DAILY_LIMIT,
} from "@/lib/user-auth";

/**
 * Database-backed search.
 *
 * Everything is answered from SQLite/Turso. There is deliberately no live
 * Overpass fallback here: a slow network call in the request path is exactly
 * what this architecture removes.
 *
 * Normal visitors get 10 fresh contacts per search. Their free allowance is a
 * rolling 20-hour window checked against the email, hashed network address and
 * device id together. Admin access requires the /admin password session and is
 * not limited. Delivered businesses are marked as seen, so the same lead is
 * never shown again.
 */

const SEARCHES_PER_MINUTE = 10;

const LIMIT_MESSAGE =
  "You've reached your 20-hour contact limit. View your history or try again later.";

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
  const audience = (searchParams.get("audience") ?? "").trim().slice(0, 80);
  const location = (searchParams.get("location") ?? "").trim().slice(0, 80);
  const rawPage = Number(searchParams.get("page") ?? "1");
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1;

  if (audience.length < 2) {
    return NextResponse.json(
      { error: { message: "Enter a business type to search for.", field: "audience" } },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (location.length < 2) {
    return NextResponse.json(
      { error: { message: "Enter a location to search in.", field: "location" } },
      { status: 400, headers: { "Cache-Control": "no-store" } },
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

  // Admin privileges come from the signed /admin password session, never from
  // an email address typed into the public modal (which is not proof of identity).
  const admin = await isAdminRequest(request);
  const userKey = emailUserKey(email);
  const searchLimit = searchLimitFor(admin);

  try {
    const quotaKeys = admin ? [] : quotaKeysFor(request, email);
    let dailyUsed = 0;

    if (!admin) {
      const counts = await Promise.all(
        quotaKeys.map((key) => countWindowContacts(key)),
      );
      dailyUsed = Math.max(0, ...counts);

      if (dailyUsed >= USER_DAILY_LIMIT) {
        return NextResponse.json(
          {
            error: { message: LIMIT_MESSAGE },
            outcome: "daily_limit",
            allowance: {
              limit: searchLimit,
              owner: false,
              excludedSeen: 0,
              dailyLimit: USER_DAILY_LIMIT,
              dailyUsed,
              dailyRemaining: 0,
            },
          },
          { status: 429, headers: { "Cache-Control": "no-store" } },
        );
      }

      // Rate-limit the same keys as the quota so changing the email cannot
      // bypass it. Admin sessions skip every limiter.
      const recentCounts = await Promise.all(
        quotaKeys.map((key) => countRecentSearches(key, 60)),
      );
      const recent = Math.max(0, ...recentCounts);
      if (recent >= SEARCHES_PER_MINUTE) {
        return NextResponse.json(
          {
            error: {
              message: "Too many searches. Please wait a minute and try again.",
            },
            outcome: "rate_limited",
          },
          {
            status: 429,
            headers: { "Retry-After": "60", "Cache-Control": "no-store" },
          },
        );
      }
    }

    const remainingBefore = admin
      ? searchLimit
      : Math.max(0, USER_DAILY_LIMIT - dailyUsed);

    if (admin) {
      await recordSearchEvent(userKey);
    } else {
      // Sequential writes: the local SQLite adapter shares one connection.
      for (const key of quotaKeys) {
        await recordSearchEvent(key);
      }
    }
    const seenTotal = await countSeen(userKey);

    const result = await runSearch({
      audience,
      location,
      limit: Math.min(searchLimit, remainingBefore),
      page,
      seenIds,
      excludeUserKey: userKey,
      maxLimit: searchLimit,
    });

    // Both tables are intentional:
    // - daily_contacts powers the rolling quota and the history page.
    // - seen_businesses permanently withholds delivered leads from future runs.
    const leadIds = result.leads.map((lead) => lead.id);
    if (admin) {
      // Admin has no quota, but still needs history. Record only the email key
      // so an admin's usage does not consume a coworker's shared network quota.
      await recordDailyContacts(userKey, leadIds);
    } else {
      // Sequential writes: the local SQLite adapter shares one connection.
      for (const key of quotaKeys) {
        await recordDailyContacts(key, leadIds);
      }
    }
    await markSeen(
      userKey,
      result.leads.map((lead) => ({ id: lead.id, email: lead.email })),
    );

    const usedAfter = admin
      ? 0
      : Math.max(
          0,
          ...(await Promise.all(
            quotaKeys.map((key) => countWindowContacts(key)),
          )),
        );
    const remainingAfter = admin
      ? null
      : Math.max(0, USER_DAILY_LIMIT - usedAfter);

    const freshMessage =
      result.leads.length === 0 && seenTotal > 0
        ? "No fresh leads left for this search. Try a different trade or location."
        : result.message;
    const baseResult = {
      ...result,
      message: freshMessage,
      hint: result.leads.length === 0 && seenTotal > 0 ? freshMessage : result.hint,
    };
    const finalResult =
      !admin && remainingAfter === 0
        ? {
            ...baseResult,
            hasMore: false,
            exhausted: true,
            message: LIMIT_MESSAGE,
            hint: LIMIT_MESSAGE,
          }
        : baseResult;

    return NextResponse.json(
      {
        ...finalResult,
        allowance: {
          limit: searchLimit,
          owner: admin,
          excludedSeen: seenTotal,
          dailyLimit: admin ? null : USER_DAILY_LIMIT,
          dailyUsed: admin ? 0 : usedAfter,
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
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
