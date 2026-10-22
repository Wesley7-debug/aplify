import type { Candidate } from "@/lib/discovery/types";
import type { GeoPlace } from "@/lib/osm/geocode";

/**
 * Optional Foursquare Places source.
 *
 * Foursquare does not publish email addresses, but it is an excellent source
 * of businesses *with websites*, which the email finder can then inspect.
 * Only used when FOURSQUARE_KEY is present.
 */

interface FoursquarePlace {
  fsq_id?: string;
  name?: string;
  website?: string;
  tel?: string;
  categories?: Array<{ name?: string }>;
  location?: {
    formatted_address?: string;
    city?: string;
    state?: string;
    country?: string;
  };
  geocodes?: { main?: { latitude?: number; longitude?: number } };
}

export async function discoverFoursquare(options: {
  audience: string;
  place: GeoPlace;
  signal: AbortSignal;
  limit: number;
}): Promise<Candidate[]> {
  const key = process.env.FOURSQUARE_KEY;
  if (!key) return [];

  const params = new URLSearchParams({
    query: options.audience,
    near: options.place.display,
    limit: String(Math.min(Math.max(options.limit, 1), 50)),
  });

  const response = await fetch(`https://api.foursquare.com/v3/places/search?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      Authorization: key,
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return [];

  const data = (await response.json()) as { results?: FoursquarePlace[] };
  const retrievedAt = new Date().toISOString();
  const candidates: Candidate[] = [];

  for (const place of data.results ?? []) {
    const name = place.name?.trim();
    if (!name) continue;

    const city = place.location?.city ?? options.place.city;
    const region = place.location?.state ?? options.place.region;
    const country = place.location?.country ?? options.place.country;
    const display = [city, country].filter(Boolean).join(", ") || options.place.display;
    const website = place.website?.trim();

    candidates.push({
      id: `foursquare:${place.fsq_id ?? `${name}-${place.geocodes?.main?.latitude}-${place.geocodes?.main?.longitude}`}`,
      businessName: name,
      category: place.categories?.[0]?.name ?? options.audience,
      website: website && /^https?:\/\//i.test(website) ? website : website ? `https://${website}` : null,
      phone: place.tel?.trim() || null,
      address: place.location?.formatted_address ?? null,
      city,
      region,
      country,
      display,
      lat: place.geocodes?.main?.latitude ?? null,
      lon: place.geocodes?.main?.longitude ?? null,
      publishedEmail: null,
      sourceName: "Foursquare",
      sourceUrl: "https://foursquare.com/",
      sourceLicense: "Foursquare Places",
      retrievedAt,
    });
  }

  return candidates;
}
