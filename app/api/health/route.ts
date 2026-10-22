import { connection } from "next/server";
import { countBusinesses, countWithEmail, dbTarget, ensureDb } from "@/lib/db";

/** Lightweight health probe: database reachable + counts. */
export async function GET() {
  await connection();

  try {
    await ensureDb();
    const [businesses, withEmail] = await Promise.all([countBusinesses(), countWithEmail()]);
    const target = dbTarget();
    return Response.json(
      {
        ok: true,
        database: { kind: target.kind, label: target.label },
        counts: { businesses, withEmail },
        timestamp: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    return Response.json(
      {
        ok: false,
        error: cause instanceof Error ? cause.message : "Database unavailable",
        timestamp: new Date().toISOString(),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
