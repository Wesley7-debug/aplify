"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Inbox,
  Mail,
  MapPin,
  Phone,
  RotateCcw,
  Search,
  Sparkles,
} from "lucide-react";
import { BusinessModal } from "@/components/leads/business-modal";
import { Combobox, type ComboboxOption } from "@/components/search/combobox";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { mailtoHref } from "@/lib/mailto";
import { isDefaultOwnerEmail } from "@/lib/owner";
import { useDiscovery } from "@/lib/store/discovery";
import { cn } from "@/lib/utils";
import type { Lead, SearchDiagnostics } from "@/lib/types";

const EMAIL_PRESETS = [5, 10, 20, 30];

interface AvailableSearch {
  audience: string;
  location: string;
  hint: string;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export default function HomePage() {
  const { query, patchQuery, fieldErrors, status, result, error, seenCount, loadingMore, run, runQuery, loadMore, resetSeen, markContacted } =
    useDiscovery();
  const [selected, setSelected] = useState<Lead | null>(null);
  const [tradeOptions, setTradeOptions] = useState<ComboboxOption[]>([]);
  const [locationOptions, setLocationOptions] = useState<ComboboxOption[]>([]);
  const [tradeLoading, setTradeLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [available, setAvailable] = useState<AvailableSearch[]>([]);

  const running = status === "running";
  const leads = result?.leads ?? [];
  const diagnostics = result?.diagnostics ?? error?.diagnostics ?? null;
  const fieldError = fieldErrors.audience ?? fieldErrors.location;
  const ownerPreview = isDefaultOwnerEmail(query.userEmail);
  const maxLimit = ownerPreview ? 30 : 10;
  const limit = Math.min(Math.max(query.limit || 10, 1), maxLimit);
  const audience = result?.query.audience ?? query.audience;

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
    void fetch("/api/suggestions?kind=available&limit=8", { signal: controller.signal })
      .then(async (response) => (await response.json()) as { suggestions?: AvailableSearch[] })
      .then((data) => setAvailable(data.suggestions ?? []))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <div id="main" className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14">
      <section className="text-center">
        <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-balance text-ink">
          Find businesses worth emailing
        </h1>
        <p className="mx-auto mt-2.5 max-w-md text-[14px] leading-relaxed text-ink-muted">
          Search any trade and market. Every result is a real business with no website and a
          validated email or phone number.
        </p>
      </section>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
        className="mt-8"
      >
        <div className="rounded-2xl border border-line bg-surface p-2 shadow-card">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-0">
            <Combobox
              className="flex-1"
              value={query.audience}
              onChange={(value) => patchQuery({ audience: value })}
              options={tradeOptions}
              placeholder="Business type — dentists…"
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
              placeholder="Location — London…"
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
              disabled={running}
              className="w-full sm:ml-1 sm:w-auto"
            >
              Search
            </Button>
          </div>

          <div className="mt-1 flex flex-wrap items-center justify-between gap-3 border-t border-line px-2 pt-3 pb-1 sm:px-3">
            <label className="flex items-center gap-2 text-[12px] text-ink-muted">
              Contacts to return
              <input
                type="number"
                min={1}
                max={maxLimit}
                value={limit}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isFinite(next)) return;
                  patchQuery({ limit: Math.min(Math.max(Math.round(next), 1), maxLimit) });
                }}
                aria-label="Number of contacts to return"
                className="h-8 w-14 rounded-lg border border-line-strong bg-surface text-center text-[13px] font-semibold text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
              />
              <span className="text-ink-faint">max {maxLimit}</span>
            </label>

            <div className="flex items-center gap-1.5">
              {EMAIL_PRESETS.filter((preset) => preset <= maxLimit).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => patchQuery({ limit: preset })}
                  className={cn(
                    "h-7 min-w-8 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
                    limit === preset
                      ? "border-accent-300 bg-accent-50 text-accent-700"
                      : "border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink",
                  )}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-line px-2 pt-2.5 pb-1 sm:px-3">
            <label className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-ink-muted">
              Your email
              <input
                type="email"
                value={query.userEmail ?? ""}
                onChange={(event) => patchQuery({ userEmail: event.target.value })}
                placeholder="you@example.com"
                autoComplete="email"
                maxLength={254}
                className="h-8 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-2.5 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-accent-500 focus:ring-2 focus:ring-accent-100 sm:max-w-56"
              />
            </label>
            <span className="text-[11px] text-ink-faint">
              {ownerPreview ? "Owner · up to 30 per search" : "10 per search · contacted businesses are hidden"}
            </span>
          </div>
        </div>

        {fieldError ? (
          <p className="mt-2.5 text-center text-xs text-ink-muted">{fieldError}</p>
        ) : error?.field ? (
          <p className="mt-2.5 text-center text-xs text-danger-600">{error.message}</p>
        ) : null}
      </form>

      <section className="mt-7">
        {status === "idle" ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
            <span className="mb-3 grid size-11 place-items-center rounded-xl bg-accent-50 text-accent-600">
              <Search className="size-5" />
            </span>
            <h2 className="text-sm font-semibold text-ink">Start with a search</h2>
            <p className="mt-1 max-w-xs text-[13px] leading-relaxed text-ink-muted">
              Type a trade and pick a location — suggestions come from businesses already in the
              database.
            </p>
            <AvailableSuggestions
              items={available}
              onPick={(nextAudience, nextLocation) => void runQuery(nextAudience, nextLocation)}
            />
          </div>
        ) : null}

        {running && leads.length === 0 ? (
          <Card className="overflow-hidden">
            <div className="flex items-center gap-3 border-b border-line px-5 py-4">
              <Sparkles className="size-4 animate-shimmer text-accent-600" aria-hidden />
              <p className="text-[13px] font-medium text-ink" role="status">
                Searching real businesses…
              </p>
            </div>
            <ul className="divide-y divide-line">
              {Array.from({ length: 5 }).map((_, index) => (
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
            {error.diagnostics &&
            (error.diagnostics.businessesFound > 0 ||
              error.diagnostics.websitesChecked > 0 ||
              error.diagnostics.sourcesTried.length > 0) ? (
              <div className="mt-3">
                <DiagnosticsLine diagnostics={error.diagnostics} audience={audience} />
              </div>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              icon={<RotateCcw className="size-3.5" />}
              onClick={() => void run()}
            >
              Try again
            </Button>
          </div>
        ) : null}

        {status === "empty" && result ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
            <span className="mb-3 grid size-11 place-items-center rounded-xl bg-surface-sunken text-ink-muted">
              <Inbox className="size-5" />
            </span>
            <h2 className="text-sm font-semibold text-ink">
              {result.outcome === "businesses_found_but_no_public_email"
                ? "Businesses found — no public email"
                : "No businesses found"}
            </h2>
            <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-ink-muted">
              {result.message ??
                "Nothing matched that search. Map coverage varies by place — try a nearby city or a broader trade."}
            </p>
            {diagnostics ? (
              <div className="mt-3">
                <DiagnosticsLine diagnostics={diagnostics} audience={audience} />
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {seenCount > 0 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<RotateCcw className="size-3.5" />}
                  onClick={() => void resetSeen()}
                >
                  Reset seen ({seenCount})
                </Button>
              ) : null}
            </div>
            <AvailableSuggestions
              items={available}
              onPick={(nextAudience, nextLocation) => void runQuery(nextAudience, nextLocation)}
            />
          </div>
        ) : null}

        {leads.length > 0 ? (
          <>
            <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2 px-1">
              <p className="text-[13px] font-semibold text-ink">
                {leads.length} {leads.length === 1 ? "business" : "businesses"}
                {leads.length < limit ? (
                  <span className="ml-2 font-normal text-ink-muted">(asked for {limit})</span>
                ) : null}
              </p>
              {running ? (
                <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-accent-700">
                  <Sparkles className="size-3.5 animate-shimmer" aria-hidden />
                  Still searching…
                </span>
              ) : (
                <p className="text-[11.5px] text-ink-muted">Click a name for details</p>
              )}
            </div>

            {diagnostics ? (
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 px-1">
                <DiagnosticsLine diagnostics={diagnostics} audience={audience} />
                {seenCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => void resetSeen()}
                    className="flex items-center gap-1 text-[11px] font-medium text-ink-muted transition-colors hover:text-accent-700"
                  >
                    <RotateCcw className="size-3" aria-hidden />
                    Reset seen ({seenCount})
                  </button>
                ) : null}
              </div>
            ) : null}

            <Card className="overflow-hidden">
              <ul className="divide-y divide-line">
                {leads.map((lead) => (
                  <li
                    key={lead.id}
                    className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted sm:px-5"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-50 text-[12px] font-bold text-accent-700">
                      {initialsOf(lead.businessName)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelected(lead)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-[14px] font-semibold text-ink transition-colors group-hover:text-accent-700">
                        {lead.businessName}
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-ink-muted">
                        {lead.category} · {lead.location.display}
                      </span>
                    </button>
                    {lead.email ? (
                      <a
                        href={mailtoHref(lead)}
                        onClick={() => void markContacted(lead)}
                        aria-label={`Email ${lead.businessName}`}
                        title={lead.email}
                        className="grid size-9 shrink-0 place-items-center rounded-lg border border-line-strong bg-surface text-ink-muted shadow-card transition-colors hover:border-accent-300 hover:bg-accent-50 hover:text-accent-700"
                      >
                        <Mail className="size-4" />
                      </a>
                    ) : lead.phone ? (
                      <a
                        href={`tel:${lead.phone}`}
                        onClick={() => void markContacted(lead)}
                        aria-label={`Call ${lead.businessName}`}
                        title={lead.phone}
                        className="grid size-9 shrink-0 place-items-center rounded-lg border border-line-strong bg-surface text-ink-muted shadow-card transition-colors hover:border-accent-300 hover:bg-accent-50 hover:text-accent-700"
                      >
                        <Phone className="size-4" />
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>

            {result?.hasMore ? (
              <div className="mt-3 flex justify-center">
                <Button
                  variant="secondary"
                  size="sm"
                  loading={loadingMore}
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                >
                  Load more results
                </Button>
              </div>
            ) : null}

            {!running && result?.message ? (
              <p className="mt-2.5 px-1 text-[11.5px] leading-relaxed text-ink-muted">
                {result.message}
              </p>
            ) : null}
          </>
        ) : null}
      </section>

      <footer className="mt-8 space-y-2 text-center text-[11px] leading-relaxed text-ink-faint">
        <p>
          Business data © OpenStreetMap contributors and Overture Maps Foundation contributors,
          available under the{" "}
          <a
            href="https://opendatacommons.org/licenses/odbl/1-0/"
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 hover:text-ink-muted"
          >
            ODbL licence
          </a>{" "}
          and{" "}
          <a
            href="https://cdla.dev/permissive-2-0/"
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 hover:text-ink-muted"
          >
            CDLA-Permissive 2.0
          </a>
          . Emails and phone numbers are read from public records, never guessed.
        </p>
        <p>
          NDPR / GDPR: addresses are processed for legitimate business contact only. If you own a
          listed business you can request access, correction or removal at{" "}
          <a
            href="mailto:privacy@aplify.app?subject=Remove%20my%20business%20listing"
            className="underline underline-offset-2 hover:text-ink-muted"
          >
            privacy@aplify.app
          </a>
          . Every outreach template also includes an unsubscribe instruction.
        </p>
      </footer>

      <BusinessModal lead={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function AvailableSuggestions({
  items,
  onPick,
}: {
  items: AvailableSearch[];
  onPick: (audience: string, location: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="mt-5 w-full">
      <p className="text-[11px] font-semibold tracking-[0.08em] text-ink-faint uppercase">
        Available in the database
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-1.5">
        {items.map((item) => (
          <button
            key={`${item.audience}-${item.location}`}
            type="button"
            onClick={() => onPick(item.audience, item.location)}
            title={item.hint}
            className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11.5px] font-medium text-ink-soft transition-colors hover:border-accent-300 hover:bg-accent-50 hover:text-accent-700"
          >
            {item.audience} · {item.location}
          </button>
        ))}
      </div>
    </div>
  );
}

function DiagnosticsLine({
  diagnostics,
  audience,
}: {
  diagnostics: SearchDiagnostics;
  audience: string;
}) {
  const trade = (audience || "businesses").toLowerCase();
  const sources = diagnostics.sourcesTried;
  const via = sources.includes("database")
    ? "the local Aplify database"
    : sources.includes("snapshot")
      ? sources.includes("osm-live")
        ? "snapshot + live map data"
        : "snapshot"
      : sources.length > 0
        ? "live map data"
        : null;

  return (
    <p className="text-[11.5px] leading-relaxed text-ink-muted">
      Found <span className="font-semibold text-ink-soft">{diagnostics.businessesFound}</span>{" "}
      {trade} · {diagnostics.withWebsite} with a website ·{" "}
      {diagnostics.websitesChecked} websites checked ·{" "}
      <span className="font-semibold text-ink-soft">{diagnostics.withEmail}</span> contacts
      {via ? <span className="text-ink-faint"> · via {via}</span> : null}
      {diagnostics.mirrorsFailed > 0 ? (
        <span className="text-ink-faint"> · {diagnostics.mirrorsFailed} mirror requests failed</span>
      ) : null}
    </p>
  );
}
