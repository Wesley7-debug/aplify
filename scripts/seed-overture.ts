/**
 * Seed real Nigerian businesses from the free, open Overture Maps places
 * dataset (CDLA-Permissive 2.0). No API key and no paid service are used.
 *
 *   npx tsx scripts/seed-overture.ts --target=3200
 *
 * A row is kept only when it has a phone number or email and publishes no
 * website. The query is pushed down to Overture's public S3 parquet files by
 * DuckDB, so only the Nigeria bounding box is read.
 */

import { DuckDBConnection } from "@duckdb/node-api";
import {
  closeDb,
  countBusinesses,
  countWithEmail,
  ensureDb,
  upsertBusinesses,
  type BusinessUpsert,
} from "../lib/db";
import { humanizeCategory, normalizeTradeKey } from "../lib/osm/tags";
import { normalizeEmail } from "../lib/osm/email";
import type { ConfidenceLevel } from "../lib/types";

const RELEASE = "2026-09-23.1";
const PLACES = `s3://overturemaps-us-west-2/release/${RELEASE}/theme=places/type=place/*.parquet`;

const NON_COMMERCIAL = [
  "religious_organization",
  "christian_place_of_worship",
  "place_of_worship",
  "place_of_learning",
  "education",
  "college_university",
  "high_school",
  "elementary_school",
  "specialty_school",
  "educational_service",
  "government_office",
  "civic_organization",
  "social_or_community_service",
  "historic_site",
  "arts_and_entertainment",
  "public_and_government",
];

/** Overture categories mapped onto the trade keys the search UI already uses. */
const TRADE_BY_CATEGORY: Record<string, string> = {
  restaurant: "restaurant",
  casual_eatery: "restaurant",
  fast_food_restaurant: "fast-food",
  bar: "bar",
  lounge: "bar",
  hotel: "hotel",
  lodging: "hotel",
  fashion_and_apparel_store: "clothes",
  electronics_store: "electronics",
  pharmacy_and_drug_store: "pharmacy",
  hospital: "hospital",
  health_care: "clinic",
  personal_or_beauty_service: "beauty",
  personal_care_and_beauty_store: "beauty",
  wellness_service: "spa",
  real_estate_service: "estate-agent",
  professional_service: "company",
  corporate_or_business_office: "company",
  shopping: "convenience",
  shopping_mall: "mall",
  food_and_beverage_store: "supermarket",
  hardware_home_and_garden_store: "hardware",
  home_service: "company",
  media_service: "company",
  building_or_construction_service: "builder",
  automotive_service: "car-repair",
  auto_dealer: "car",
  printing_service: "printing",
  technical_service: "company",
  financial_service: "financial",
  bank_or_credit_union: "bank",
  travel_service: "travel-agency",
  design_service: "company",
  b2b_transportation_and_storage_service: "logistics",
  b2b_service: "company",
  b2b_office_and_professional_service: "company",
  laundry_service: "laundry",
  manufacturer: "company",
  supplier_or_distributor: "company",
  farm: "farm",
  event_or_party_service: "restaurant",
  books_music_and_video_store: "books",
  arts_crafts_and_hobby_store: "art",
  agricultural_service: "farm",
};

interface OvertureRow {
  id: string;
  name: string;
  category: string | null;
  phones: string[] | null;
  emails: string[] | null;
  address: string | null;
  city: string | null;
  region: string | null;
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  confidence: number | null;
}

function readTarget(): number {
  for (const argument of process.argv) {
    const match = argument.match(/^--target=(\d+)$/);
    if (match) return Math.max(1, Number(match[1]));
  }
  const index = process.argv.indexOf("--target");
  if (index !== -1) {
    const value = Number(process.argv[index + 1]);
    if (Number.isFinite(value) && value > 0) return Math.round(value);
  }
  return 3200;
}

function confidenceOf(value: number | null): ConfidenceLevel {
  if (value === null) return "medium";
  if (value >= 0.8) return "high";
  if (value >= 0.5) return "medium";
  return "low";
}

function firstPhone(phones: string[] | null): string | null {
  for (const phone of phones ?? []) {
    const value = phone.trim();
    if (value) return value.slice(0, 80);
  }
  return null;
}

function firstEmail(emails: string[] | null): string | null {
  for (const email of emails ?? []) {
    const value = normalizeEmail(email);
    if (value) return value;
  }
  return null;
}

