import type { Lead } from "@/lib/types";

/**
 * Build the outbound mailto link. Every template carries an opt-out note so
 * recipients can ask to be removed, and the footer explains NDPR/GDPR rights.
 */
export function mailtoHref(lead: Pick<Lead, "businessName" | "email">): string {
  if (!lead.email) return "";
  const subject = `Enquiry for ${lead.businessName}`;
  const body = [
    `Hello ${lead.businessName},`,
    "",
    "I found your business in a public directory and wanted to get in touch.",
    "",
    "If you would prefer not to receive messages like this, reply with the word",
    '"unsubscribe" and we will remove you from our list and never contact you again.',
    "",
    "Thank you.",
  ].join("\n");

  return `mailto:${lead.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
