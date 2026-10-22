"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock3, History, Mail, Phone } from "lucide-react";
import { BusinessModal } from "@/components/leads/business-modal";
import { Card } from "@/components/ui/card";
import { mailtoHref } from "@/lib/mailto";
import { useDiscovery } from "@/lib/store/discovery";
import type { Lead } from "@/lib/types";

interface HistoryItem {
  day: string;
  shownAt: string;
  lead: Lead;
}

function dayLabel(day: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export default function HistoryPage() {
  const { markContacted } = useDiscovery();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Lead | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/history?days=7", { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as {
          items?: HistoryItem[];
          error?: { message?: string };
        };
        if (!response.ok) throw new Error(data.error?.message ?? "Could not load history.");
        return data.items ?? [];
      })
      .then((next) => setItems(next))
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Could not load history.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const groups = new Map<string, HistoryItem[]>();
  for (const item of items) {
    const list = groups.get(item.day) ?? [];
    list.push(item);
    groups.set(item.day, list);
  }

  return (
    <div id="main" className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14">
      <section>
        <p className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.08em] text-ink-faint uppercase">
          <History className="size-4" aria-hidden />
          Your history
        </p>
        <h1 className="mt-2 text-[28px] leading-tight font-bold tracking-[-0.02em] text-ink">
          Contacts you fetched
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          Saved for this network for the last 7 days.
        </p>
      </section>

      {loading ? (
        <Card className="mt-6 overflow-hidden">
          <ul className="divide-y divide-line">
            {Array.from({ length: 4 }).map((_, index) => (
              <li key={index} className="flex items-center gap-3 px-5 py-3.5">
                <div className="size-9 animate-pulse rounded-xl bg-surface-sunken" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-2/5 animate-pulse rounded-full bg-surface-sunken" />
                  <div className="h-2.5 w-1/4 animate-pulse rounded-full bg-surface-sunken" />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {!loading && error ? (
        <div className="mt-6 rounded-2xl border border-danger-100 bg-danger-50 px-5 py-6 text-center">
          <h2 className="text-sm font-semibold text-ink">History unavailable</h2>
          <p className="mt-1 text-[13px] text-ink-muted">{error}</p>
        </div>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <div className="mt-6 grid place-items-center rounded-2xl border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
          <span className="mb-3 grid size-11 place-items-center rounded-xl bg-surface-sunken text-ink-muted">
            <Clock3 className="size-5" />
          </span>
          <h2 className="text-sm font-semibold text-ink">Nothing here yet</h2>
          <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-ink-muted">
            Contacts you fetch will appear here.
          </p>
          <Link
            href="/"
            className="mt-4 text-[12.5px] font-medium text-accent-700 underline-offset-4 hover:underline"
          >
            Start a search
          </Link>
        </div>
      ) : null}

      {!loading && !error
        ? [...groups.entries()].map(([day, dayItems]) => (
            <section key={day} className="mt-7">
              <h2 className="mb-2.5 px-1 text-[12px] font-semibold tracking-[0.06em] text-ink-faint uppercase">
                {dayLabel(day)}
              </h2>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-line">
                  {dayItems.map((item) => {
                    const lead = item.lead;
                    return (
                      <li
                        key={`${item.day}-${lead.id}`}
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
                    );
                  })}
                </ul>
              </Card>
            </section>
          ))
        : null}

      <BusinessModal lead={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
