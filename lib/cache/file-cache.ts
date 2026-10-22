import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Tiny persistent JSON cache.
 *
 * The public OSM services are slow, so successful results are written to disk
 * and reused across processes and restarts. Failures and empty arrays are never
 * stored — an outage must not become a permanent "no results".
 *
 * A JSON file (rather than SQLite) keeps the app dependency-free and works on
 * any Node host. Writes are serialised and coalesced so concurrent searches do
 * not corrupt the file.
 */

const CACHE_DIR = process.env.APLIFY_CACHE_DIR || path.join(process.cwd(), ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "aplify-cache.json");
const CACHE_VERSION = 1;

export const DAY = 24 * 60 * 60 * 1000;
export const BUSINESS_TTL = 7 * DAY;
export const EMAIL_TTL = 30 * DAY;
export const GEO_TTL = 30 * DAY;
export const SNAPSHOT_TTL = 30 * DAY;

interface CacheEntry {
  value: unknown;
  expires: number;
}

interface CacheFile {
  version: number;
  entries: Record<string, CacheEntry>;
}

const entries = new Map<string, CacheEntry>();

let loaded = false;
let loadPromise: Promise<void> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function load(): Promise<void> {
  if (loaded) return;
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const raw = await fs.readFile(CACHE_FILE, "utf8");
        const parsed = JSON.parse(raw) as CacheFile;
        if (parsed?.version === CACHE_VERSION && parsed.entries) {
          const now = Date.now();
          for (const [key, entry] of Object.entries(parsed.entries)) {
            if (entry && typeof entry.expires === "number" && entry.expires > now) {
              entries.set(key, entry);
            }
          }
        }
      } catch {
        // Missing or corrupt cache is fine — start clean.
      }
      loaded = true;
    })();
  }
  await loadPromise;
}

function prune(): void {
  const now = Date.now();
  for (const [key, entry] of entries) {
    if (entry.expires <= now) entries.delete(key);
  }
}

async function writeNow(): Promise<void> {
  if (entries.size === 0) return;
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    prune();
    const payload: CacheFile = {
      version: CACHE_VERSION,
      entries: Object.fromEntries(entries),
    };
    await fs.writeFile(CACHE_FILE, JSON.stringify(payload), "utf8");
  } catch {
    // A read-only filesystem (e.g. some serverless hosts) simply means the
    // in-memory map still works for this process.
  }
}

function scheduleWrite(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    writeChain = writeChain.then(writeNow).catch(() => {});
  }, 250);
  if (typeof writeTimer === "object" && "unref" in writeTimer) {
    writeTimer.unref();
  }
}

/** Read a value if present and unexpired. Returns null on a miss. */
export async function getCached<T>(key: string): Promise<T | null> {
  await load();
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.expires <= Date.now()) {
    entries.delete(key);
    scheduleWrite();
    return null;
  }
  return entry.value as T;
}

/**
 * Store a value. Failures (null/undefined) and empty arrays are ignored so a
 * transient outage can never masquerade as a cached "nothing found".
 */
export async function setCached(key: string, value: unknown, ttlMs: number): Promise<void> {
  if (value === null || value === undefined) return;
  if (Array.isArray(value) && value.length === 0) return;

  await load();
  entries.set(key, { value, expires: Date.now() + ttlMs });
  scheduleWrite();
}

export async function deleteCached(key: string): Promise<void> {
  await load();
  if (entries.delete(key)) scheduleWrite();
}

/** Force pending writes to finish (used by scripts and tests). */
export async function flushCache(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  await writeChain;
  await writeNow();
}

export function cacheFilePath(): string {
  return CACHE_FILE;
}
