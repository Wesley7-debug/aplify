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
} from "lucide-react";
import { BusinessModal } from "@/components/leads/business-modal";
import { Combobox, type ComboboxOption } from "@/components/search/combobox";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { mailtoHref } from "@/lib/mailto";
import { useDiscovery } from "@/lib/store/discovery";
import type { Lead } from "@/lib/types";

interface AllowanceInfo {
  limit: number;
  owner: boolean;
  dailyLimit: number | null;
  dailyUsed: number;
  dailyRemaining: number | null;
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
  const {
    query,
    patchQuery,
    fieldErrors,
    status,
    result,
    error,
    seenCount,
    run,
    resetSeen,
    markContacted,
  } = useDiscovery();
  const [selected, setSelected] = useState<Lead | null>(null);
  const [tradeOptions, setTradeOptions] = useState<ComboboxOption[]>([]);
  const [locationOptions, setLocationOptions] = useState<ComboboxOption[]>([]);
  const [tradeLoading, setTradeLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [allowance, setAllowance] = useState<AllowanceInfo | null>(null);

  const running = status === "running";
  const leads = result?.leads ?? [];
  const fieldError = fieldErrors.audience ?? fieldErrors.location;
  const limitReached = Boolean(allowance && !allowance.owner && allowance.dailyRemaining === 0);

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
    const params = new URLSearchParams();
    if (query.userEmail?.trim()) params.set("user", query.userEmail.trim());
    void fetch(`/api/allowance?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => (await response.json()) as AllowanceInfo)
      .then((data) => setAllowance(data))
      .catch(() => undefined);
    return () => controller.abort();
  }, [query.userEmail, status]);

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

          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-line px-2 pt-2.5 pb-1 sm:px-3">
            <label className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-ink-muted">
              Owner email
              <input
                type="email"
                value={query.userEmail ?? ""}
                onChange={(event) => patchQuery({ userEmail: event.target.value })}
                placeholder="owner@example.com"
                autoComplete="email"
                maxLength={254}
                className="h-8 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-2.5 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-accent-500 focus:ring-2 focus:ring-accent-100 sm:max-w-56"
              />
            </label>
            {limitReached ? (
              <span className="text-[11px] font-medium text-danger-600">Daily limit reached</span>
            ) : null}
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

            {limitReached ? (
              <p className="mt-3 text-center text-[11.5px] text-ink-muted">
                Daily limit reached. Come back tomorrow.
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
          NDPR / GDPR:{" "}
          <a
            href="mailto:privacy@aplify.app?subject=Remove%20my%20business%20listing"
            className="underline underline-offset-2 hover:text-ink-muted"
          >
            privacy@aplify.app
          </a>{" "}
          to correct or remove a listing.
          {seenCount > 0 ? (
            <>
              {" · "}
              <button
                type="button"
                onClick={() => void resetSeen()}
                className="underline underline-offset-2 hover:text-ink-muted"
              >
                Reset seen ({seenCount})
              </button>
            </>
          ) : null}
        </p>
      </footer>

      <BusinessModal lead={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
