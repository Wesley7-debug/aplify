/**
 * Seed the database from a Geofabrik OpenStreetMap extract.
 *
 *   npm run seed
 *   npm run seed -- --file=C:\data\nigeria-latest.osm.pbf
 *   npm run seed -- --city=Lagos --limit=5000
 *
 * The default download is the free Geofabrik Nigeria extract. Business tags are
 * filtered with the streaming `osm-pbf-parser`, then written to SQLite/Turso in
 * transactions. Node coordinates are retained only inside the configured city
 * boxes so way centroids can be computed without loading the whole planet.
 */

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import parseOsm, { type OsmItem } from "osm-pbf-parser";
import {
  closeDb,
  countBusinesses,
  countWithEmail,
  ensureDb,
  upsertBusinesses,
  type BusinessUpsert,
} from "../lib/db";
import { assessConfidence, firstEmail, isRoleAddress, isSyntaxValid, normalizeEmail } from "../lib/osm/email";
import { humanizeCategory, tradeKeyFromTags } from "../lib/osm/tags";
import { CRAWL_PLACES, type CrawlPlace } from "../lib/crawler/config";

const NIGERIA_PBF = "https://download.geofabrik.de/africa/nigeria-latest.osm.pbf";
const DEFAULT_FILE = "data/nigeria-latest.osm.pbf";
const BATCH_SIZE = 500;

interface Options {
  file: string;
  url: string;
  city: string | null;
  limit: number;
  requireContact: boolean;
  noWebsite: boolean;
}

function readOption(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1) return process.argv[index + 1] ?? null;
  return null;
}

function parseOptions(): Options {
  const targetValue = Number(readOption("target") ?? readOption("limit"));
  return {
    file: readOption("file") ?? process.env.APLIFY_PBF_FILE ?? DEFAULT_FILE,
    url: readOption("url") ?? NIGERIA_PBF,
    city: readOption("city"),
    limit:
      Number.isFinite(targetValue) && targetValue > 0
        ? Math.round(targetValue)
        : Number.POSITIVE_INFINITY,
    requireContact: !process.argv.includes("--include-without-contact"),
    noWebsite: !process.argv.includes("--allow-website"),
  };
}

function selectedPlaces(city: string | null): CrawlPlace[] {
  if (!city) return CRAWL_PLACES;
  const needle = city.toLowerCase();
  const found = CRAWL_PLACES.filter(
    (place) =>
      place.name.toLowerCase() === needle ||
      place.city.toLowerCase() === needle ||
      place.name.toLowerCase().includes(needle),
  );
  return found.length > 0 ? found : CRAWL_PLACES;
}

function placeFor(lat: number, lon: number, places: CrawlPlace[]): CrawlPlace | null {
  for (const place of places) {
    const [south, west, north, east] = place.bbox;
    if (lat >= south && lat <= north && lon >= west && lon <= east) return place;
  }
  return null;
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
  const parts = [
    tags["addr:housenumber"],
    tags["addr:street"],
    tags["addr:suburb"],
  ].filter((part): part is string => Boolean(part && part.trim()));
  return parts.length > 0 ? parts.join(", ") : null;
}

