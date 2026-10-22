import { randomUUID } from "node:crypto";
import {
  createCrawlJob,
  ensureDb,
  finishCrawlJob,
  getRunningJob,
  isCrawlStopRequested,
  requestCrawlStop,
  updateCrawlJob,
  type CrawlJob,
} from "@/lib/db";
import { CRAWL_PLACES, CRAWL_TRADES, findPlace, findTrade } from "@/lib/crawler/config";
import { runDiscoveryPhase } from "@/lib/crawler/discovery";
import { runWebsitePhase } from "@/lib/crawler/email";

/**
 * Crawl orchestrator.
 *
 * `runCrawl` never throws for ordinary network failures: every tile and website
 * is isolated, the job row records the outcome, and the process-wide registry
 * lets the admin page poll live progress without touching the request path.
 */

export type CrawlPhase = "starting" | "osm" | "website" | "finished";

export interface CrawlProgress {
  jobId: string;
  phase: CrawlPhase;
  scannedCount: number;
  addedCount: number;
  message: string;
  startedAt: string;
  running: boolean;
}

export interface RunCrawlOptions {
  maxMinutes?: number;
  city?: string | null;
  trade?: string | null;
  /** Pre-created job id (the admin route creates the row before responding). */
  jobId?: string;
  onProgress?: (progress: CrawlProgress) => void;
  signal?: AbortSignal;
}

export interface CrawlSummary {
  jobId: string;
  status: "done" | "failed";
  scannedCount: number;
  addedCount: number;
  message: string;
  stopped: boolean;
}

export class CrawlAlreadyRunningError extends Error {
  constructor(readonly job: CrawlJob | null) {
    super("A crawl is already running.");
    this.name = "CrawlAlreadyRunningError";
  }
}

interface ActiveCrawl extends CrawlProgress {
  controller: AbortController;
}

const activeCrawls = new Map<string, ActiveCrawl>();

export function getActiveCrawl(jobId?: string): CrawlProgress | null {
  if (jobId) {
    const active = activeCrawls.get(jobId);
    return active ? publicProgress(active) : null;
  }
  const first = activeCrawls.values().next();
  return first.done ? null : publicProgress(first.value);
}

function publicProgress(active: ActiveCrawl): CrawlProgress {
  return {
    jobId: active.jobId,
    phase: active.phase,
    scannedCount: active.scannedCount,
    addedCount: active.addedCount,
    message: active.message,
    startedAt: active.startedAt,
    running: active.running,
  };
}

export function isCrawlRunning(): boolean {
  return activeCrawls.size > 0;
}

export async function stopCrawl(jobId: string): Promise<boolean> {
  const requested = await requestCrawlStop(jobId);
  const active = activeCrawls.get(jobId);
  if (active) {
    active.message = "Stopping…";
    active.controller.abort();
    return true;
  }
  return requested;
}

function clampMinutes(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 8;
  return Math.min(Math.max(value ?? 8, 0.1), 60);
}

/**
 * Start a crawl in the background and return the created job immediately.
 * Refuses when another crawl already holds the database's running slot.
 */
export async function startCrawl(options: {
  maxMinutes?: number;
  city?: string | null;
  trade?: string | null;
}): Promise<CrawlJob> {
  await ensureDb();

  if (isCrawlRunning()) throw new CrawlAlreadyRunningError(await getRunningJob());
  const running = await getRunningJob();
  if (running) throw new CrawlAlreadyRunningError(running);

  const place = findPlace(options.city);
  const trade = findTrade(options.trade);
  const cities = place ? [place.name] : CRAWL_PLACES.map((entry) => entry.name);
  const trades = trade ? [trade] : CRAWL_TRADES;
  const id = randomUUID();
  const job = await createCrawlJob({ id, cities, trades });

  // Fire and forget: the HTTP response must never wait for network crawling.
  void runCrawl({
    maxMinutes: options.maxMinutes,
    city: place?.name ?? options.city ?? null,
    trade: trade ?? options.trade ?? null,
    jobId: id,
  }).catch(async (cause) => {
    // runCrawl handles its own errors; this is a last-resort guard.
    const message = cause instanceof Error ? cause.message : String(cause);
    await finishCrawlJob(id, {
      status: "failed",
      scannedCount: 0,
      addedCount: 0,
      message: `Crawler crashed: ${message}`,
    }).catch(() => undefined);
  });

  return job;
}

