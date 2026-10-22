import type { OsmFilter } from "@/lib/osm/tags";

/**
 * Polite Overpass client for the background crawler.
 *
 * - three public mirrors raced with `Promise.any`
 * - 15s timeout per request, 429/5xx retried with backoff
 * - at most one request per second per host
 * - a descriptive User-Agent with a contact page
 */

const USER_AGENT =
  "AplifyCrawler/1.0 (free business-email directory; +https://github.com/aplify; contact: admin@aplify.local)";

const DEFAULT_MIRRORS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const ENV_MIRRORS = (process.env.APLIFY_OVERPASS_MIRRORS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const MIRRORS = ENV_MIRRORS.length >= 1 ? ENV_MIRRORS : DEFAULT_MIRRORS;

const REQUEST_TIMEOUT_MS = 15_000;
const HOST_INTERVAL_MS = 1_000;
const MAX_RETRIES = 2;

export interface OverpassElement {
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

export type Bbox = [south: number, west: number, north: number, east: number];

const hostChains = new Map<string, Promise<void>>();
const hostLastStart = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serialise the *start* of requests per host to one per second. */
async function schedule(host: string): Promise<void> {
  const previous = hostChains.get(host) ?? Promise.resolve();
  const next = previous.then(async () => {
    const elapsed = Date.now() - (hostLastStart.get(host) ?? 0);
    const wait = Math.max(0, HOST_INTERVAL_MS - elapsed);
    if (wait > 0) await sleep(wait);
    hostLastStart.set(host, Date.now());
  });
  hostChains.set(
    host,
    next.catch(() => undefined),
  );
  await next;
}

function combineSignals(timeoutMs: number, outer: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    return AbortSignal.any([timeout, outer]);
  } catch {
    return timeout;
  }
}

async function postOnce(
  endpoint: string,
  query: string,
  signal: AbortSignal,
): Promise<OverpassElement[]> {
  const host = new URL(endpoint).host;
  await schedule(host);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    body: new URLSearchParams({ data: query }).toString(),
    signal: combineSignals(REQUEST_TIMEOUT_MS, signal),
  });

  if (response.status === 429 || response.status >= 500) {
    throw new RetryableError(`Overpass mirror ${host} responded with ${response.status}.`);
  }
  if (!response.ok) {
    throw new Error(`Overpass mirror ${host} responded with ${response.status}.`);
  }

  const payload = (await response.json()) as OverpassResponse;
  if (!Array.isArray(payload.elements)) {
    throw new RetryableError(payload.remark ?? `Malformed payload from ${host}.`);
  }
  return payload.elements;
}

class RetryableError extends Error {}

async function postWithRetry(
  endpoint: string,
  query: string,
  signal: AbortSignal,
): Promise<OverpassElement[]> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (signal.aborted) throw new Error("Crawl cancelled.");
    try {
      return await postOnce(endpoint, query, signal);
    } catch (cause) {
      lastError = cause;
      if (signal.aborted) throw cause;
      if (!(cause instanceof RetryableError) || attempt === MAX_RETRIES) break;
      await sleep(1_500 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Overpass request failed.");
}

export function buildTileQuery(filters: OsmFilter[], bbox: Bbox): string {
  const [south, west, north, east] = bbox;
  const box = `(${south},${west},${north},${east})`;
  const clauses =
    filters.length > 0
      ? filters.map((filter) => `nwr["${filter.key}"="${filter.value}"]${box};`).join("")
      : `nwr["name"]${box};`;
  // Every business of the trade, whether or not it publishes an email.
  return `[out:json][timeout:40];(${clauses});out center tags 400;`;
}

/** Race the mirrors; only a real payload wins. */
export async function queryOverpass(query: string, signal: AbortSignal): Promise<OverpassElement[]> {
  if (signal.aborted) throw new Error("Crawl cancelled.");

  const attempts = MIRRORS.map((endpoint) =>
    postWithRetry(endpoint, query, signal).catch((cause) => {
      throw cause instanceof Error ? cause : new Error(String(cause));
    }),
  );

  try {
    return await Promise.any(attempts);
  } catch {
    throw new Error("All Overpass mirrors failed for this tile.");
  }
}

/** Split a bounding box into ~0.1 degree tiles. */
export function tilesFor(bbox: Bbox, maxSide = 0.1): Bbox[] {
  const [south, west, north, east] = bbox;
  const height = Math.max(0.0001, north - south);
  const width = Math.max(0.0001, east - west);
  const rows = Math.max(1, Math.ceil(height / maxSide));
  const cols = Math.max(1, Math.ceil(width / maxSide));
  const tiles: Bbox[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      tiles.push([
        south + (height * row) / rows,
        west + (width * col) / cols,
        south + (height * (row + 1)) / rows,
        west + (width * (col + 1)) / cols,
      ]);
    }
  }

  return tiles;
}
