import { SNAPSHOT_TTL, getCached, setCached } from "@/lib/cache/file-cache";
import type { GeoPlace } from "@/lib/osm/geocode";
import { audienceKey } from "@/lib/osm/tags";
import type { Lead } from "@/lib/types";

/**
 * Precomputed market snapshots.
 *
 * `scripts/build-snapshot.ts` fills these for popular cities/trades so a
 * search can answer from disk in well under a second. Live discovery remains
 * the fallback when a snapshot is missing or has been exhausted.
 */

export interface SnapshotRecord {
  version: 1;
  audience: string;
  location: string;
  leads: Lead[];
  businessesFound: number;
  withWebsite: number;
  withEmail: number;
  websitesChecked: number;
  createdAt: string;
}

function slug(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function placeKey(place: GeoPlace): string {
  const city = place.city ?? place.region ?? place.display;
  return `${slug(place.country)}:${slug(city)}`;
}

export function snapshotKey(place: GeoPlace, audience: string): string {
  return `snapshot:v1:${placeKey(place)}:${audienceKey(audience)}`;
}

export async function readSnapshot(
  place: GeoPlace,
  audience: string,
): Promise<SnapshotRecord | null> {
  return getCached<SnapshotRecord>(snapshotKey(place, audience));
}

export async function writeSnapshot(
  place: GeoPlace,
  audience: string,
  record: Omit<SnapshotRecord, "version" | "audience" | "location" | "createdAt">,
): Promise<void> {
  const payload: SnapshotRecord = {
    version: 1,
    audience,
    location: place.display,
    createdAt: new Date().toISOString(),
    ...record,
  };
  await setCached(snapshotKey(place, audience), payload, SNAPSHOT_TTL);
}
