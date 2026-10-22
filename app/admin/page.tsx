"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Clock3,
  Database,
  Globe2,
  LogOut,
  Mail,
  Play,
  RefreshCw,
  Square,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CRAWL_PLACES, CRAWL_TRADES } from "@/lib/crawler/config";
import { cn } from "@/lib/utils";

interface JobView {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "done" | "failed";
  addedCount: number;
  scannedCount: number;
  message: string | null;
  phase: string | null;
  cancelRequested: boolean;
  cities: string[];
  trades: string[];
}

interface LiveView {
  jobId: string;
  phase: "starting" | "osm" | "website" | "finished";
  scannedCount: number;
  addedCount: number;
  message: string;
  startedAt: string;
  running: boolean;
}

interface BreakdownView {
  label: string;
  total: number;
  withEmail: number;
}

interface StatsView {
  totalBusinesses: number;
  totalWithEmail: number;
  added24h: number;
  checkedWebsites: number;
  cities: BreakdownView[];
  trades: BreakdownView[];
  recentJobs: JobView[];
  lastJob: JobView | null;
}

const PHASES: Record<string, string> = {
  starting: "Preparing",
  osm: "Phase A · OSM discovery",
  website: "Phase B · Website emails",
  finished: "Finished",
};

function phaseLabel(phase: string | null | undefined): string {
  if (!phase) return "Preparing";
  return PHASES[phase] ?? phase;
}

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(2, Math.round((part / total) * 100));
}

