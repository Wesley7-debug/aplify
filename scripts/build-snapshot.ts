/**
 * Precompute market snapshots for fast, offline-friendly searches.
 *
 * Usage:
 *   npm run snapshot
 *   npm run snapshot -- --cities="Lagos, Nigeria|Abuja, Nigeria" --trades=Restaurants
 *
 * City names may contain commas, so separate multiple cities with `|`.
 * Trades accept `,`, `;` or `|`.
 *
 * Each city/trade pair does one live discovery pass, enriches the businesses,
 * and writes the resulting leads to the persistent cache. At request time a
 * matching snapshot answers from disk in well under a second; live discovery is
 * still used for anything the snapshot does not cover.
 *
 * The script is intentionally resumable: existing snapshots are skipped unless
 * --force is passed. A failed pair is retried with backoff and never written as
 * an empty snapshot.
 */

import { flushCache } from "../lib/cache/file-cache";
import { collectLeads, saveSnapshot } from "../lib/discovery/search";
import { readSnapshot } from "../lib/discovery/snapshot";
import { geocode } from "../lib/osm/geocode";

const DEFAULT_CITIES = [
  "Lagos, Nigeria",
  "Abuja, Nigeria",
  "Port Harcourt, Nigeria",
  "London, United Kingdom",
  "Berlin, Germany",
];

const DEFAULT_TRADES = [
  "Restaurants",
  "Hotels",
  "Pharmacies",
  "Dentists",
  "Law firms",
];

interface Options {
  cities: string[];
  trades: string[];
  limit: number;
  stages: number;
  retries: number;
  pauseMs: number;
  force: boolean;
}

function readOption(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1) return process.argv[index + 1] ?? null;
  return null;
}

function readList(name: string, fallback: string[], separator: RegExp = /,/): string[] {
  const value = readOption(name);
  if (!value) return fallback;
  return value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readNumber(name: string, fallback: number): number {
  const value = readOption(name);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptions(): Options {
  return {
    cities: readList("cities", DEFAULT_CITIES, /[|;]/),
    trades: readList("trades", DEFAULT_TRADES, /[,;|]/),
    limit: Math.min(Math.max(Math.round(readNumber("limit", 30)), 1), 30),
    stages: Math.max(1, Math.round(readNumber("stages", 1))),
    retries: Math.max(0, Math.round(readNumber("retries", 2))),
    pauseMs: Math.max(0, Math.round(readNumber("pause", 1_500))),
    force: process.argv.includes("--force"),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function main(): Promise<void> {
  const options = parseOptions();
  const pairs = options.cities.flatMap((city) =>
    options.trades.map((trade) => ({ city, trade })),
  );

  console.log(
    `Building ${pairs.length} snapshot(s): ${options.cities.length} cities x ${options.trades.length} trades`,
  );
  console.log(
    `limit=${options.limit} stages=${options.stages} retries=${options.retries} force=${options.force}`,
  );

  let built = 0;
  let skipped = 0;
  let empty = 0;
  let failed = 0;

  for (const [index, pair] of pairs.entries()) {
    const prefix = `[${index + 1}/${pairs.length}] ${pair.trade} - ${pair.city}`;

    if (!options.force) {
      try {
        const place = await geocode(pair.city);
        const existing = await readSnapshot(place, pair.trade);
        if (existing) {
          console.log(`${prefix} - already snapshotted (${existing.leads.length} leads), skipping`);
          skipped += 1;
          continue;
        }
      } catch {
        // If we cannot geocode yet, let the real attempt surface the error.
      }
    }

    let completed = false;
    for (let attempt = 0; attempt <= options.retries && !completed; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 180_000);

      try {
        const started = Date.now();
        const result = await collectLeads({
          audience: pair.trade,
          location: pair.city,
          limit: options.limit,
          seed: Math.floor(Math.random() * 2_147_483_647),
          maxStages: options.stages,
          ignoreSnapshot: true,
          signal: controller.signal,
        });
        const seconds = ((Date.now() - started) / 1_000).toFixed(1);

        if (result.leads.length > 0) {
          await saveSnapshot(result, pair.trade, pair.city);
          await flushCache();
          built += 1;
          console.log(
            `${prefix} - saved ${result.leads.length} leads in ${seconds}s ` +
              `(${result.diagnostics.businessesFound} businesses, ` +
              `${result.diagnostics.websitesChecked} websites checked)`,
          );
          completed = true;
        } else {
          empty += 1;
          completed = true;
          console.log(
            `${prefix} - no leads in ${seconds}s: ${result.outcome}` +
              (result.message ? ` (${result.message})` : ""),
          );
        }
      } catch (cause) {
        const message = errorMessage(cause);
        if (attempt < options.retries) {
          const backoff = 5_000 * 2 ** attempt;
          console.log(
            `${prefix} - attempt ${attempt + 1} failed: ${message}; retrying in ${backoff}ms`,
          );
          await sleep(backoff);
        } else {
          failed += 1;
          console.log(`${prefix} - failed after ${attempt + 1} attempt(s): ${message}`);
        }
      } finally {
        clearTimeout(timer);
      }
    }

    if (index < pairs.length - 1 && options.pauseMs > 0) {
      await sleep(options.pauseMs);
    }
  }

  await flushCache();

  console.log(
    `\nDone: ${built} built, ${skipped} skipped, ${empty} empty, ${failed} failed.`,
  );
  if (built === 0 && skipped === 0) {
    console.log(
      "No snapshots were written. This usually means the public Overpass mirrors were unavailable.",
    );
    process.exitCode = 1;
  }
}

main().catch((cause) => {
  console.error("Snapshot build crashed:", cause);
  process.exitCode = 1;
});