function tradeKeyOf(category: string | null): string {
  if (!category) return "business";
  return TRADE_BY_CATEGORY[category] ?? normalizeTradeKey(category);
}

function toBusiness(row: OvertureRow): BusinessUpsert | null {
  const name = row.name?.trim();
  if (!name) return null;

  const phone = firstPhone(row.phones);
  const email = firstEmail(row.emails);
  if (!phone && !email) return null;

  const category = row.category ? humanizeCategory({}, row.category) : "Business";
  const lat = (row.ymin + row.ymax) / 2;
  const lon = (row.xmin + row.xmax) / 2;

  return {
    id: `overture/${row.id}`,
    name,
    category,
    tradeKey: tradeKeyOf(row.category),
    city: row.city?.trim() || "Nigeria",
    region: row.region?.trim() || null,
    country: "Nigeria",
    lat,
    lon,
    address: row.address?.trim() || null,
    phone,
    website: null,
    email,
    emailSource: email ? "overture" : null,
    emailIsRole: false,
    confidence: confidenceOf(row.confidence),
    sourceUrl: "https://explore.overturemaps.org/",
  };
}

async function main(): Promise<void> {
  const target = readTarget();
  await ensureDb();
  const beforeBusinesses = await countBusinesses();
  const beforeEmails = await countWithEmail();

  console.log(`Querying Overture ${RELEASE} for Nigeria…`);
  const connection = await DuckDBConnection.create();
  await connection.run("INSTALL httpfs; LOAD httpfs;");
  await connection.run("SET s3_region = 'us-west-2';");
  await connection.run("SET s3_use_ssl = true;");

  const excluded = NON_COMMERCIAL.map((category) => `'${category}'`).join(", ");
  const reader = await connection.runAndReadAll(
    `WITH candidates AS (
       SELECT
         id,
         names.primary AS name,
         basic_category AS category,
         phones,
         emails,
         addresses[1].freeform AS address,
         addresses[1].locality AS city,
         addresses[1].region AS region,
         bbox.xmin AS xmin,
         bbox.xmax AS xmax,
         bbox.ymin AS ymin,
         bbox.ymax AS ymax,
         confidence,
         row_number() OVER (
           PARTITION BY lower(names.primary),
             coalesce(phones[1], emails[1])
           ORDER BY confidence DESC
         ) AS rn
       FROM read_parquet('${PLACES}')
       WHERE bbox.xmin >= 2.6 AND bbox.xmax <= 14.7
         AND bbox.ymin >= 4.2 AND bbox.ymax <= 13.9
         AND addresses[1].country = 'NG'
         AND names.primary IS NOT NULL
         AND basic_category IS NOT NULL
         AND basic_category NOT IN (${excluded})
         AND coalesce(len(websites), 0) = 0
         AND (coalesce(len(phones), 0) > 0 OR coalesce(len(emails), 0) > 0)
     )
     SELECT id, name, category, phones, emails, address, city, region,
            xmin, xmax, ymin, ymax, confidence
     FROM candidates
     WHERE rn = 1
     ORDER BY confidence DESC NULLS LAST
     LIMIT ${target}`,
  );

  const rows = reader.getRowObjectsJson() as unknown as OvertureRow[];
  connection.closeSync();
  console.log(`Fetched ${rows.length.toLocaleString()} candidates; validating and writing…`);

  let written = 0;
  for (let index = 0; index < rows.length; index += 250) {
    const batch = rows
      .slice(index, index + 250)
      .map(toBusiness)
      .filter((row): row is BusinessUpsert => row !== null);
    written += await upsertBusinesses(batch);
    if (written % 500 < 250) {
      console.log(`  ${written.toLocaleString()} / ${target.toLocaleString()}`);
    }
  }

  const afterBusinesses = await countBusinesses();
  const afterEmails = await countWithEmail();
  console.log("");
  console.log(
    `Businesses: ${beforeBusinesses.toLocaleString()} -> ${afterBusinesses.toLocaleString()} ` +
      `(+${(afterBusinesses - beforeBusinesses).toLocaleString()})`,
  );
  console.log(
    `With validated email: ${beforeEmails.toLocaleString()} -> ${afterEmails.toLocaleString()} ` +
      `(+${(afterEmails - beforeEmails).toLocaleString()})`,
  );
  console.log("Next: npm run seed:turso");
}

main()
  .catch((cause) => {
    console.error("Overture seed failed:", cause);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb().catch(() => undefined);
  });