export default function AdminPage() {
  const router = useRouter();
  const [stats, setStats] = useState<StatsView | null>(null);
  const [job, setJob] = useState<JobView | null>(null);
  const [live, setLive] = useState<LiveView | null>(null);
  const [pollJobId, setPollJobId] = useState<string | null>(null);
  const [city, setCity] = useState("");
  const [trade, setTrade] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/stats", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { stats?: StatsView; live?: LiveView | null };
      if (data.stats) setStats(data.stats);
      if (data.live) {
        setLive(data.live);
        setPollJobId(data.live.jobId);
      }
      const running = data.stats?.recentJobs.find((entry) => entry.status === "running");
      if (running) setPollJobId(running.id);
    } catch {
      // Keep the last known snapshot; the next tick will retry.
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (!pollJobId) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const response = await fetch(`/api/admin/crawl/${pollJobId}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { job?: JobView; live?: LiveView | null };
        if (cancelled) return;
        if (data.job) setJob(data.job);
        setLive(data.live ?? null);
        if (data.job && data.job.status !== "running") {
          setPollJobId(null);
          setLive(null);
          void refresh();
        }
      } catch {
        // transient polling error
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pollJobId, refresh]);

  async function startCrawl() {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: city || null,
          trade: trade || null,
          maxMinutes: 8,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { job?: JobView; error?: { message?: string } }
        | null;

      if (response.status === 409) {
        setNotice(data?.error?.message ?? "A crawl is already running.");
        if (data?.job) {
          setJob(data.job);
          setPollJobId(data.job.id);
        }
        return;
      }
      if (!response.ok || !data?.job) {
        throw new Error(data?.error?.message ?? "Could not start the crawler.");
      }

      setJob(data.job);
      setPollJobId(data.job.id);
      setNotice("Crawl started. You can leave this page open to watch progress.");
      void refresh();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Could not start the crawler.");
    } finally {
      setBusy(false);
    }
  }

  async function stopCrawl() {
    if (!job) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/crawl/${job.id}/stop`, { method: "POST" });
      const data = (await response.json().catch(() => null)) as
        | { job?: JobView; error?: { message?: string } }
        | null;
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not stop the job.");
      if (data?.job) setJob(data.job);
      setNotice("Stopping at the next safe point…");
      setPollJobId(job.id);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Could not stop the job.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/admin/login");
    router.refresh();
  }

  const running = Boolean(
    live?.running || job?.status === "running" || pollJobId,
  );
  const scanned = live?.scannedCount ?? job?.scannedCount ?? 0;
  const added = live?.addedCount ?? job?.addedCount ?? 0;
  const currentPhase = live?.phase ?? job?.phase ?? null;

  const maxCity = useMemo(
    () => Math.max(1, ...(stats?.cities ?? []).map((entry) => entry.total)),
    [stats],
  );
  const maxTrade = useMemo(
    () => Math.max(1, ...(stats?.trades ?? []).map((entry) => entry.total)),
    [stats],
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] text-accent-700 uppercase">
            Aplify admin
          </p>
          <h1 className="mt-1 text-[26px] leading-tight font-bold tracking-[-0.02em] text-ink">
            Crawl dashboard
          </h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            Keep the local database growing — no paid APIs, no request-path crawling.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => void refresh()}>
            Refresh stats
          </Button>
          <Button variant="ghost" size="sm" icon={<LogOut className="size-3.5" />} onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Database className="size-4" />} label="Businesses stored" value={stats?.totalBusinesses ?? 0} />
        <StatCard icon={<Mail className="size-4" />} label="With a public email" value={stats?.totalWithEmail ?? 0} tone="accent" />
        <StatCard icon={<Clock3 className="size-4" />} label="New emails · 24h" value={stats?.added24h ?? 0} tone="positive" />
        <StatCard icon={<Globe2 className="size-4" />} label="Websites checked" value={stats?.checkedWebsites ?? 0} />
      </section>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">Refresh / Crawl now</h2>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            Phase A discovers new OSM businesses; Phase B looks for emails on their websites. Leave
            the filters blank to rotate through every city and trade.
          </p>
        </div>

        <div className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="block text-[12px] font-medium text-ink-muted">
            City
            <select
              value={city}
              onChange={(event) => setCity(event.target.value)}
              disabled={running}
              className="mt-1.5 h-9.5 w-full rounded-xl border border-line-strong bg-surface px-2.5 text-sm text-ink outline-none focus:border-accent-500"
            >
              <option value="">Auto-rotate all cities</option>
              {CRAWL_PLACES.map((place) => (
                <option key={place.name} value={place.name}>
                  {place.name}, {place.country}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-[12px] font-medium text-ink-muted">
            Trade
            <select
              value={trade}
              onChange={(event) => setTrade(event.target.value)}
              disabled={running}
              className="mt-1.5 h-9.5 w-full rounded-xl border border-line-strong bg-surface px-2.5 text-sm text-ink outline-none focus:border-accent-500"
            >
              <option value="">Auto-rotate all trades</option>
              {CRAWL_TRADES.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>

          <Button
            variant="primary"
            size="md"
            loading={busy && !running}
            disabled={running || busy}
            icon={running ? <RefreshCw className="size-4 animate-spin" /> : <Play className="size-4" />}
            onClick={() => void startCrawl()}
          >
            {running ? "Crawl running" : "Refresh / Crawl now"}
          </Button>
        </div>

        {notice ? (
          <p className="border-t border-line bg-surface-muted px-5 py-2.5 text-[12px] text-ink-muted">
            {notice}
          </p>
        ) : null}

        {job ? (
          <div className="border-t border-line px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold text-ink">
                  {job.status === "running" ? phaseLabel(currentPhase) : `Job ${job.status}`}
                </p>
                <p className="mt-0.5 font-mono text-[10.5px] text-ink-faint">
                  {job.id} · {formatDate(job.startedAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
                    job.status === "running"
                      ? "bg-accent-50 text-accent-700"
                      : job.status === "failed"
                        ? "bg-danger-50 text-danger-600"
                        : "bg-positive-50 text-positive-700",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      job.status === "running"
                        ? "animate-pulse bg-accent-600"
                        : job.status === "failed"
                          ? "bg-danger-600"
                          : "bg-positive-600",
                    )}
                  />
                  {job.status}
                </span>
                {job.status === "running" ? (
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<Square className="size-3" />}
                    disabled={busy}
                    onClick={() => void stopCrawl()}
                  >
                    Stop
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MiniStat label="Scanned" value={scanned} />
              <MiniStat label="New emails" value={added} tone="accent" />
              <MiniStat label="Cities" value={job.cities.length} />
              <MiniStat label="Trades" value={job.trades.length} />
            </div>

            {job.status === "running" ? (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                <div className="animate-shimmer h-full w-1/2 rounded-full bg-accent-500" />
              </div>
            ) : null}

            {live?.message || job.message ? (
              <p className="mt-2.5 text-[12px] leading-relaxed text-ink-muted">
                {live?.message ?? job.message}
              </p>
            ) : null}
          </div>
        ) : null}
      </Card>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <Breakdown
          title="By city"
          icon={<Users className="size-4" />}
          rows={stats?.cities ?? []}
          max={maxCity}
        />
        <Breakdown
          title="By trade"
          icon={<Mail className="size-4" />}
          rows={stats?.trades ?? []}
          max={maxTrade}
        />
      </section>

      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">Last 10 crawl jobs</h2>
          <span className="text-[11px] text-ink-faint">Newest first</span>
        </div>
        {stats && stats.recentJobs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[12px]">
              <thead className="bg-surface-muted text-[10.5px] tracking-wide text-ink-faint uppercase">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Started</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Scanned</th>
                  <th className="px-4 py-2.5 text-right font-semibold">New emails</th>
                  <th className="px-4 py-2.5 font-semibold">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {stats.recentJobs.map((entry) => (
                  <tr key={entry.id} className="text-ink-soft">
                    <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(entry.startedAt)}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10.5px] font-medium",
                          entry.status === "running"
                            ? "bg-accent-50 text-accent-700"
                            : entry.status === "failed"
                              ? "bg-danger-50 text-danger-600"
                              : "bg-positive-50 text-positive-700",
                        )}
                      >
                        {entry.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-ink">{entry.scannedCount}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-ink">{entry.addedCount}</td>
                    <td className="max-w-[280px] truncate px-4 py-2.5 text-ink-muted">
                      {entry.message ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 py-8 text-center text-[12.5px] text-ink-muted">
            No crawl jobs yet. Press “Refresh / Crawl now” to fill the database.
          </p>
        )}
      </Card>

      <p className="mt-6 text-center text-[11px] text-ink-faint">
        Business data © OpenStreetMap contributors · ODbL 1.0. Crawling is polite: 1 request/sec
        per host, robots.txt respected.
      </p>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone = "plain",
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "plain" | "accent" | "positive";
}) {
  return (
    <Card className="px-4 py-3.5">
      <div className="flex items-center gap-2 text-ink-muted">
        <span
          className={cn(
            "grid size-7 place-items-center rounded-lg",
            tone === "accent"
              ? "bg-accent-50 text-accent-700"
              : tone === "positive"
                ? "bg-positive-50 text-positive-700"
                : "bg-surface-sunken text-ink-soft",
          )}
        >
          {icon}
        </span>
        <span className="text-[11.5px] font-medium">{label}</span>
      </div>
      <p className="mt-2 text-[24px] leading-none font-bold tracking-[-0.02em] text-ink">
        {value.toLocaleString()}
      </p>
    </Card>
  );
}

function MiniStat({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: number;
  tone?: "plain" | "accent";
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-muted px-3 py-2.5">
      <p className="text-[10.5px] font-medium text-ink-faint">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-[18px] leading-none font-bold",
          tone === "accent" ? "text-accent-700" : "text-ink",
        )}
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function Breakdown({
  title,
  icon,
  rows,
  max,
}: {
  title: string;
  icon: React.ReactNode;
  rows: BreakdownView[];
  max: number;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
        <span className="text-ink-muted">{icon}</span>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-[12.5px] text-ink-muted">No data yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            <li key={row.label} className="px-5 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[12.5px] font-medium text-ink-soft">{row.label}</span>
                <span className="shrink-0 text-[11.5px] text-ink-muted">
                  {row.withEmail.toLocaleString()} / {row.total.toLocaleString()} with email
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                <div
                  className="h-full rounded-full bg-accent-400"
                  style={{ width: `${pct(row.withEmail, max)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
