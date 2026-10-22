import { connection, NextRequest, NextResponse } from "next/server";
import { countSeen, markSeen } from "@/lib/db";
import { emailUserKey } from "@/lib/identity";
import { authenticatedEmail } from "@/lib/user-auth";

/**
 * Record that the signed-in user opened a lead's email or phone action.
 *
 * Fetched leads are already marked as seen by /api/search, so this endpoint is
 * only a confirmation for the current interaction. It never deletes history;
 * leads are not recycled.
 */
export async function POST(request: NextRequest) {
  await connection();

  const email = await authenticatedEmail(request);
  if (!email) {
    return NextResponse.json(
      { error: { message: "Enter your email to continue." }, outcome: "auth_required" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: { leadId?: unknown; email?: unknown } = {};
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
    const userKey = emailUserKey(email);
    const leadEmail =
      typeof body.email === "string" && body.email.length <= 254
        ? body.email.trim().toLowerCase()
        : null;

    await markSeen(userKey, [{ id: leadId, email: leadEmail }]);
    return NextResponse.json({
      ok: true,
      seen: await countSeen(userKey),
    });
  } catch (cause) {
    console.error("[seen] database error", cause);
    return NextResponse.json(
      { error: { message: "Could not update your contacted list." } },
      { status: 500 },
    );
  }
}