function toUpsert(
  item: OsmItem,
  tags: Record<string, string>,
  place: CrawlPlace,
  lat: number,
  lon: number,
  flags: { requireContact: boolean; noWebsite: boolean },
): BusinessUpsert | null {
  const tradeKey = tradeKeyFromTags(tags);
  if (!tradeKey) return null;

  const name = (tags.name ?? tags["name:en"] ?? tags.brand ?? tags.operator ?? "").trim();
  if (!name) return null;

  const rawEmail = firstEmail(tags.email ?? tags["contact:email"] ?? "");
  const email = rawEmail ? normalizeEmail(rawEmail) : "";
  const valid = email && isSyntaxValid(email) ? email : null;
  const phone = (tags.phone ?? tags["contact:phone"] ?? "").trim() || null;
  const website = normalizeWebsite(tags.website ?? tags["contact:website"]);

  // The product only lists real businesses with no website and a usable
  // contact channel (an email address or a phone number).
  if (flags.noWebsite && website) return null;
  if (flags.requireContact && !valid && !phone) return null;

  const address = addressOf(tags);

  return {
    id: `${item.type}/${item.id}`,
    name,
    category: humanizeCategory(tags, tradeKey),
    tradeKey,
    city: place.city,
    region: place.region,
    country: place.country,
    lat,
    lon,
    address,
    phone,
    website,
    email: valid,
    emailSource: valid ? "osm" : null,
    emailIsRole: valid ? isRoleAddress(valid) : false,
    confidence: valid
      ? assessConfidence(valid, { phone: Boolean(phone), address: Boolean(address) }).level
      : undefined,
    sourceUrl: `https://www.openstreetmap.org/${item.type}/${item.id}`,
  };
}

async function download(url: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.part`;
  console.log(`Downloading ${url}`);
  const response = await fetch(url, {
    headers: { "User-Agent": "AplifySeed/1.0 (+https://github.com/aplify)" },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed with HTTP ${response.status}.`);
  }

  const total = Number(response.headers.get("content-length") ?? 0);
  let received = 0;
  let lastPercent = -1;

  const body = Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>);
  body.on("data", (chunk: Buffer) => {
    received += chunk.byteLength;
    if (total <= 0) return;
    const percent = Math.floor((received / total) * 100);
    if (percent >= lastPercent + 10) {
      lastPercent = percent;
      console.log(`  ${percent}% (${(received / 1_048_576).toFixed(1)} MB)`);
    }
  });

  await pipeline(body, createWriteStream(temporary));
  await rm(destination, { force: true });
  await rename(temporary, destination);
  console.log(`Saved ${destination} (${(received / 1_048_576).toFixed(1)} MB)`);
}

