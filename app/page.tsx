"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  Inbox,
  MapPin,
  RotateCcw,
  Search,
} from "lucide-react";
import { ChangeEmailButton } from "@/components/auth/change-email-button";
import { BusinessModal } from "@/components/leads/business-modal";
import { LeadRow } from "@/components/leads/lead-row";
import { Combobox, type ComboboxOption } from "@/components/search/combobox";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { deviceHeaders } from "@/lib/device-client";
import { useDiscovery } from "@/lib/store/discovery";
import type { Lead } from "@/lib/types";

interface AllowanceInfo {
  limit: number;
  owner: boolean;
  /** Null for the unlimited admin session. */
  dailyLimit: number | null;
  dailyUsed: number;
  dailyRemaining: number | null;
}

interface RecentItem {
  day: string;
  shownAt: string;
  lead: Lead;
}

function fetchedLabel(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return "just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function HomePage() {
  const {
    query,
    patchQuery,
    fieldErrors,
    status,
    result,
    error,
    run,
    markContacted,
  } = useDiscovery();
  const [selected, setSelected] = useState<Lead | null>(null);
  const [tradeOptions, setTradeOptions] = useState<ComboboxOption[]>([]);
  const [locationOptions, setLocationOptions] = useState<ComboboxOption[]>([]);
  const [tradeLoading, setTradeLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [allowance, setAllowance] = useState<AllowanceInfo | null>(null);
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);

  const running = status === "running";
  const leads = result?.leads ?? [];
  const fieldError = fieldErrors.audience ?? fieldErrors.location;
  const limitReached = Boolean(
    allowance && !allowance.owner && allowance.dailyRemaining === 0,
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setTradeLoading(true);
      try {
        const response = await fetch(
          `/api/suggestions?kind=trade&q=${encodeURIComponent(query.audience.trim())}`,
          { signal: controller.signal },
        );
        const data = (await response.json()) as { suggestions?: ComboboxOption[] };
        setTradeOptions(data.suggestions ?? []);
      } catch {
        // Keep the previous list while offline.
      } finally {
        setTradeLoading(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query.audience]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLocationLoading(true);
      try {
        const response = await fetch(
          `/api/suggestions?kind=location&q=${encodeURIComponent(query.location.trim())}`,
          { signal: controller.signal },
        );
        const data = (await response.json()) as { suggestions?: ComboboxOption[] };
        setLocationOptions(data.suggestions ?? []);
      } catch {
        // Keep the previous list while offline.
      } finally {
        setLocationLoading(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query.location]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/allowance", {
      cache: "no-store",
      signal: controller.signal,
      headers: deviceHeaders(),
    })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.reload();
          return null;
        }
        return (await response.json()) as AllowanceInfo;
      })
      .then((data) => {
        if (data) setAllowance(data);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [status]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/recent", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.reload();
          return [];
        }
        const data = (await response.json()) as {
          items?: RecentItem[];
          error?: { message?: string };
        };
        if (!response.ok) throw new Error(data.error?.message ?? "Could not restore results.");
        return data.items ?? [];
      })
      .then((items) => setRecentItems(items))
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setRecentLoading(false);
      });
    return () => controller.abort();
  }, []);

  return (
    <div id="main" className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14">
      <section className="text-center">
        <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-balance text-ink">
          Find businesses without a website
        </h1>
        <p className="mx-auto mt-2.5 max-w-md text-[14px] leading-relaxed text-ink-muted">
          Real Nigerian businesses with a public email or phone number.
        </p>
      </section>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!limitReached) void run();
        }}
        className="mt-7"
      >
        <div className="rounded-2xl border border-line bg-surface p-2 shadow-card">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-0">
            <Combobox
              className="flex-1"
              value={query.audience}
              onChange={(value) => patchQuery({ audience: value })}
              options={tradeOptions}
              placeholder="Trade — dentist…"
              ariaLabel="Business type"
              icon={<Building2 className="size-4" />}
              loading={tradeLoading}
              maxLength={80}
            />
            <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden />
            <Combobox
              className="flex-1"
              value={query.location}
              onChange={(value) => patchQuery({ location: value })}
              options={locationOptions}
              placeholder="State or city — Lagos…"
              ariaLabel="Location"
              icon={<MapPin className="size-4" />}
              loading={locationLoading}
              maxLength={80}
            />
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={running}
              icon={running ? undefined : <Search className="size-4" />}
              disabled={running || limitReached}
              className="w-full sm:ml-1 sm:w-auto"
            >
              Search
            </Button>
          </div>

        </div>

        {limitReached ? (
          <p className="mt-2.5 text-center text-[12px] text-ink-muted">
            You&apos;ve reached your 20-hour limit.{" "}
            <Link href="/history" className="font-medium text-accent-700 underline-offset-4 hover:underline">
              View your history
            </Link>
            .
          </p>
        ) : null}

        {fieldError ? (
          <p className="mt-2.5 text-center text-xs text-ink-muted">{fieldError}</p>
        ) : error?.field ? (
          <p className="mt-2.5 text-center text-xs text-danger-600">{error.message}</p>
        ) : null}
      </form>

      <section className="mt-7">
        {status === "idle" && recentLoading ? (
          <p className="py-12 text-center text-[13px] text-ink-muted">
            Restoring your last results…
          </p>
        ) : null}

        {status === "idle" && !recentLoading && recentItems.length > 0 ? (
          <>
            <div className="mb-2.5 flex items-end justify-between gap-3 px-1">
              <div>
                <p className="text-[13px] font-semibold text-ink">Your last fetched contacts</p>
                <p className="mt-0.5 text-[11.5px] text-ink-faint">
                  Fetched {fetchedLabel(recentItems[0]?.shownAt ?? "")}
                </p>
              </div>
              <Link
                href="/history"
                className="shrink-0 text-[12px] font-medium text-accent-700 underline-offset-4 hover:underline"
              >
                View history
              </Link>
            </div>
            <Card className="overflow-hidden">
              <ul className="divide-y divide-line">
                {recentItems.map((item) => (
                  <LeadRow
                    key={item.lead.id}
                    lead={item.lead}
                    onSelect={setSelected}
                    onContact={(lead) => void markContacted(lead)}
                  />
                ))}
              </ul>
            </Card>
          </>
        ) : null}

        {status === "idle" && !recentLoading && recentItems.length === 0 ? (
          <p className="py-12 text-center text-[13px] text-ink-muted">
            Search a trade and a state or city to begin.
          </p>
        ) : null}

        {running && leads.length === 0 ? (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line">
              {Array.from({ length: 4 }).map((_, index) => (
                <li key={index} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="size-9 animate-pulse rounded-xl bg-surface-sunken" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-2/5 animate-pulse rounded-full bg-surface-sunken" />
                    <div className="h-2.5 w-1/4 animate-pulse rounded-full bg-surface-sunken" />
                  </div>
                  <div className="size-9 animate-pulse rounded-lg bg-surface-sunken" />
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {status === "error" && error && !error.field ? (
          <div className="rounded-2xl border border-danger-100 bg-danger-50 px-5 py-6 text-center">
            <span className="mx-auto mb-3 grid size-11 place-items-center rounded-xl bg-surface text-danger-600">
              <AlertTriangle className="size-5" />
            </span>
            <h2 className="text-sm font-semibold text-ink">{error.title}</h2>
            <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-ink-muted">
              {error.message}
            </p>
            {error.outcome === "daily_limit" ? null : (
              <Button
                variant="secondary"
                size="sm"
                className="mt-4"
                icon={<RotateCcw className="size-3.5" />}
                onClick={() => void run()}
              >
                Try again
              </Button>
            )}
          </div>
        ) : null}

        {status === "empty" && result ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
            <span className="mb-3 grid size-11 place-items-center rounded-xl bg-surface-sunken text-ink-muted">
              <Inbox className="size-5" />
            </span>
            <h2 className="text-sm font-semibold text-ink">No matches</h2>
            <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-ink-muted">
              Try another trade, or a different state or city.
            </p>
          </div>
        ) : null}

        {leads.length > 0 ? (
          <>
            <div className="mb-2.5 px-1">
              <p className="text-[13px] font-semibold text-ink">
                {leads.length} {leads.length === 1 ? "business" : "businesses"}
              </p>
            </div>

            <Card className="overflow-hidden">
              <ul className="divide-y divide-line">
                {leads.map((lead) => (
                  <LeadRow
                    key={lead.id}
                    lead={lead}
                    onSelect={setSelected}
                    onContact={(selectedLead) => void markContacted(selectedLead)}
                  />
                ))}
              </ul>
            </Card>

            {limitReached ? (
              <p className="mt-3 text-center text-[11.5px] text-ink-muted">
                You&apos;ve reached your 20-hour limit.
              </p>
            ) : null}
          </>
        ) : null}
      </section>

      <footer className="mt-8 space-y-1.5 text-center text-[11px] leading-relaxed text-ink-faint">
        <p>
          Data © OpenStreetMap contributors (
          <a
            href="https://opendatacommons.org/licenses/odbl/1-0/"
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 hover:text-ink-muted"
          >
            ODbL
          </a>
          ) and Overture Maps (
          <a
            href="https://cdla.dev/permissive-2-0/"
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 hover:text-ink-muted"
          >
            CDLA-Permissive 2.0
          </a>
          ). State boundaries by geoBoundaries (CC BY 4.0).
        </p>
        <p>
          <a
            href="mailto:privacy@aplify.app?subject=Remove%20my%20business%20listing"
            className="underline underline-offset-2 hover:text-ink-muted"
          >
            privacy@aplify.app
          </a>{" "}
          to remove a listing.
          {" · "}
          <ChangeEmailButton />
        </p>
      </footer>

      <BusinessModal lead={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