export async function runCrawl(options: RunCrawlOptions = {}): Promise<CrawlSummary> {
  await ensureDb();

  const minutes = clampMinutes(options.maxMinutes);
  const jobId = options.jobId ?? randomUUID();
  const startedAt = new Date().toISOString();

  if (!options.jobId) {
    const place = findPlace(options.city);
    const trade = findTrade(options.trade);
    await createCrawlJob({
      id: jobId,
      cities: place ? [place.name] : CRAWL_PLACES.map((entry) => entry.name),
      trades: trade ? [trade] : CRAWL_TRADES,
    });
  }

  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onOuterAbort, { once: true });

  const active: ActiveCrawl = {
    jobId,
    phase: "starting",
    scannedCount: 0,
    addedCount: 0,
    message: "Preparing crawl…",
    startedAt,
    running: true,
    controller,
  };
  activeCrawls.set(jobId, active);

  const publish = (progress: Partial<Omit<CrawlProgress, "jobId" | "startedAt" | "running">>) => {
    if (progress.phase) active.phase = progress.phase;
    if (typeof progress.scannedCount === "number") active.scannedCount = progress.scannedCount;
    if (typeof progress.addedCount === "number") active.addedCount = progress.addedCount;
    if (typeof progress.message === "string") active.message = progress.message;
    const snapshot = publicProgress(active);
    options.onProgress?.(snapshot);
  };

  let lastPersist = 0;
  const persist = (force = false) => {
    const now = Date.now();
    if (!force && now - lastPersist < 1_500) return;
    lastPersist = now;
    void updateCrawlJob(jobId, {
      phase: active.phase,
      scannedCount: active.scannedCount,
      addedCount: active.addedCount,
      message: active.message,
    }).catch(() => undefined);
  };

  let scannedCount = 0;
  let addedCount = 0;
  let stopped = false;
  let status: "done" | "failed" = "done";
  let message = "";

  const isStopped = async (): Promise<boolean> => {
    if (controller.signal.aborted) return true;
    try {
      return await isCrawlStopRequested(jobId);
    } catch {
      return false;
    }
  };

  const deadline = Date.now() + minutes * 60_000;
  const discoveryDeadline = Date.now() + minutes * 60_000 * 0.6;

  try {
    publish({
      phase: "osm",
      message: options.city || options.trade ? "Starting OSM discovery…" : "Rotating OSM discovery…",
    });
    persist(true);

    const discovery = await runDiscoveryPhase({
      deadline: discoveryDeadline,
      city: options.city,
      trade: options.trade,
      signal: controller.signal,
      isStopped,
      onProgress: (progress) => {
        scannedCount = progress.scanned;
        addedCount = progress.added;
        publish({
          phase: "osm",
          scannedCount,
          addedCount,
          message: progress.message,
        });
        persist();
      },
    });

    scannedCount += 0;
    addedCount = discovery.added;
    stopped = discovery.stopped;

    if (!stopped && (await isStopped())) stopped = true;

    if (!stopped && Date.now() < deadline) {
      publish({
        phase: "website",
        scannedCount,
        addedCount,
        message: "Checking business websites for public emails…",
      });
      persist(true);

      const websites = await runWebsitePhase({
        deadline,
        signal: controller.signal,
        isStopped,
        onProgress: (progress) => {
          publish({
            phase: "website",
            scannedCount: discovery.scanned + progress.scanned,
            addedCount: discovery.added + progress.added,
            message: progress.message,
          });
          persist();
        },
      });

      scannedCount = discovery.scanned + websites.scanned;
      addedCount = discovery.added + websites.added;
      stopped = stopped || websites.stopped;
    }

    message = stopped
      ? `Stopped after scanning ${scannedCount} records and adding ${addedCount} emails.`
      : `Crawl finished: scanned ${scannedCount} records and added ${addedCount} emails.`;

    publish({
      phase: "finished",
      scannedCount,
      addedCount,
      message,
    });
  } catch (cause) {
    status = "failed";
    message = `Crawl failed: ${cause instanceof Error ? cause.message : String(cause)}`;
  } finally {
    options.signal?.removeEventListener("abort", onOuterAbort);
    active.running = false;
    active.phase = "finished";
    active.message = message || "Crawl finished.";
    activeCrawls.delete(jobId);
    await persistNow();
    await finishCrawlJob(jobId, {
      status,
      scannedCount,
      addedCount,
      message: active.message,
    }).catch(() => undefined);
  }

  return { jobId, status, scannedCount, addedCount, message, stopped };

  async function persistNow(): Promise<void> {
    try {
      await updateCrawlJob(jobId, {
        phase: "finished",
        scannedCount,
        addedCount,
        message: message || "Crawl finished.",
      });
    } catch {
      // The final finishCrawlJob call is authoritative.
    }
  }
}
