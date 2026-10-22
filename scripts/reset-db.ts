/**
 * Remove every seeded row from the active database.
 *
 *   npm run db:reset
 *
 * Clears both the local SQLite file and the configured Turso database. The
 * schema stays in place, so the next seed can start clean.
 */

import { loadEnvFile } from "node:process";
import { DatabaseSync } from "node:sqlite";
import { createClient } from "@libsql/client/web";

try {
  loadEnvFile(".env.local");
} catch {
  // Shell environment variables are also accepted.
}

const TABLES = [
  "seen_businesses",
  "search_events",
  "crawl_jobs",
  "crawl_cursor",
  "businesses",
];

function countLocal(db: DatabaseSync, table: string): number {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number } | undefined;
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

async function resetLocal(): Promise<void> {
  const db = new DatabaseSync("data/aplify.db");
  const before = Object.fromEntries(TABLES.map((table) => [table, countLocal(db, table)]));
  for (const table of TABLES) {
    try {
      db.prepare(`DELETE FROM ${table}`).run();
    } catch {
      // Table may not exist in an older schema.
    }
  }
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.exec("VACUUM");
  console.log("Local SQLite cleared:", before);
  db.close();
}

async function resetTurso(): Promise<void> {
  const url = (process.env.TURSO_DATABASE_URL ?? "").trim();
  const token = (process.env.TURSO_AUTH_TOKEN ?? "").trim();
  if (!url || !token || url.startsWith("file:")) {
    console.log("Turso not configured; skipped remote reset.");
    return;
  }

  const client = createClient({ url, authToken: token });
  const before: Record<string, number> = {};
  for (const table of TABLES) {
    const result = await client.execute(`SELECT COUNT(*) AS n FROM ${table}`).catch(() => null);
    before[table] = Number(result?.rows[0]?.n ?? 0);
  }
  await client.batch(
    TABLES.map((table) => ({ sql: `DELETE FROM ${table}`, args: [] })),
    "write",
  );
  const after: Record<string, number> = {};
  for (const table of TABLES) {
    const result = await client.execute(`SELECT COUNT(*) AS n FROM ${table}`).catch(() => null);
    after[table] = Number(result?.rows[0]?.n ?? 0);
  }
  console.log("Turso cleared:", { before, after });
  client.close();
}

async function main(): Promise<void> {
  await resetLocal();
  await resetTurso();
  console.log("Database is empty. Run a seed when the real no-website contact data is ready.");
}

main().catch((cause) => {
  console.error("Reset failed:", cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
