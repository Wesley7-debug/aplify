import { GEO_TTL, getCached, setCached } from "@/lib/cache/file-cache";
import { SearchServiceError } from "@/lib/discovery/errors";
import type { LocationSuggestion } from "@/lib/types";

/**
 * Nominatim geocoding.
 *
 * Results are cached for 30 days. A geocoding failure is a real service error
 * (the caller must not turn it into "no businesses found").
 */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "Aplify/1.0 (business email finder; https://github.com/aplify)";

export interface GeoPlace {
  display: string;
  city: string | null;
  region: string | null;
  country: string | null;
  /** [south, west, north, east] */
  bbox: [number, number, number, number];
  lat: number;
  lon: number;
}

interface NominatimHit {
  display_name?: string;
  name?: string;
  lat: string;
  lon: string;
  boundingbox?: [string, string, string, string];
  address?: Record<string, string>;
}

let lastRequestAt = 0;

async function politeDelay(): Promise<void> {
  // Nominatim asks for at most one request per second.
  const wait = Math.max(0, 1_000 - (Date.now() - lastRequestAt));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

async function nominatim(query: URLSearchParams, timeoutMs: number): Promise<NominatimHit[]> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await politeDelay();
    try {
      const response = await fetch(`${NOMINATIM_URL}?${query.toString()}`, {
        headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        lastError = new Error(`Nominatim responded with ${response.status}.`);
        continue;
      }
      return (await response.json()) as NominatimHit[];
    } catch (cause) {
      lastError = cause;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("The location lookup service did not respond.");
}

function normalizeLocation(location: string): string {
  return location.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function geocode(location: string): Promise<GeoPlace> {
  const key = `geo:v1:${normalizeLocation(location)}`;
  const cached = await getCached<GeoPlace>(key);
  if (cached) return cached;

  let data: NominatimHit[];
  try {
    data = await nominatim(
      new URLSearchParams({
        q: location,
        format: "jsonv2",
        limit: "1",
        addressdetails: "1",
      }),
      10_000,
    );
  } catch {
    throw new SearchServiceError(
      "The location service is unavailable right now. Please try again in a moment.",
      "geocode_failed",
    );
  }

  const hit = data?.[0];
  if (!hit) {
    throw new SearchServiceError(
      `We couldn't find "${location}". Try a nearby city or region.`,
      "geocode_failed",
    );
  }

  const lat = Number(hit.lat);
  const lon = Number(hit.lon);
  const box = hit.boundingbox?.map(Number);
  const bbox: [number, number, number, number] =
    box && box.length === 4 && box.every((value) => Number.isFinite(value))
      ? [box[0], box[2], box[1], box[3]]
      : [lat - 0.08, lon - 0.08, lat + 0.08, lon + 0.08];

  const address = hit.address ?? {};
  const place: GeoPlace = {
    display: hit.display_name ?? location,
    city: address.city ?? address.town ?? address.village ?? address.municipality ?? null,
    region: address.state ?? address.region ?? address.county ?? null,
    country: address.country ?? null,
    bbox,
    lat,
    lon,
  };

  await setCached(key, place, GEO_TTL);
  return place;
}

/** Typeahead for the location field. Never throws. */
export async function suggestLocations(input: string, limit = 5): Promise<LocationSuggestion[]> {
  const query = input.trim();
  if (query.length < 2) return [];

  const key = `suggest:v1:${normalizeLocation(query)}:${limit}`;
  const cached = await getCached<LocationSuggestion[]>(key);
  if (cached) return cached;

  let data: NominatimHit[];
  try {
    data = await nominatim(
      new URLSearchParams({
        q: query,
        format: "jsonv2",
        limit: String(limit),
        addressdetails: "1",
      }),
      6_000,
    );
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const suggestions: LocationSuggestion[] = [];

  for (const hit of data) {
    const address = hit.address ?? {};
    const city =
      address.city ??
      address.town ??
      address.village ??
      address.municipality ??
      address.county ??
      hit.name ??
      null;
    const country = address.country ?? null;
    const label = city ?? hit.display_name ?? query;
    const value = [city, country].filter(Boolean).join(", ") || hit.display_name || query;
    const hint = [address.state ?? address.region, country].filter(Boolean).join(", ");

    const dedupe = value.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    suggestions.push({ value, label, hint });
  }

  await setCached(key, suggestions, GEO_TTL);
  return suggestions;
}
