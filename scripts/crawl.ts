/**
 * Run a crawl without the UI.
 *
 *   npm run crawl
 *   npm run crawl -- --minutes=8
 *   npm run crawl -- --city=Lagos --trade=Restaurants
 *
 * Safe to stop with Ctrl+C: the current tile/website finishes or aborts and the
 * job row is marked done with the counts collected so far.
 */

import { closeDb } from "../lib/db";
import { runCrawl } from "../lib/crawler";

function readOption(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1) return process.argv[index + 1] ?? null;
  return null;
}

async function main(): Promise<void> {
  const minutesValue = Number(readOption("minutes") ?? readOption("max-minutes") ?? "8");
  const maxMinutes = Number.isFinite(minutesValue) ? minutesValue : 8;
  const city = readOption("city");
  const trade = readOption("trade");

  const controller = new AbortController();
  const onInterrupt = () => {
    console.log("\nStopping after the current request…");
    controller.abort();
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);

  console.log(
    `Crawling for up to ${maxMinutes} minute(s)` +
      (city ? ` · city=${city}` : "") +
      (trade ? ` · trade=${trade}` : ""),
  );

  let lastMessage = "";
  const summary = await runCrawl({
    maxMinutes,
    city,
    trade,
    signal: controller.signal,
    onProgress: (progress) => {
      if (progress.message === lastMessage) return;
      lastMessage = progress.message;
      console.log(
        `[${progress.phase}] scanned=${progress.scannedCount} added=${progress.addedCount} ${progress.message}`,
      );
    },
  });

  console.log("");
  console.log(summary.message);
  console.log(`Job ${summary.jobId} · status=${summary.status}`);
  if (summary.status === "failed") process.exitCode = 1;

  process.removeListener("SIGINT", onInterrupt);
  process.removeListener("SIGTERM", onInterrupt);
}

main()
  .catch((cause) => {
    console.error("Crawl failed:", cause);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb().catch(() => undefined);
  });
