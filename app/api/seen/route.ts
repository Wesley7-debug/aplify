import { randomUUID } from "node:crypto";
import { connection, NextRequest, NextResponse } from "next/server";
import { clearSeen, countSeen, markSeen } from "@/lib/db";
import {
  isAdminRequest,
  normalizeUserEmail,
  UID_COOKIE,
  UID_MAX_AGE,
  uidFromRequest,
  userKeyFor,
} from "@/lib/identity";

/**
 * Mark a business as contacted, or clear the caller's contacted list.
 *
 * Contacted businesses are stored in SQLite/Turso and filtered out of future
 * searches, so a user is never shown an inbox they have already emailed.
 */

async function contextFor(request: NextRequest, body?: { user?: unknown }) {
  const url = new URL(request.url);
  const email = normalizeUserEmail(
    typeof body?.user === "string" ? body.user : url.searchParams.get("user"),
  );
  const admin = await isAdminRequest(request);
  const existingUid = uidFromRequest(request);
  const uid = existingUid ?? randomUUID();
  return {
    email,
    admin,
    existingUid,
    uid,
    userKey: userKeyFor({ email, uid, admin }),
  };
}

function attachUid(response: NextResponse, existing: string | null, uid: string): void {
  if (existing) return;
  response.cookies.set(UID_COOKIE, uid, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: UID_MAX_AGE,
  });
}

export async function POST(request: NextRequest) {
  await connection();

  let body: { leadId?: unknown; email?: unknown; user?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // fall through to validation
  }

  const leadId = typeof body.leadId === "string" ? body.leadId.trim().slice(0, 200) : "";
  if (!leadId) {
    return NextResponse.json(
      { error: { message: "A business id is required." } },
      { status: 400 },
    );
  }

  try {
    const context = await contextFor(request, body);
    const leadEmail =
      typeof body.email === "string" && body.email.length <= 254
        ? body.email.trim().toLowerCase()
        : null;

    await markSeen(context.userKey, [{ id: leadId, email: leadEmail }]);
    const response = NextResponse.json({
      ok: true,
      seen: await countSeen(context.userKey),
    });
    attachUid(response, context.existingUid, context.uid);
    return response;
  } catch (cause) {
    console.error("[seen] database error", cause);
    return NextResponse.json(
      { error: { message: "Could not update your contacted list." } },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  await connection();

  try {
    const context = await contextFor(request);
    const cleared = await clearSeen(context.userKey);
    const response = NextResponse.json({ ok: true, cleared });
    attachUid(response, context.existingUid, context.uid);
    return response;
  } catch (cause) {
    console.error("[seen] database error", cause);
    return NextResponse.json(
      { error: { message: "Could not reset your contacted list." } },
      { status: 500 },
    );
  }
}
