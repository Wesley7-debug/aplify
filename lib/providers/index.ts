import type { Candidate } from "@/lib/discovery/types";
import type { GeoPlace } from "@/lib/osm/geocode";
import type { OsmFilter } from "@/lib/osm/tags";
import { discoverFoursquare } from "@/lib/providers/foursquare";
import { discoverGeoapify } from "@/lib/providers/geoapify";

export interface ProviderResult {
  candidates: Candidate[];
  sourcesTried: string[];
}

/**
 * Merge every optional provider that has a key configured. Missing keys are
 * skipped silently; a provider outage never fails the whole search.
 */
export async function discoverProviders(options: {
  audience: string;
  filters: OsmFilter[];
  place: GeoPlace;
  signal: AbortSignal;
  limit: number;
}): Promise<ProviderResult> {
  const jobs: Array<Promise<Candidate[]>> = [];
  const sourcesTried: string[] = [];

  if (process.env.GEOAPIFY_KEY) {
    sourcesTried.push("geoapify");
    jobs.push(discoverGeoapify(options).catch(() => []));
  }

  if (process.env.FOURSQUARE_KEY) {
    sourcesTried.push("foursquare");
    jobs.push(
      discoverFoursquare({
        audience: options.audience,
        place: options.place,
        signal: options.signal,
        limit: options.limit,
      }).catch(() => []),
    );
  }

  if (jobs.length === 0) return { candidates: [], sourcesTried: [] };

  const results = await Promise.all(jobs);
  const candidates = results.flat();
  return { candidates, sourcesTried };
}
