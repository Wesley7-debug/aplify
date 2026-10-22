import { BUSINESS_TTL, getCached, setCached } from "@/lib/cache/file-cache";
import { SearchServiceError } from "@/lib/discovery/errors";
import type { Candidate, DiscoveryResult } from "@/lib/discovery/types";
import { firstEmail, isSyntaxValid, normalizeEmail } from "@/lib/osm/email";
import type { GeoPlace } from "@/lib/osm/geocode";
import {
  BUSINESS_KEYS,
  filtersKey,
  humanizeCategory,
  keyPhrase,
  type OsmFilter,
} from "@/lib/osm/tags";

/**
 * Overpass business discovery.
 *
 * The email filter is deliberately NOT part of the query: we first find every
 * business in the area, then enrich each one. That is what lets us report
 * "businesses found but no public email" instead of a false zero.
 *
 * Each query is fired at three global mirrors in parallel with an 8s abort, and
 * large areas are split into tiles (max 4 concurrent) to keep every request
 * small enough to finish quickly.
 */

const USER_AGENT = "Aplify/1.0 (business email finder; https://github.com/aplify)";

const DEFAULT_MIRRORS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const MIRRORS = (process.env.APLIFY_OVERPASS_MIRRORS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const MIRROR_LIST = MIRRORS.length >= 3 ? MIRRORS.slice(0, 3) : DEFAULT_MIRRORS;

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_TILE_SIDE = 0.15;
const MAX_TILES = 16;
const TILE_CONCURRENCY = 4;
/** Sequential retries when a whole wave failed (one busy mirror can queue 4 requests past 8s). */
const RETRY_TILES = 2;

export type Bbox = [south: number, west: number, north: number, east: number];

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
  remark?: string;
}

export interface MirrorStats {
  mirrorsFailed: number;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildQuery(filters: OsmFilter[], audience: string, bbox: Bbox): string {
  const [south, west, north, east] = bbox;
  const box = `(${south},${west},${north},${east})`;

  let clause: string;
  if (filters.length > 0) {
    clause = filters
      .map((filter) => `nwr["${filter.key}"="${filter.value}"]${box};`)
      .join("");
  } else {
    const keyword = escapeRegex(keyPhrase(audience) || audience.trim().toLowerCase());
    const keys = BUSINESS_KEYS.join("|");
    clause = `nwr[~"^(${keys})$"~"."][name~"${keyword}",i]${box};`;
  }

  return `[out:json][timeout:30];(${clause});out center tags 300;`;
}

function queryCacheKey(filters: OsmFilter[], audience: string): string {
  return filters.length > 0 ? `filters:${filtersKey(filters)}` : `name:${keyPhrase(audience)}`;
}

function requestSignal(timeoutMs: number, outer: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    return AbortSignal.any([timeout, outer]);
  } catch {
    return timeout;
  }
}

