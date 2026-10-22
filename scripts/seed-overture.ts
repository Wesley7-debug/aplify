/**
 * Seed real Nigerian businesses from the free, open Overture Maps places
 * dataset (CDLA-Permissive 2.0). No API key and no paid service are used.
 *
 *   npx tsx scripts/seed-overture.ts --target=3200
 *
 * A row is kept only when it has a phone number or email and publishes no
 * website. Overture's `region` field is mostly empty for Nigeria, so each
 * business is assigned to one of the 36 states + FCT using the openly licensed
 * geoBoundaries state polygons. Selection is balanced across every state.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const STATE_BOUNDARIES_URL =
  "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/NGA/ADM1/geoBoundaries-NGA-ADM1_simplified.geojson";
const STATE_BOUNDARIES_CACHE = "data/nigeria-states.geojson";

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
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  confidence: number | null;
}

type Position = [number, number];
/** [minLon, minLat, maxLon, maxLat] */
type BBox = [number, number, number, number];

interface Ring {
  points: Position[];
  bbox: BBox;
}

interface PolygonShape {
  rings: Ring[];
  bbox: BBox;
}

interface StateShape {
  name: string;
  polygons: PolygonShape[];
  bbox: BBox;
}

interface GeoJsonFeature {
  properties?: { shapeName?: string };
  geometry?: { type?: string; coordinates?: unknown };
}

interface GeoJson {
  features?: GeoJsonFeature[];
}

interface Candidate {
  business: BusinessUpsert;
  state: string;
  confidence: number;
}

const STATE_LABELS: Record<string, string> = {
  "Abuja Federal Capital Territory": "FCT",
};

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

function toBusiness(row: OvertureRow, state: string): BusinessUpsert | null {
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
    city: row.city?.trim() || state,
    region: state,
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

function toPositions(value: unknown): Position[] {
  if (!Array.isArray(value)) return [];
  const points: Position[] = [];
  for (const point of value) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const lon = Number(point[0]);
    const lat = Number(point[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) points.push([lon, lat]);
  }
  return points;
}

function bboxOf(points: Position[]): BBox {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of points) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

function unionBboxes(boxes: BBox[]): BBox {
  return [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3])),
  ];
}

function inBbox(lon: number, lat: number, box: BBox): boolean {
  return lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3];
}

function ringFrom(value: unknown): Ring {
  const points = toPositions(value);
  return { points, bbox: bboxOf(points) };
}

function polygonFrom(value: unknown): PolygonShape | null {
  if (!Array.isArray(value)) return null;
  const rings = value.map(ringFrom).filter((ring) => ring.points.length >= 4);
  if (rings.length === 0) return null;
  return { rings, bbox: rings[0].bbox };
}

function polygonsOf(geometry: { type?: string; coordinates?: unknown }): PolygonShape[] {
  if (geometry.type === "Polygon") {
    const polygon = polygonFrom(geometry.coordinates);
    return polygon ? [polygon] : [];
  }
  if (geometry.type === "MultiPolygon") {
    if (!Array.isArray(geometry.coordinates)) return [];
    return geometry.coordinates
      .map((polygon) => polygonFrom(polygon))
      .filter((polygon): polygon is PolygonShape => polygon !== null);
  }
  return [];
}

