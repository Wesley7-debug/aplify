import { countWithEmail, getCursors, setCursor, upsertBusinesses, type BusinessUpsert } from "@/lib/db";
import { assessConfidence, firstEmail, isRoleAddress, isSyntaxValid, normalizeEmail } from "@/lib/osm/email";
import { humanizeCategory, matchAudience, tradeKeyForFilters } from "@/lib/osm/tags";
import { CRAWL_PLACES, CRAWL_TRADES, type CrawlPlace } from "@/lib/crawler/config";
import { buildTileQuery, queryOverpass, tilesFor, type OverpassElement } from "@/lib/crawler/overpass";

/**
 * Phase A: discover every business of a trade in one tile per (place, trade)
 * pair, rotating through pairs via `crawl_cursor`.
 */

export interface DiscoveryOptions {
  deadline: number;
  city?: string | null;
  trade?: string | null;
  signal: AbortSignal;
  isStopped: () => Promise<boolean>;
  onProgress: (progress: { scanned: number; added: number; message: string }) => void;
}

export interface DiscoverySummary {
  scanned: number;
  added: number;
  pairs: number;
  tiles: number;
  failures: number;
  stopped: boolean;
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

function addressOf(tags: Record<string, string>): string | null {
  const parts = [tags["addr:housenumber"], tags["addr:street"], tags["addr:suburb"]].filter(
    (part): part is string => Boolean(part && part.trim()),
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

export function toBusinessUpsert(
  element: OverpassElement,
  place: CrawlPlace,
  tradeKey: string,
  fallbackLabel: string,
): BusinessUpsert | null {
  const tags = element.tags ?? {};
  const name = (tags.name ?? tags["name:en"] ?? tags.brand ?? tags.operator ?? "").trim();
  if (!name) return null;

  const rawEmail = firstEmail(tags.email ?? tags["contact:email"] ?? "");
  const email = rawEmail ? normalizeEmail(rawEmail) : "";
  const valid = email && isSyntaxValid(email) ? email : null;
  const phone = (tags.phone ?? tags["contact:phone"] ?? "").trim() || null;
  const address = addressOf(tags);
  const confidence = valid
    ? assessConfidence(valid, { phone: Boolean(phone), address: Boolean(address) }).level
    : undefined;

  return {
    id: `${element.type}/${element.id}`,
    name,
    category: humanizeCategory(tags, fallbackLabel),
    tradeKey,
    city: place.city,
    region: place.region,
    country: place.country,
    lat: element.lat ?? element.center?.lat ?? null,
    lon: element.lon ?? element.center?.lon ?? null,
    address,
    phone,
    website: normalizeWebsite(tags.website ?? tags["contact:website"]),
    email: valid,
    emailSource: valid ? "osm" : null,
    emailIsRole: valid ? isRoleAddress(valid) : false,
    confidence,
    sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
  };
}

interface PairState {
  place: CrawlPlace;
  trade: string;
  tradeKey: string;
  filters: ReturnType<typeof matchAudience>["filters"];
  cursorKey: string;
  tile: number;
  cycle: number;
  lastRunAt: string;
}

function pairKey(place: CrawlPlace, tradeKey: string): string {
  return `pair:${place.name.toLowerCase().replace(/\s+/g, "-")}:${tradeKey}`;
}

function selectedPlaces(city: string | null | undefined): CrawlPlace[] {
  if (!city) return CRAWL_PLACES;
  const needle = city.trim().toLowerCase();
  const found = CRAWL_PLACES.filter(
    (place) =>
      place.name.toLowerCase() === needle ||
      place.city.toLowerCase() === needle ||
      place.country.toLowerCase() === needle ||
      place.name.toLowerCase().includes(needle),
  );
  return found.length > 0 ? found : CRAWL_PLACES;
}

function selectedTrades(trade: string | null | undefined): string[] {
  if (!trade) return CRAWL_TRADES;
  const needle = trade.trim().toLowerCase();
  const found = CRAWL_TRADES.filter(
    (entry) => entry.toLowerCase() === needle || entry.toLowerCase().includes(needle),
  );
  return found.length > 0 ? found : CRAWL_TRADES;
}

export async function runDiscoveryPhase(options: DiscoveryOptions): Promise<DiscoverySummary> {
  const places = selectedPlaces(options.city);
  const trades = selectedTrades(options.trade);
  const cursors = await getCursors("pair:");

  const pairs: PairState[] = [];
  for (const place of places) {
    for (const trade of trades) {
      const match = matchAudience(trade);
      if (match.filters.length === 0) continue;
      const tradeKey = tradeKeyForFilters(match.filters);
      const cursorKey = pairKey(place, tradeKey);
      const cursor = cursors.get(cursorKey);
      pairs.push({
        place,
        trade,
        tradeKey,
        filters: match.filters,
        cursorKey,
        tile: cursor?.tile ?? 0,
        cycle: cursor?.cycle ?? 0,
        lastRunAt: cursor?.lastRunAt ?? "",
      });
    }
  }

  // Pairs never crawled (or least recently crawled) go first.
  pairs.sort((a, b) => a.lastRunAt.localeCompare(b.lastRunAt));

  let scanned = 0;
  let added = 0;
  let tiles = 0;
  let failures = 0;
  let stopped = false;

  while (pairs.length > 0 && Date.now() < options.deadline) {
    if (options.signal.aborted || (await options.isStopped())) {
      stopped = true;
      break;
    }

    const pair = pairs.shift();
    if (!pair) break;

    const grid = tilesFor(pair.place.bbox);
    const tileIndex = pair.tile % grid.length;
    const tile = grid[tileIndex];
    const before = await countWithEmail();

    try {
      const elements = await queryOverpass(buildTileQuery(pair.filters, tile), options.signal);
      const rows: BusinessUpsert[] = [];
      for (const element of elements) {
        const row = toBusinessUpsert(element, pair.place, pair.tradeKey, pair.trade);
        if (row) rows.push(row);
      }

      if (rows.length > 0) await upsertBusinesses(rows);

      const after = await countWithEmail();
      scanned += rows.length;
      added += Math.max(0, after - before);
      tiles += 1;
      pair.tile = (tileIndex + 1) % grid.length;
      if (pair.tile === 0) pair.cycle += 1;

      options.onProgress({
        scanned,
        added,
        message: `${pair.trade} · ${pair.place.name} · tile ${tileIndex + 1}/${grid.length} · ${rows.length} records`,
      });
    } catch {
      failures += 1;
      options.onProgress({
        scanned,
        added,
        message: `${pair.trade} · ${pair.place.name} · tile ${tileIndex + 1} failed, retrying later`,
      });
    }

    pair.lastRunAt = new Date().toISOString();
    await setCursor(pair.cursorKey, {
      tile: pair.tile,
      cycle: pair.cycle,
      lastRunAt: pair.lastRunAt,
    });

    // Round-robin: put the pair at the back of the queue.
    pairs.push(pair);
  }

  return { scanned, added, pairs: pairs.length, tiles, failures, stopped };
}
