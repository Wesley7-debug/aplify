import {
  markWebsiteChecked,
  nextWebsiteQueue,
  type WebsiteQueueRow,
} from "@/lib/db";
import { assessConfidence, isRoleAddress } from "@/lib/osm/email";
import { findWebsiteEmail } from "@/lib/crawler/website";

/**
 * Phase B: visit businesses that publish a website but no email.
 * `website_checked_at` is set either way, so a site is not re-fetched for 30
 * days even when no address exists.
 */

export interface WebsitePhaseOptions {
  deadline: number;
  signal: AbortSignal;
  isStopped: () => Promise<boolean>;
  onProgress: (progress: { scanned: number; added: number; message: string }) => void;
}

export interface WebsitePhaseSummary {
  scanned: number;
  added: number;
  stopped: boolean;
}

const BATCH_SIZE = 25;
const CONCURRENCY = 5;
const STALE_DAYS = 30;

async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      await worker(items[current]);
    }
  });
  await Promise.all(workers);
}

export async function runWebsitePhase(options: WebsitePhaseOptions): Promise<WebsitePhaseSummary> {
  const staleBefore = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let scanned = 0;
  let added = 0;
  let stopped = false;

  while (Date.now() < options.deadline) {
    if (options.signal.aborted || (await options.isStopped())) {
      stopped = true;
      break;
    }

    const batch = await nextWebsiteQueue(BATCH_SIZE, staleBefore);
    if (batch.length === 0) break;

    await runPool(batch, CONCURRENCY, async (row: WebsiteQueueRow) => {
      if (Date.now() >= options.deadline || options.signal.aborted) return;

      let email: string | null = null;
      try {
        const result = await findWebsiteEmail(row.website, options.signal);
        email = result.email;
      } catch {
        email = null;
      }

      const confidence = email
        ? assessConfidence(email, { phone: Boolean(row.phone), address: Boolean(row.address) }).level
        : undefined;

      let assigned = false;
      try {
        assigned = await markWebsiteChecked(
          row.id,
          email,
          email
            ? {
                source: "website",
                isRole: isRoleAddress(email),
                confidence: confidence ?? "low",
              }
            : undefined,
        );
      } catch {
        assigned = false;
      }

      scanned += 1;
      if (assigned) added += 1;

      options.onProgress({
        scanned,
        added,
        message: email
          ? `${row.name} · found ${email}`
          : `${row.name} · no public email on site`,
      });
    });
  }

  return { scanned, added, stopped };
}
