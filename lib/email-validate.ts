import { isSyntaxValid } from "@/lib/osm/email";

/**
 * Free email validation with no API key.
 *
 * Syntax is checked locally, then the domain's DNS records are queried through
 * Cloudflare/Google DNS-over-HTTPS (normal UDP DNS is blocked in some hosts).
 * A domain with MX records is deliverable; a domain with only A/AAAA records is
 * accepted as a fallback, as RFC 5321 permits.
 *
 * Results are cached for the process lifetime. Network failures do not throw:
 * the address is kept as "syntax validated" so a temporary DNS outage cannot
 * delete the whole database.
 */

export type ValidationMethod = "mx" | "a" | "syntax";

export interface EmailValidation {
  valid: boolean;
  method: ValidationMethod;
  reason: string;
}

const DOH_PROVIDERS = [
  (name: string, type: string) =>
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
  (name: string, type: string) =>
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
];

interface DohAnswer {
  type: number;
  data: string;
}

interface DohResponse {
  Status: number;
  Answer?: DohAnswer[];
}

const cache = new Map<string, EmailValidation>();

const BAD_DOMAINS = [
  "example.com",
  "example.org",
  "example.net",
  "domain.com",
  "yourdomain.com",
  "placeholder.com",
  "test.com",
  "localhost",
  "sentry.io",
  "wixpress.com",
];

const BAD_LOCAL = /^(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|abuse|hostmaster|root)$/i;

function obviousJunk(email: string): boolean {
  const [local, domain] = email.toLowerCase().split("@");
  if (!local || !domain) return true;
  if (BAD_LOCAL.test(local)) return true;
  if (/\.(png|jpe?g|gif|svg|webp|avif|ico|css|js)$/i.test(domain)) return true;
  return BAD_DOMAINS.some((bad) => domain === bad || domain.endsWith(`.${bad}`));
}

async function query(name: string, type: "MX" | "A" | "AAAA"): Promise<DohResponse | null> {
  for (const provider of DOH_PROVIDERS) {
    try {
      const response = await fetch(provider(name, type), {
        headers: {
          Accept: "application/dns-json",
          "User-Agent": "AplifyValidator/1.0 (+https://github.com/aplify)",
        },
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as DohResponse;
      if (typeof payload.Status === "number") return payload;
    } catch {
      // try the next provider
    }
  }
  return null;
}

function hasType(payload: DohResponse | null, type: number): boolean {
  return Boolean(payload?.Answer?.some((answer) => answer.type === type && answer.data));
}

export async function validateEmail(email: string): Promise<EmailValidation> {
  const normalized = email.trim().toLowerCase();
  if (!isSyntaxValid(normalized) || normalized.length > 254) {
    return { valid: false, method: "syntax", reason: "Not a well-formed email address." };
  }
  if (obviousJunk(normalized)) {
    return { valid: false, method: "syntax", reason: "Junk or placeholder mailbox." };
  }

  const domain = normalized.split("@")[1] ?? "";
  const cached = cache.get(domain);
  if (cached) return cached;

  const mx = await query(domain, "MX");
  if (mx && mx.Status === 3) {
    const result: EmailValidation = {
      valid: false,
      method: "mx",
      reason: "The email domain does not exist (NXDOMAIN).",
    };
    cache.set(domain, result);
    return result;
  }
  if (hasType(mx, 15)) {
    const result: EmailValidation = { valid: true, method: "mx", reason: "Domain has MX records." };
    cache.set(domain, result);
    return result;
  }

  // No MX: fall back to A/AAAA, which is valid under RFC 5321 §5.1.
  const a = await query(domain, "A");
  if (hasType(a, 1)) {
    const result: EmailValidation = { valid: true, method: "a", reason: "Domain has an A record." };
    cache.set(domain, result);
    return result;
  }
  const aaaa = await query(domain, "AAAA");
  if (hasType(aaaa, 28)) {
    const result: EmailValidation = {
      valid: true,
      method: "a",
      reason: "Domain has an AAAA record.",
    };
    cache.set(domain, result);
    return result;
  }

  if (!mx && !a && !aaaa) {
    const result: EmailValidation = {
      valid: true,
      method: "syntax",
      reason: "DNS validation unavailable; syntax and junk checks passed.",
    };
    cache.set(domain, result);
    return result;
  }

  const result: EmailValidation = {
    valid: false,
    method: "mx",
    reason: "Domain exists but publishes no mail or address record.",
  };
  cache.set(domain, result);
  return result;
}

/** True when the address passed syntax, junk and DNS checks. */
export async function isDeliverableEmail(email: string): Promise<boolean> {
  return (await validateEmail(email)).valid;
}
