"use client";

import { Mail, Phone } from "lucide-react";
import { mailtoHref } from "@/lib/mailto";
import type { Lead } from "@/lib/types";

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

/** Shared lead row for current results, restored results and history. */
export function LeadRow({
  lead,
  onSelect,
  onContact,
}: {
  lead: Lead;
  onSelect: (lead: Lead) => void;
  onContact?: (lead: Lead) => void;
}) {
  return (
    <li className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted sm:px-5">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-50 text-[12px] font-bold text-accent-700">
        {initialsOf(lead.businessName)}
      </span>
      <button
        type="button"
        onClick={() => onSelect(lead)}
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
          onClick={() => onContact?.(lead)}
          aria-label={`Email ${lead.businessName}`}
          title={lead.email}
          className="grid size-9 shrink-0 place-items-center rounded-lg border border-line-strong bg-surface text-ink-muted shadow-card transition-colors hover:border-accent-300 hover:bg-accent-50 hover:text-accent-700"
        >
          <Mail className="size-4" />
        </a>
      ) : lead.phone ? (
        <a
          href={`tel:${lead.phone}`}
          onClick={() => onContact?.(lead)}
          aria-label={`Call ${lead.businessName}`}
          title={lead.phone}
          className="grid size-9 shrink-0 place-items-center rounded-lg border border-line-strong bg-surface text-ink-muted shadow-card transition-colors hover:border-accent-300 hover:bg-accent-50 hover:text-accent-700"
        >
          <Phone className="size-4" />
        </a>
      ) : null}
    </li>
  );
}
