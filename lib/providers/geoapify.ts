import type { Candidate } from "@/lib/discovery/types";
import type { GeoPlace } from "@/lib/osm/geocode";
import type { OsmFilter } from "@/lib/osm/tags";

/**
 * Optional Geoapify Places source.
 *
 * Only used when GEOAPIFY_KEY is present. Geoapify returns website/contact
 * details but often no email, which is fine: the website goes through the same
 * email finder as OSM candidates.
 */

const GEOAPIFY_CATEGORY_MAP: Record<string, string[]> = {
  "amenity=restaurant": ["catering.restaurant"],
  "amenity=fast_food": ["catering.fast_food"],
  "amenity=cafe": ["catering.cafe"],
  "amenity=bar": ["catering.bar"],
  "amenity=pub": ["catering.pub"],
  "amenity=dentist": ["healthcare.dentist"],
  "amenity=doctors": ["healthcare.doctor"],
  "amenity=clinic": ["healthcare.clinic_or_praxis"],
  "amenity=pharmacy": ["healthcare.pharmacy"],
  "amenity=hospital": ["healthcare.hospital"],
  "amenity=veterinary": ["healthcare.veterinary"],
  "tourism=hotel": ["accommodation.hotel"],
  "tourism=guest_house": ["accommodation.guest_house"],
  "tourism=hostel": ["accommodation.hostel"],
  "tourism=apartment": ["accommodation.apartment"],
  "leisure=fitness_centre": ["sport.fitness"],
  "shop=supermarket": ["commercial.supermarket"],
  "shop=convenience": ["commercial.convenience"],
  "shop=bakery": ["commercial.food_and_drink.bakery"],
  "shop=clothes": ["commercial.clothing"],
  "shop=furniture": ["commercial.houseware_and_hardware.furniture"],
  "shop=hardware": ["commercial.houseware_and_hardware"],
  "shop=car_repair": ["service.vehicle.repair"],
  "shop=car": ["commercial.vehicles"],
  "shop=beauty": ["commercial.health_and_beauty"],
  "shop=hairdresser": ["commercial.health_and_beauty.hairdresser"],
  "office=lawyer": ["office.lawyer"],
  "office=accountant": ["office.accountant"],
  "office=estate_agent": ["office.estate_agent"],
  "office=insurance": ["office.insurance"],
  "office=it": ["office.it"],
  "craft=plumber": ["service.plumber"],
  "craft=electrician": ["service.electrician"],
  "craft=carpenter": ["service.carpenter"],
};

interface GeoapifyFeature {
  properties?: {
    name?: string;
    website?: string;
    phone?: string;
    email?: string;
    contact?: { email?: string; phone?: string };
    address_line2?: string;
    formatted?: string;
    city?: string;
    state?: string;
    country?: string;
    lat?: number;
    lon?: number;
    place_id?: string;
    datasource?: { raw_data_url?: string };
  };
}

function categoriesFor(filters: OsmFilter[]): string[] {
  const categories = new Set<string>();
  for (const filter of filters) {
    const mapped = GEOAPIFY_CATEGORY_MAP[`${filter.key}=${filter.value}`];
    if (mapped) for (const category of mapped) categories.add(category);
  }
  return [...categories];
}

export async function discoverGeoapify(options: {
  audience: string;
  filters: OsmFilter[];
  place: GeoPlace;
  signal: AbortSignal;
  limit: number;
}): Promise<Candidate[]> {
  const key = process.env.GEOAPIFY_KEY;
  if (!key) return [];

  const [south, west, north, east] = options.place.bbox;
  const params = new URLSearchParams({
    filter: `rect:${west},${south},${east},${north}`,
    limit: String(Math.min(Math.max(options.limit, 1), 50)),
    apiKey: key,
  });

  const categories = categoriesFor(options.filters);
  if (categories.length > 0) params.set("categories", categories.join(","));
  else params.set("name", options.audience);

  const response = await fetch(`https://api.geoapify.com/v2/places?${params.toString()}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return [];

  const data = (await response.json()) as { features?: GeoapifyFeature[] };
  const retrievedAt = new Date().toISOString();
  const candidates: Candidate[] = [];

  for (const feature of data.features ?? []) {
    const props = feature.properties;
    const name = props?.name?.trim();
    if (!name) continue;

    const website = props?.website?.trim() || null;
    const email = (props?.email ?? props?.contact?.email ?? "").trim() || null;
    const lat = props?.lat ?? null;
    const lon = props?.lon ?? null;
    const city = props?.city ?? options.place.city;
    const region = props?.state ?? options.place.region;
    const country = props?.country ?? options.place.country;
    const display = [city, country].filter(Boolean).join(", ") || options.place.display;

    candidates.push({
      id: `geoapify:${props?.place_id ?? `${name}-${lat}-${lon}`}`,
      businessName: name,
      category: options.audience,
      website,
      phone: (props?.phone ?? props?.contact?.phone ?? "").trim() || null,
      address: props?.address_line2 ?? props?.formatted ?? null,
      city,
      region,
      country,
      display,
      lat,
      lon,
      publishedEmail: email,
      sourceName: "Geoapify",
      sourceUrl: props?.datasource?.raw_data_url ?? "https://www.geoapify.com/",
      sourceLicense: "Geoapify (includes OpenStreetMap data)",
      retrievedAt,
    });
  }

  return candidates;
}
