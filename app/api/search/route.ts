import { randomUUID } from "node:crypto";
import { connection, NextRequest, NextResponse } from "next/server";
import { countRecentSearches, getSeenIds, recordSearchEvent } from "@/lib/db";
import {
  isAdminRequest,
  isOwnerEmail,
  normalizeUserEmail,
  UID_COOKIE,
  UID_MAX_AGE,
  uidFromRequest,
  userKeyFor,
} from "@/lib/identity";
import { MAX_LIMIT, USER_MAX_LIMIT, runSearch } from "@/lib/search";

/**
 * Database-backed search.
 *
 * Everything is answered from SQLite/Turso. There is deliberately no live
 * Overpass fallback here: a slow network call in the request path is exactly
 * what this architecture removes.
 *
 * Guests are capped at 10 contacts per request and 10 requests per minute. The
 * owner email (and any signed-in admin) keeps the full cap. Businesses that
 * have already been emailed by this user are filtered out server-side.
 */

const GUEST_SEARCHES_PER_MINUTE = 10;

export async function GET(request: NextRequest) {
  await connection();

  const { searchParams } = new URL(request.url);
  const audience = (searchParams.get("audience") ?? "").trim();
  const location = (searchParams.get("location") ?? "").trim();
  const limit = Number(searchParams.get("limit") ?? "10");
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

  const existingUid = uidFromRequest(request);
  const uid = existingUid ?? randomUUID();
  const userKey = userKeyFor({ email: userEmail, uid, admin });

  try {
    if (!owner) {
      const recent = await countRecentSearches(userKey, 60);
      if (recent >= GUEST_SEARCHES_PER_MINUTE) {
        const limited = NextResponse.json(
          {
            error: {
              message: "Too many searches. Please wait a minute and try again.",
            },
            outcome: "rate_limited",
          },
          { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
        );
        attachUid(limited, existingUid, uid);
        return limited;
      }
    }

    await recordSearchEvent(userKey);
    const excludeIds = await getSeenIds(userKey);

    const result = await runSearch({
      audience,
      location,
      limit: Number.isFinite(limit) ? limit : 10,
      page: Number.isFinite(page) ? page : 1,
      seenIds,
      excludeIds,
      maxLimit: owner ? MAX_LIMIT : USER_MAX_LIMIT,
    });

    const response = NextResponse.json(
      {
        ...result,
        // The client can show the real allowance without a separate request.
        allowance: {
          limit: owner ? MAX_LIMIT : USER_MAX_LIMIT,
          owner,
          excludedSeen: excludeIds.length,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
    attachUid(response, existingUid, uid);
    return response;
  } catch (cause) {
    console.error("[search] database error", cause);
    return NextResponse.json(
      {
        error: {
          message:
            "The local business database is unavailable right now. Check that data/aplify.db is writable, or your Turso credentials.",
        },
        outcome: "service_error",
      },
      { status: 500 },
    );
  }
}

function attachUid(
  response: NextResponse,
  existing: string | null,
  uid: string,
): void {
  if (existing) return;
  response.cookies.set(UID_COOKIE, uid, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: UID_MAX_AGE,
  });
}
