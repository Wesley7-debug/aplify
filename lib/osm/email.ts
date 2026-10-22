import type { ConfidenceLevel } from "@/lib/types";

/**
 * Email helpers for real published addresses.
 *
 * We can only assert what we can actually observe: the address is syntactically
 * valid, and whether it is a person-shaped address or a shared role inbox.
 * Nothing here claims the mailbox exists — that would require a live check.
 */

const ROLE_LOCALS = new Set([
  "info",
  "contact",
  "hello",
  "hi",
  "sales",
  "admin",
  "office",
  "support",
  "help",
  "mail",
  "email",
  "enquiries",
  "enquiry",
  "inquiries",
  "inquiry",
  "bookings",
  "booking",
  "reservations",
  "reservation",
  "orders",
  "order",
  "accounts",
  "account",
  "billing",
  "team",
  "service",
  "services",
  "care",
  "marketing",
  "press",
  "jobs",
  "careers",
  "reception",
  "frontdesk",
  "general",
]);

const ROLE_PREFIX =
  /^(info|contact|hello|sales|admin|office|support|enquir|inquir|booking|reservation|order|account|billing|team|service|marketing|press|jobs|career|reception|general)[._+-]/;

/** Basic RFC-shaped check — proves formatting, nothing more. */
export function isSyntaxValid(email: string): boolean {
  const value = email.trim();
  if (value.length > 254 || value.includes("..")) return false;
  return /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value);
}

export function normalizeEmail(email: string): string {
  return email.trim().replace(/^mailto:/i, "").toLowerCase();
}

/** Some OSM entries list several addresses separated by `;` or `,`. */
export function firstEmail(raw: string): string {
  return raw.split(/[;,]/)[0]?.trim() ?? "";
}

export function isRoleAddress(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (!local) return true;
  if (ROLE_LOCALS.has(local)) return true;
  return ROLE_PREFIX.test(local);
}

export function assessConfidence(
  email: string,
  extras: { phone: boolean; address: boolean },
): { level: ConfidenceLevel; reason: string } {
  if (!isSyntaxValid(email)) {
    return {
      level: "low",
      reason: "The published value is not a well-formed email address.",
    };
  }

  const role = isRoleAddress(email);
  const hasDetail = extras.phone || extras.address;

  if (!role && hasDetail) {
    return {
      level: "high",
      reason:
        "A named address published on a public map record, with a phone number or address to cross-check it against.",
    };
  }
  if (!role) {
    return {
      level: "high",
      reason: "A named address published on a public map record.",
    };
  }
  if (hasDetail) {
    return {
      level: "medium",
      reason:
        "A shared role inbox (for example info@) published on a public map record, with other contact details listed.",
    };
  }
  return {
    level: "low",
    reason:
      "A shared role inbox with no other contact details on record — verify it before sending.",
  };
}
