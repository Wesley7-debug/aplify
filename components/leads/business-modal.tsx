"use client";

import { useEffect, useRef } from "react";
import { Building2, Copy, ExternalLink, Mail, MapPin, Phone, Tag, X } from "lucide-react";
import { ConfidenceBadge } from "@/components/leads/confidence-badge";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { useClipboard } from "@/hooks/use-clipboard";
import { mailtoHref } from "@/lib/mailto";
import { useDiscovery } from "@/lib/store/discovery";
import type { EmailSource, Lead } from "@/lib/types";

const EMAIL_SOURCE_LABELS: Record<EmailSource, string> = {
  "osm-tag": "Published on OpenStreetMap",
  "website-mailto": "Business website · mailto link",
  "website-text": "Business website · page text",
};

/**
 * Centered modal shown when a business name is clicked.
 * Contains the business information and its email confidence level.
 */
export function BusinessModal({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { copy } = useClipboard();
  const { markContacted } = useDiscovery();

  useEffect(() => {
    if (!lead) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [lead, onClose]);

  if (!lead) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={lead.businessName}
    >
      <div
        className="animate-fade-in absolute inset-0 bg-ink/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="animate-rise relative z-10 flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-overlay outline-none sm:rounded-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-600">
              <Building2 className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[17px] font-bold tracking-[-0.01em] text-ink">
                {lead.businessName}
              </h2>
              <p className="truncate text-[12.5px] text-ink-muted">
                {lead.category} · {lead.location.display}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 grid size-8 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="rounded-xl border border-line bg-surface-muted px-3.5 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] font-medium text-ink-muted">Confidence level</span>
              <ConfidenceBadge level={lead.confidence} size="sm" />
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">
              {lead.confidenceReason}
            </p>
          </div>

          <dl className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line">
            <Row icon={<Mail className="size-4" />} label="Email">
              {lead.email ? (
                <span className="flex flex-wrap items-center gap-2">
                  <a
                    href={mailtoHref(lead)}
                    onClick={() => void markContacted(lead)}
                    className="font-mono text-[12.5px] font-medium text-accent-700 underline-offset-4 hover:underline"
                  >
                    {lead.email}
                  </a>
                  {lead.emailIsRole ? (
                    <Badge tone="outline" size="xs">
                      shared inbox
                    </Badge>
                  ) : null}
                </span>
              ) : (
                <span className="text-ink-faint">No email listed — use the phone number</span>
              )}
            </Row>
            {lead.email ? (
              <Row icon={<Tag className="size-4" />} label="Email source">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] text-ink-soft">
                    {lead.emailSource
                      ? (EMAIL_SOURCE_LABELS[lead.emailSource] ?? "Source not recorded")
                      : "Source not recorded"}
                  </span>
                  <Badge tone="outline" size="xs">
                    <span className="font-mono text-[10px]">{lead.emailSource ?? "unknown"}</span>
                  </Badge>
                </span>
              </Row>
            ) : null}
            <Row icon={<Phone className="size-4" />} label="Phone">
              {lead.phone ?? <span className="text-ink-faint">Not listed</span>}
            </Row>
            <Row icon={<MapPin className="size-4" />} label="Location">
              {lead.address ? `${lead.address} · ${lead.location.display}` : lead.location.display}
            </Row>
          </dl>

          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-muted/60 px-3.5 py-3">
            <span className="text-[12.5px] font-medium text-ink-muted">Business record</span>
            <a
              href={lead.source.url}
              target="_blank"
              rel="noreferrer noopener"
              className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-accent-700 hover:underline"
            >
              <span className="truncate">{lead.source.name}</span>
              <ExternalLink className="size-3.5 shrink-0" />
            </a>
          </div>
        </div>

        <footer className="flex items-center gap-2 border-t border-line bg-surface-muted/60 px-5 py-3">
          {lead.email ? (
            <LinkButton
              href={mailtoHref(lead)}
              onClick={() => void markContacted(lead)}
              variant="primary"
              size="md"
              className="flex-1"
            >
              <Mail className="size-4" />
              Email business
            </LinkButton>
          ) : (
            <LinkButton
              href={`tel:${lead.phone ?? ""}`}
              onClick={() => void markContacted(lead)}
              variant="primary"
              size="md"
              className="flex-1"
            >
              <Phone className="size-4" />
              Call business
            </LinkButton>
          )}
          <Button
            variant="secondary"
            size="md"
            icon={<Copy className="size-4" />}
            onClick={() =>
              copy(lead.email ?? lead.phone ?? "", {
                title: lead.email ? "Email copied" : "Phone copied",
                description: lead.businessName,
              })
            }
          >
            Copy
          </Button>
        </footer>
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-3.5 py-2.5">
      <span className="mt-0.5 text-ink-faint" aria-hidden>
        {icon}
      </span>
      <dt className="w-20 shrink-0 text-[12px] text-ink-muted">{label}</dt>
      <dd className="min-w-0 flex-1 text-[13px] text-ink-soft">{children}</dd>
    </div>
  );
}
