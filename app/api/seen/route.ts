import { connection, NextRequest, NextResponse } from "next/server";
import { clearSeen, countSeen, markSeen } from "@/lib/db";
import { ipUserKey } from "@/lib/identity";

/**
 * Mark a business as contacted, or clear the caller's contacted list.
 *
 * The key is the caller's IP address. Contacted businesses are stored in
 * SQLite/Turso and filtered out of future searches, so the same network is
 * never shown an inbox it has already emailed.
 */

export async function POST(request: NextRequest) {
  await connection();

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
    const userKey = ipUserKey(request);
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

export async function DELETE(request: NextRequest) {
  await connection();

  try {
    const userKey = ipUserKey(request);
    const cleared = await clearSeen(userKey);
    return NextResponse.json({ ok: true, cleared });
  } catch (cause) {
    console.error("[seen] database error", cause);
    return NextResponse.json(
      { error: { message: "Could not reset your contacted list." } },
      { status: 500 },
    );
  }
}
