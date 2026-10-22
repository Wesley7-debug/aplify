import { searchBusinesses, type BusinessDbRow } from "@/lib/db";
import { assessConfidence, normalizeEmail } from "@/lib/osm/email";
import { matchAudience, relatedTradeKeys, tradeKeyForAudience } from "@/lib/osm/tags";
import type { EmailSource, Lead, SearchResult } from "@/lib/types";

/**
 * Database-only search. No live Overpass call happens on this path — results
 * are whatever the crawler has already collected, returned in milliseconds.
 */

export const MAX_LIMIT = 30;
/** Everyone except the owner gets at most 10 contacts per request. */
export const USER_MAX_LIMIT = 10;

export function clampLimit(value: number, max = MAX_LIMIT): number {
  return Math.min(Math.max(Math.round(value || 10), 1), max);
}

export function clampPage(value: number): number {
  return Math.min(Math.max(Math.round(value || 1), 1), 2_000);
}

function displayOf(row: BusinessDbRow): string {
  return [row.city, row.country].filter(Boolean).join(", ") || row.region || "Unknown location";
}

function emailSourceOf(row: BusinessDbRow): EmailSource | null {
  if (!row.email) return null;
  if (row.email_source === "osm") return "osm-tag";
  if (row.email_source === "overture") return "overture";
  return "website-text";
}

export function leadFromRow(row: BusinessDbRow): Lead | null {
  const email = normalizeEmail(row.email ?? "");
  const phone = row.phone?.trim() || null;
  if (!email && !phone) return null;

  const overture = row.id.startsWith("overture/");
  const confidence = email
    ? assessConfidence(email, {
        phone: Boolean(row.phone),
        address: Boolean(row.address),
      })
    : {
        level: "medium" as const,
        reason:
          "A phone number published on a public map record. No website or email was listed.",
      };

  return {
    id: row.id,
    businessName: row.name,
    category: row.category ?? "Business",
    location: {
      city: row.city,
      region: row.region,
      country: row.country,
      display: displayOf(row),
      lat: row.lat,
      lon: row.lon,
    },
    email: email || null,
    emailSource: emailSourceOf(row),
    emailIsRole: email ? Boolean(row.email_is_role) : false,
    emailSyntaxValid: Boolean(email),
    confidence: row.confidence ?? confidence.level,
    confidenceReason: email ? confidence.reason : confidence.reason,
    phone,
    address: row.address,
    // Results are restricted to businesses without a published website.
    website: null,
    source: {
      name: overture ? "Overture Maps" : "OpenStreetMap",
      url: row.source_url,
      license: overture ? "CDLA-Permissive 2.0" : "ODbL 1.0",
      retrievedAt: row.updated_at,
    },
  };
}

export interface SearchOptions {
  audience: string;
  location: string;
  limit: number;
  page: number;
  seenIds: string[];
  /** Already-contacted ids, filtered out server-side. */
  excludeIds?: string[];
  /** Hard cap for this caller (10 for guests, 30 for the owner). */
  maxLimit?: number;
}

export async function runSearch(options: SearchOptions): Promise<SearchResult> {
  const limit = clampLimit(options.limit, options.maxLimit ?? MAX_LIMIT);
  const page = clampPage(options.page);
  const offset = (page - 1) * limit;

  const match = matchAudience(options.audience);
  const exactTradeKey = tradeKeyForAudience(options.audience);
  const tradeKeys = [
    exactTradeKey,
    ...relatedTradeKeys(match).filter((key) => key !== exactTradeKey),
  ];

  const seenIds = options.seenIds
    .map((value) => value.trim())
    .filter((value) => value && !value.includes("@"));
  const excludeIds = (options.excludeIds ?? [])
    .map((value) => value.trim())
    .filter((value) => value && !value.includes("@"));

  const { rows, total, excluded } = await searchBusinesses({
    tradeKeys,
    location: options.location,
    exactTradeKey,
    limit,
    offset,
    seenIds,
    excludeIds,
  });

  const leads = rows
    .map((row) => leadFromRow(row))
    .filter((lead): lead is Lead => lead !== null);

  const hasMore = offset + rows.length < total;
  const hint =
    total === 0
      ? "We're still collecting data for this area. A new area usually fills in after the next crawl."
      : !hasMore
        ? "We're still collecting data for this area — this is everything with a valid public email or phone so far."
        : null;

  const diagnostics = {
    businessesFound: total,
    withWebsite: 0,
    withEmail: total,
    websitesChecked: 0,
    sourcesTried: ["database"],
    mirrorsFailed: 0,
    excluded: excluded + seenIds.length,
    widened: 0,
  };

  return {
    query: { audience: options.audience, location: options.location, limit },
    leads,
    count: leads.length,
    generatedAt: new Date().toISOString(),
    outcome: leads.length > 0 ? "success" : "no_businesses_found",
    diagnostics,
    message: hint,
    exhausted: !hasMore,
    page,
    hasMore,
    hint,
    total,
  };
}