function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  if (!inBbox(lon, lat, ring.bbox)) return false;
  const points = ring.points;
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[previous];
    const crosses = y1 > lat !== y2 > lat;
    if (crosses && lon < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(lon: number, lat: number, polygon: PolygonShape): boolean {
  if (!inBbox(lon, lat, polygon.bbox)) return false;
  const [outer, ...holes] = polygon.rings;
  if (!outer || !pointInRing(lon, lat, outer)) return false;
  return !holes.some((hole) => pointInRing(lon, lat, hole));
}

function stateForPoint(lon: number, lat: number, states: StateShape[]): string | null {
  for (const state of states) {
    if (!inBbox(lon, lat, state.bbox)) continue;
    if (state.polygons.some((polygon) => pointInPolygon(lon, lat, polygon))) {
      return state.name;
    }
  }
  return null;
}

async function loadStates(): Promise<StateShape[]> {
  let raw: string;
  try {
    raw = readFileSync(STATE_BOUNDARIES_CACHE, "utf8");
  } catch {
    console.log("Downloading Nigeria state boundaries from geoBoundaries…");
    const response = await fetch(STATE_BOUNDARIES_URL);
    if (!response.ok) {
      throw new Error(`State boundary download failed: HTTP ${response.status}`);
    }
    raw = await response.text();
    mkdirSync("data", { recursive: true });
    writeFileSync(STATE_BOUNDARIES_CACHE, raw);
  }

  const geo = JSON.parse(raw) as GeoJson;
  const states: StateShape[] = [];
  for (const feature of geo.features ?? []) {
    const rawName = feature.properties?.shapeName?.trim();
    const geometry = feature.geometry;
    if (!rawName || !geometry) continue;
    const polygons = polygonsOf(geometry);
    if (polygons.length === 0) continue;
    states.push({
      name: STATE_LABELS[rawName] ?? rawName,
      polygons,
      bbox: unionBboxes(polygons.map((polygon) => polygon.bbox)),
    });
  }

  if (states.length < 30) {
    throw new Error(`Expected Nigeria's 37 state polygons, found ${states.length}.`);
  }
  return states.sort((left, right) => left.name.localeCompare(right.name));
}

function candidateOf(row: OvertureRow, states: StateShape[]): Candidate | null {
  const lat = (row.ymin + row.ymax) / 2;
  const lon = (row.xmin + row.xmax) / 2;
  const state = stateForPoint(lon, lat, states);
  if (!state) return null;
  const business = toBusiness(row, state);
  if (!business) return null;
  return { business, state, confidence: row.confidence ?? 0 };
}

/**
 * Round-robin across states so every state gets a first pick before any state
 * gets an 87th. If a state has fewer candidates, the extra picks go elsewhere.
 */
function selectBalanced(
  groups: Map<string, Candidate[]>,
  target: number,
): Candidate[] {
  const names = [...groups.keys()].sort((left, right) => left.localeCompare(right));
  const cap = Math.ceil(target / Math.max(names.length, 1));
  const selected: Candidate[] = [];

  for (let round = 0; round < cap; round += 1) {
    for (const name of names) {
      const candidate = groups.get(name)?.[round];
      if (!candidate) continue;
      selected.push(candidate);
      if (selected.length >= target) return selected;
    }
  }
  return selected;
}

async function main(): Promise<void> {
  const target = readTarget();
  await ensureDb();
  const beforeBusinesses = await countBusinesses();
  const beforeEmails = await countWithEmail();
  const states = await loadStates();

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
     SELECT id, name, category, phones, emails, address, city,
            xmin, xmax, ymin, ymax, confidence
     FROM candidates
     WHERE rn = 1
     ORDER BY confidence DESC NULLS LAST`,
  );

  const rows = reader.getRowObjectsJson() as unknown as OvertureRow[];
  connection.closeSync();
  console.log(`Fetched ${rows.length.toLocaleString()} no-website candidates.`);

  const groups = new Map<string, Candidate[]>();
  let outsideBoundaries = 0;
  for (const row of rows) {
    const candidate = candidateOf(row, states);
    if (!candidate) {
      outsideBoundaries += 1;
      continue;
    }
    const list = groups.get(candidate.state) ?? [];
    list.push(candidate);
    groups.set(candidate.state, list);
  }

  for (const list of groups.values()) {
    list.sort((left, right) => right.confidence - left.confidence);
  }

  const expectedStates = states.map((state) => state.name);
  const missing = expectedStates.filter((name) => !groups.has(name));
  const selected = selectBalanced(groups, target);
  const selectedCounts = new Map<string, number>();
  for (const candidate of selected) {
    selectedCounts.set(candidate.state, (selectedCounts.get(candidate.state) ?? 0) + 1);
  }

  console.log(
    `Assigned ${(rows.length - outsideBoundaries).toLocaleString()} candidates ` +
      `to ${groups.size} of ${states.length} states ` +
      `(${outsideBoundaries.toLocaleString()} outside boundaries).`,
  );
  if (missing.length > 0) {
    console.log(`No candidates found for: ${missing.join(", ")}`);
  }
  console.log(`Selected ${selected.length.toLocaleString()} businesses across ${selectedCounts.size} states:`);
  for (const name of [...selectedCounts.keys()].sort((left, right) => left.localeCompare(right))) {
    console.log(`  ${name}: ${selectedCounts.get(name)?.toLocaleString() ?? 0}`);
  }
  console.log("Writing to the database…");

  let written = 0;
  for (let index = 0; index < selected.length; index += 250) {
    const batch = selected.slice(index, index + 250).map((candidate) => candidate.business);
    written += await upsertBusinesses(batch);
    console.log(`  ${written.toLocaleString()} / ${selected.length.toLocaleString()}`);
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