async function postToMirror(
  endpoint: string,
  query: string,
  signal: AbortSignal,
): Promise<OverpassElement[]> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    body: new URLSearchParams({ data: query }).toString(),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Mirror responded with ${response.status}.`);
  }

  const data = (await response.json()) as OverpassResponse;
  if (!Array.isArray(data.elements)) {
    throw new Error(data.remark ?? "Mirror returned a malformed payload.");
  }
  return data.elements;
}

/**
 * Race the same query at every mirror. Only a real successful payload wins;
 * all failures reject, so callers can report a service error rather than empty.
 */
async function queryMirrors(
  query: string,
  signal: AbortSignal,
  stats: MirrorStats,
): Promise<OverpassElement[]> {
  if (signal.aborted) {
    throw new SearchServiceError("The search was cancelled.", "internal");
  }

  if (process.env.APLIFY_FORCE_MIRROR_FAILURE === "1") {
    stats.mirrorsFailed += MIRROR_LIST.length;
    throw new SearchServiceError(
      "The map data mirrors are unreachable right now. Please try again in a moment.",
      "mirrors_failed",
    );
  }

  const local = new AbortController();
  const onOuterAbort = () => local.abort();
  signal.addEventListener("abort", onOuterAbort, { once: true });

  try {
    const attempts = MIRROR_LIST.map(async (endpoint) => {
      try {
        const elements = await postToMirror(
          endpoint,
          query,
          requestSignal(REQUEST_TIMEOUT_MS, local.signal),
        );
        return elements;
      } catch (cause) {
        // Requests aborted because another mirror already won are not failures.
        if (!local.signal.aborted) stats.mirrorsFailed += 1;
        throw cause;
      }
    });

    try {
      return await Promise.any(attempts);
    } catch {
      throw new SearchServiceError(
        "The map data mirrors are unreachable right now. Please try again in a moment.",
        "mirrors_failed",
      );
    } finally {
      // Free the slower mirrors as soon as one has answered.
      local.abort();
    }
  } finally {
    signal.removeEventListener("abort", onOuterAbort);
  }
}

/** Split a bounding box so no side exceeds `maxSide` degrees. */
export function tilesForBbox(
  bbox: Bbox,
  maxSide = MAX_TILE_SIDE,
  maxTiles = MAX_TILES,
): Bbox[] {
  const [south, west, north, east] = bbox;
  const height = Math.max(0.0001, north - south);
  const width = Math.max(0.0001, east - west);

  let rows = Math.max(1, Math.ceil(height / maxSide));
  let cols = Math.max(1, Math.ceil(width / maxSide));

  while (rows * cols > maxTiles) {
    if (rows >= cols && rows > 1) rows -= 1;
    else if (cols > 1) cols -= 1;
    else break;
  }

  const tiles: Bbox[] = [];
  for (let row = 0; row < rows; row += 1) {
    const tileSouth = south + (height * row) / rows;
    const tileNorth = south + (height * (row + 1)) / rows;
    for (let col = 0; col < cols; col += 1) {
      const tileWest = west + (width * col) / cols;
      const tileEast = west + (width * (col + 1)) / cols;
      tiles.push([tileSouth, tileWest, tileNorth, tileEast]);
    }
  }
  return tiles;
}

/** Grow a box by `degrees` on every side (used for widening). */
export function expandBbox(bbox: Bbox, degrees: number): Bbox {
  const [south, west, north, east] = bbox;
  return [
    Math.max(-90, south - degrees),
    Math.max(-180, west - degrees),
    Math.min(90, north + degrees),
    Math.min(180, east + degrees),
  ];
}

async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const size = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: size }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      await worker(items[current]);
    }
  });
  await Promise.all(workers);
}

function normalizeWebsite(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed || /^mailto:/i.test(trimmed)) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^www\./i.test(trimmed) || /^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return null;
}

function toCandidate(
  element: OverpassElement,
  place: GeoPlace,
  audience: string,
): Candidate | null {
  const tags = element.tags ?? {};
  const name = (tags.name ?? tags["name:en"] ?? tags.brand ?? "").trim();
  if (!name) return null;

  const rawEmail = firstEmail(tags.email ?? tags["contact:email"] ?? "");
  const normalizedEmail = rawEmail ? normalizeEmail(rawEmail) : "";
  const publishedEmail =
    normalizedEmail && isSyntaxValid(normalizedEmail) ? normalizedEmail : null;

  const phone = (tags.phone ?? tags["contact:phone"] ?? "").trim() || null;
  const website = normalizeWebsite(tags.website ?? tags["contact:website"]);

  const addressParts = [
    tags["addr:housenumber"],
    tags["addr:street"],
    tags["addr:suburb"],
    tags["addr:city"],
  ].filter((part): part is string => Boolean(part && part.trim()));
  const address = addressParts.length > 0 ? addressParts.join(", ") : null;

  const city = tags["addr:city"] ?? place.city ?? null;
  const region = tags["addr:state"] ?? tags["addr:province"] ?? place.region ?? null;
  const country = tags["addr:country"] ?? place.country ?? null;
  const display = [city, country].filter(Boolean).join(", ") || place.display;

  return {
    id: `osm:${element.type}/${element.id}`,
    businessName: name,
    category: humanizeCategory(tags, audience),
    website,
    phone,
    address,
    city,
    region,
    country,
    display,
    lat: element.lat ?? element.center?.lat ?? null,
    lon: element.lon ?? element.center?.lon ?? null,
    publishedEmail,
    sourceName: "OpenStreetMap",
    sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    sourceLicense: "ODbL 1.0",
    retrievedAt: new Date().toISOString(),
  };
}

export interface OverpassDiscoveryOptions {
  filters: OsmFilter[];
  audience: string;
  place: GeoPlace;
  bbox: Bbox;
  signal: AbortSignal;
  stats: MirrorStats;
}

export async function discoverOverpass(
  options: OverpassDiscoveryOptions,
): Promise<DiscoveryResult> {
  const { filters, audience, place, bbox, signal, stats } = options;
  const tiles = tilesForBbox(bbox);
  const cachePrefix = queryCacheKey(filters, audience);

  const seen = new Map<string, OverpassElement>();
  let tileSuccesses = 0;
  let tileFailures = 0;

  const fetchTile = async (tile: Bbox): Promise<boolean> => {
    if (signal.aborted) return false;

    const cacheKey = `osm:v2:${cachePrefix}:${tile.join(",")}`;
    const cached = await getCached<OverpassElement[]>(cacheKey);
    if (cached) {
      tileSuccesses += 1;
      for (const element of cached) seen.set(`${element.type}/${element.id}`, element);
      return true;
    }

    try {
      const elements = await queryMirrors(buildQuery(filters, audience, tile), signal, stats);
      tileSuccesses += 1;
      if (elements.length > 0) {
        await setCached(cacheKey, elements, BUSINESS_TTL);
      }
      for (const element of elements) seen.set(`${element.type}/${element.id}`, element);
      return true;
    } catch {
      tileFailures += 1;
      return false;
    }
  };

  await runPool(tiles, TILE_CONCURRENCY, async (tile) => {
    await fetchTile(tile);
  });

  if (signal.aborted) {
    return { candidates: [], sourcesTried: ["osm-live"], mirrorsFailed: stats.mirrorsFailed, partial: true };
  }

  // A single working mirror can queue a 4-way wave past the 8s abort. Retry a
  // couple of tiles one at a time before declaring an outage; a queue that has
  // drained usually answers well inside the budget.
  if (tileSuccesses === 0 && tileFailures > 0) {
    for (const tile of tiles.slice(0, RETRY_TILES)) {
      if (signal.aborted) break;
      if (await fetchTile(tile)) break;
    }
  }

  // Every tile failing is an outage, not an empty neighbourhood.
  if (tileSuccesses === 0 && tiles.length > 0) {
    throw new SearchServiceError(
      "The map data mirrors are unreachable right now. Please try again in a moment.",
      "mirrors_failed",
    );
  }

  const candidates: Candidate[] = [];
  for (const element of seen.values()) {
    const candidate = toCandidate(element, place, audience);
    if (candidate) candidates.push(candidate);
  }

  return {
    candidates,
    sourcesTried: ["osm-live"],
    mirrorsFailed: stats.mirrorsFailed,
    partial: tileFailures > 0,
  };
}
