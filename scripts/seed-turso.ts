/**
 * Copy the already-seeded local SQLite database into Turso.
 *
 *   npm run seed:turso
 *
 * Requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env.local (or the shell).
 * This avoids re-downloading the 700 MB Nigeria PBF just to populate Turso.
 */

import { loadEnvFile } from "node:process";
import { DatabaseSync } from "node:sqlite";
import {
  closeDb,
  countBusinesses,
  countWithEmail,
  ensureDb,
  upsertBusinesses,
  type BusinessUpsert,
} from "../lib/db";
import type { ConfidenceLevel } from "../lib/types";

try {
  loadEnvFile(".env.local");
} catch {
  try {
    loadEnvFile(".env");
  } catch {
    // Shell environment variables are also accepted.
  }
}

interface LocalRow {
  id: string;
  name: string;
  category: string | null;
  trade_key: string;
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  email_is_role: number;
  email_source: "osm" | "overture" | "website" | null;
  email_validated_at: string | null;
  email_validation: string | null;
  confidence: ConfidenceLevel | null;
  source_url: string;
  website_checked_at: string | null;
}

const BATCH_SIZE = 200;

async function main(): Promise<void> {
  const url = (process.env.TURSO_DATABASE_URL ?? "").trim();
  const token = (process.env.TURSO_AUTH_TOKEN ?? "").trim();

  if (!url || !token) {
    throw new Error(
      "Turso is not configured. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env.local.",
    );
  }
  if (url.startsWith("file:")) {
    throw new Error("TURSO_DATABASE_URL points at a local file, not Turso.");
  }

  const local = new DatabaseSync("data/aplify.db", { readOnly: true });
  const rows = local.prepare("SELECT * FROM businesses ORDER BY updated_at ASC").all() as unknown as LocalRow[];
  local.close();

  console.log(`Copying ${rows.length.toLocaleString()} businesses to ${url}…`);
  await ensureDb();

  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch: BusinessUpsert[] = rows.slice(index, index + BATCH_SIZE).map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      tradeKey: row.trade_key,
      city: row.city,
      region: row.region,
      country: row.country,
      lat: row.lat,
      lon: row.lon,
      address: row.address,
      phone: row.phone,
      website: row.website,
      email: row.email,
      emailSource: row.email_source,
      emailIsRole: Boolean(row.email_is_role),
      confidence: row.confidence ?? (row.email ? "low" : "medium"),
      emailValidatedAt: row.email_validated_at,
      emailValidation: row.email_validation,
      sourceUrl: row.source_url,
      websiteCheckedAt: row.website_checked_at,
    }));
    await upsertBusinesses(batch);
    console.log(`  ${Math.min(index + BATCH_SIZE, rows.length).toLocaleString()} / ${rows.length.toLocaleString()}`);
  }

  console.log(
    `Turso now has ${(await countBusinesses()).toLocaleString()} businesses and ` +
      `${(await countWithEmail()).toLocaleString()} validated emails.`,
  );
}

main()
  .catch((cause) => {
    console.error("Turso seed failed:", cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb().catch(() => undefined);
  });