async function main(): Promise<void> {
  const options = parseOptions();
  const places = selectedPlaces(options.city);
  const file = resolve(options.file);

  try {
    await stat(file);
  } catch {
    console.log(`No extract at ${file}; fetching the free Geofabrik Nigeria PBF instead.`);
    await download(options.url, file);
  }

  console.log(`Reading ${file}`);
  console.log(`Target cities: ${places.map((place) => place.name).join(", ")}`);
  await ensureDb();

  const beforeBusinesses = await countBusinesses();
  const beforeEmails = await countWithEmail();

  const neededNodeIds = new Set<number>();
  const wayQueue: Array<{ item: OsmItem; tags: Record<string, string> }> = [];
  const seen = new Set<string>();
  let scanned = 0;
  let buffered: BusinessUpsert[] = [];
  let written = 0;

  const flush = async (force = false): Promise<void> => {
    if (buffered.length === 0) return;
    if (!force && buffered.length < BATCH_SIZE) return;
    const batch = buffered;
    buffered = [];
    await upsertBusinesses(batch);
    written += batch.length;
    console.log(`  inserted ${written.toLocaleString()} businesses…`);
  };

  const parser = parseOsm();
  const input = createReadStream(file);
  let stopping = false;

  const handleItems = async (items: OsmItem[]): Promise<void> => {
    for (const item of items) {
      if (stopping) return;
      scanned += 1;
      if (scanned % 2_000_000 === 0) {
        console.log(`  parsed ${(scanned / 1_000_000).toFixed(0)}M records…`);
      }

      const tags = item.tags ?? {};
      const hasName = Boolean(
        tags.name ?? tags["name:en"] ?? tags.brand ?? tags.operator,
      );
      const isBusiness = hasName && Boolean(tradeKeyFromTags(tags));

      if (item.type === "node") {
        if (item.lat === undefined || item.lon === undefined) continue;
        const place = placeFor(item.lat, item.lon, places);
        if (!isBusiness || !place) continue;
        if (seen.has(`node/${item.id}`)) continue;
        seen.add(`node/${item.id}`);
        const row = toUpsert(item, tags, place, item.lat, item.lon, options);
        if (row) buffered.push(row);
      } else if (item.type === "way") {
        if (!isBusiness || !item.refs || item.refs.length === 0) continue;
        wayQueue.push({ item, tags });
        for (const ref of item.refs) neededNodeIds.add(ref);
      }

      if (buffered.length >= BATCH_SIZE) {
        await flush();
        if (written >= options.limit) {
          stopping = true;
          return;
        }
      }
    }
  };

  const sink = new Writable({
    objectMode: true,
    highWaterMark: 4,
    write(items: OsmItem[], _encoding, callback) {
      if (stopping) {
        callback();
        return;
      }
      handleItems(items)
        .then(() => callback())
        .catch((cause) => callback(cause instanceof Error ? cause : new Error(String(cause))));
    },
  });

  input.on("error", (cause) => sink.destroy(cause));
  parser.on("error", (cause) => sink.destroy(cause));
  input.pipe(parser).pipe(sink);
  await finished(sink);

  // Resolve way centroids. We only kept the ids referenced by business ways,
  // so a second streaming pass is far cheaper in memory than caching every
  // node inside the target city boxes.
  if (wayQueue.length > 0 && neededNodeIds.size > 0) {
    console.log(
      `Reading the extract again to resolve ${wayQueue.length.toLocaleString()} way ` +
        `geometries (${neededNodeIds.size.toLocaleString()} nodes)…`,
    );
    const nodeCoords = new Map<number, [number, number]>();
    const coordParser = parseOsm();
    const coordInput = createReadStream(file);
    const coordSink = new Writable({
      objectMode: true,
      highWaterMark: 64,
      write(items: OsmItem[], _encoding, callback) {
        for (const item of items) {
          if (
            item.type === "node" &&
            item.lat !== undefined &&
            item.lon !== undefined &&
            neededNodeIds.has(item.id)
          ) {
            nodeCoords.set(item.id, [item.lat, item.lon]);
          }
        }
        callback();
      },
    });
    coordInput.on("error", (cause) => coordSink.destroy(cause));
    coordParser.on("error", (cause) => coordSink.destroy(cause));
    coordInput.pipe(coordParser).pipe(coordSink);
    await finished(coordSink);

    for (const { item, tags } of wayQueue) {
      if (written + buffered.length >= options.limit) break;
      const refs = item.refs ?? [];
      let latSum = 0;
      let lonSum = 0;
      let count = 0;
      for (const ref of refs) {
        const coords = nodeCoords.get(ref);
        if (!coords) continue;
        latSum += coords[0];
        lonSum += coords[1];
        count += 1;
      }
      if (count === 0) continue;

      const lat = latSum / count;
      const lon = lonSum / count;
      const place = placeFor(lat, lon, places);
      if (!place) continue;
      if (seen.has(`way/${item.id}`)) continue;
      seen.add(`way/${item.id}`);

      const row = toUpsert(item, tags, place, lat, lon, options);
      if (row) buffered.push(row);
      if (buffered.length >= BATCH_SIZE) await flush();
    }
  }

  await flush(true);

  const afterBusinesses = await countBusinesses();
  const afterEmails = await countWithEmail();

  console.log("");
  console.log(`Parsed ${scanned.toLocaleString()} OSM records.`);
  console.log(
    `Businesses: ${beforeBusinesses.toLocaleString()} -> ${afterBusinesses.toLocaleString()} ` +
      `(+${(afterBusinesses - beforeBusinesses).toLocaleString()})`,
  );
  console.log(
    `With email: ${beforeEmails.toLocaleString()} -> ${afterEmails.toLocaleString()} ` +
      `(+${(afterEmails - beforeEmails).toLocaleString()})`,
  );
  console.log(
    "Next: run `npm run crawl` (or the admin Refresh button) to find emails on business websites.",
  );
}

main()
  .catch((cause) => {
    console.error("Seed failed:", cause);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb().catch(() => undefined);
  });
