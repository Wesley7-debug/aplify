import { EMAIL_TTL, getCached, setCached } from "@/lib/cache/file-cache";
import type { Candidate, FoundEmail } from "@/lib/discovery/types";
import { firstEmail, isSyntaxValid, normalizeEmail } from "@/lib/osm/email";

/**
 * Email enrichment.
 *
 * Step A reads an address the source already publishes (OSM `email` /
 * `contact:email`). Step B, only when there is a website and no published
 * address, fetches the homepage plus /contact, /contact-us and /about and reads
 * `mailto:` links and visible text.
 *
 * We never guess, infer or generate an address. Everything returned was found
 * verbatim (after decoding simple `[at]` / `[dot]` obfuscations).
 */

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/125.0 Safari/537.36 AplifyBot/1.0 (+https://github.com/aplify)";
const ROBOTS_TOKEN = "AplifyBot";

const FETCH_TIMEOUT_MS = 4_000;
const MAX_CONCURRENCY = 10;
const MAX_HTML_BYTES = 512_000;
const MAX_EMAILS_PER_BUSINESS = 3;
const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;

/** Simple counting semaphore shared by every website fetch in the process. */
class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) next();
  }
}

const websiteSemaphore = new Semaphore(MAX_CONCURRENCY);

interface RobotsRules {
  disallow: string[];
  allow: string[];
  allowAll: boolean;
}

const robotsCache = new Map<string, { expires: number; rules: RobotsRules }>();

async function limitedFetch(url: string, signal: AbortSignal): Promise<Response | null> {
  await websiteSemaphore.acquire();
  try {
    if (signal.aborted) return null;
    return await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "Accept-Language": "en",
      },
      signal: requestSignal(FETCH_TIMEOUT_MS, signal),
    });
  } catch {
    return null;
  } finally {
    websiteSemaphore.release();
  }
}

function requestSignal(timeoutMs: number, outer: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    return AbortSignal.any([timeout, outer]);
  } catch {
    return timeout;
  }
}

function parseRobots(text: string): RobotsRules {
  const groups: Array<{ agents: string[]; disallow: string[]; allow: string[] }> = [];
  let current: { agents: string[]; disallow: string[]; allow: string[] } | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      if (!current || current.disallow.length > 0 || current.allow.length > 0) {
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((field === "disallow" || field === "allow") && current) {
      if (value === "") continue;
      if (field === "disallow") current.disallow.push(value);
      else current.allow.push(value);
    }
  }

  const specific = groups.find((group) => group.agents.includes(ROBOTS_TOKEN.toLowerCase()));
  const wildcard = groups.find((group) => group.agents.includes("*"));
  const chosen = specific ?? wildcard;

  if (!chosen) return { disallow: [], allow: [], allowAll: true };
  return {
    disallow: chosen.disallow,
    allow: chosen.allow,
    allowAll: chosen.disallow.length === 0,
  };
}

async function getRobots(origin: string, signal: AbortSignal): Promise<RobotsRules> {
  const cached = robotsCache.get(origin);
  if (cached && cached.expires > Date.now()) return cached.rules;

  const response = await limitedFetch(`${origin}/robots.txt`, signal);
  let rules: RobotsRules = { disallow: [], allow: [], allowAll: true };

  if (response?.ok) {
    try {
      rules = parseRobots(await response.text());
    } catch {
      rules = { disallow: [], allow: [], allowAll: true };
    }
  }

  robotsCache.set(origin, { expires: Date.now() + ROBOTS_TTL_MS, rules });
  return rules;
}

function isAllowed(pathname: string, rules: RobotsRules): boolean {
  if (rules.allowAll) return true;
  const path = pathname || "/";

  const longest = (prefixes: string[]): number =>
    prefixes.reduce((best, prefix) => {
      if (prefix === "/") return Math.max(best, 1);
      return path.startsWith(prefix) ? Math.max(best, prefix.length) : best;
    }, -1);

  const disallowScore = longest(rules.disallow);
  const allowScore = longest(rules.allow);
  if (disallowScore === -1) return true;
  return allowScore >= disallowScore;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x40;/gi, "@")
    .replace(/&#64;/g, "@")
    .replace(/&#x2e;/gi, ".")
    .replace(/&#46;/g, ".")
    .replace(/&commat;/gi, "@")
    .replace(/&period;/gi, ".")
    .replace(/&amp;/gi, "&");
}

const STOP_LOCALS = new Set([
  "us",
  "me",
  "it",
  "here",
  "there",
  "contact",
  "reach",
  "email",
  "mail",
  "call",
  "visit",
  "our",
  "your",
]);

const BAD_LOCAL = /^(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|abuse|hostmaster|root)$/i;
const HASH_LOCAL = /^[a-f0-9]{16,}$/i;
const UUID_LOCAL = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-/i;
const IMAGE_DOMAIN = /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|woff2?|ttf)$/i;

const BAD_DOMAINS = [
  "sentry.io",
  "wixpress.com",
  "example.com",
  "example.org",
  "example.net",
  "domain.com",
  "yourdomain.com",
  "placeholder.com",
  "email.com",
  "test.com",
  "localhost",
];

const TWO_PART_TLDS = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "co.za",
  "com.ng",
  "com.br",
  "co.in",
  "com.sg",
  "com.my",
  "co.ke",
  "com.gh",
  "com.pk",
  "com.eg",
  "co.jp",
  "or.jp",
  "ne.jp",
  "com.tr",
  "com.mx",
  "com.ar",
  "com.co",
]);

function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  if (TWO_PART_TLDS.has(lastTwo)) return parts.slice(-3).join(".");
  return lastTwo;
}

function emailDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

export function isJunkEmail(email: string): boolean {
  const lower = email.toLowerCase();
  if (!isSyntaxValid(lower)) return true;
  if (lower.length > 254) return true;

  const [local, domain] = lower.split("@");
  if (!local || !domain) return true;
  if (STOP_LOCALS.has(local)) return true;
  if (BAD_LOCAL.test(local)) return true;
  if (HASH_LOCAL.test(local) || UUID_LOCAL.test(local)) return true;
  if (local.includes("2x") || local.includes("3x")) return true;
  if (IMAGE_DOMAIN.test(domain)) return true;
  if (domain.startsWith("sentry") || domain.endsWith(".sentry.io")) return true;

  return BAD_DOMAINS.some((bad) => domain === bad || domain.endsWith(`.${bad}`));
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function deobfuscate(value: string): string {
  return value
    .replace(
      /([a-z0-9._%+-]+)\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\{\s*dot\s*\}|\sdot\s)\s*([a-z]{2,})/gi,
      "$1.$2",
    )
    .replace(
      /([a-z0-9._%+-]+)\s*(?:\[\s*at\s*\]|\(\s*at\s*\)|\{\s*at\s*\}|\sat\s)\s*([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi,
      "$1@$2",
    );
}

const MAILTO_RE = /mailto:([^"'<>\s?#]+)/gi;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

interface LocatedEmail extends FoundEmail {
  score: number;
  sameDomain: boolean;
}

/** Reusable extraction result for the crawler and the live finder. */
export interface ExtractedEmail {
  email: string;
  source: FoundEmail["source"];
  score: number;
  sameDomain: boolean;
}

function extractFromHtml(html: string, siteHost: string): LocatedEmail[] {
  const decoded = decodeEntities(html);
  const found = new Map<string, LocatedEmail>();
  const siteDomain = registrableDomain(siteHost);

  const add = (raw: string, source: FoundEmail["source"]) => {
    const email = normalizeEmail(firstEmail(raw));
    if (!email || isJunkEmail(email)) return;

    const sameDomain = registrableDomain(emailDomain(email)) === siteDomain;
    const score = (sameDomain ? 100 : 0) + (source === "website-mailto" ? 20 : 10);

    const existing = found.get(email);
    if (!existing || score > existing.score) {
      found.set(email, { email, source, score, sameDomain });
    }
  };

  for (const match of decoded.matchAll(MAILTO_RE)) {
    add(safeDecode(match[1]), "website-mailto");
  }

  const text = deobfuscate(decoded);
  for (const match of text.matchAll(EMAIL_RE)) {
    add(match[0], "website-text");
  }

  return [...found.values()];
}

/** Public, side-effect-free HTML extraction shared with the crawler. */
export function extractEmailsFromHtml(html: string, siteHost: string): ExtractedEmail[] {
  return extractFromHtml(html, siteHost).map(({ email, source, score, sameDomain }) => ({
    email,
    source,
    score,
    sameDomain,
  }));
}

function pageUrls(website: string): URL[] {
  const base = new URL(website);
  const urls = new Map<string, URL>();
  urls.set(base.href, base);

  for (const path of ["/contact", "/contact-us", "/about"]) {
    const url = new URL(path, base.origin);
    urls.set(url.href, url);
  }

  return [...urls.values()];
}

async function readLimited(response: Response): Promise<string> {
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_HTML_BYTES) {
    return new TextDecoder("utf-8").decode(buffer.slice(0, MAX_HTML_BYTES));
  }
  return new TextDecoder("utf-8").decode(buffer);
}

export interface EmailLookupResult {
  emails: FoundEmail[];
  websitesChecked: number;
  cached: boolean;
}

export async function findEmails(
  candidate: Candidate,
  options: { signal: AbortSignal },
): Promise<EmailLookupResult> {
  // Step A — the source already publishes an address.
  if (candidate.publishedEmail) {
    const email = normalizeEmail(candidate.publishedEmail);
    if (isSyntaxValid(email) && !isJunkEmail(email)) {
      return { emails: [{ email, source: "osm-tag" }], websitesChecked: 0, cached: false };
    }
  }

  if (!candidate.website) {
    return { emails: [], websitesChecked: 0, cached: false };
  }

  const cacheKey = `email:v1:${candidate.website}`;
  const cached = await getCached<FoundEmail[]>(cacheKey);
  if (cached) {
    return { emails: cached, websitesChecked: 0, cached: true };
  }

  if (options.signal.aborted) {
    return { emails: [], websitesChecked: 0, cached: false };
  }

  let siteHost: string;
  let pages: URL[];
  try {
    const base = new URL(candidate.website);
    if (base.protocol !== "http:" && base.protocol !== "https:") {
      return { emails: [], websitesChecked: 0, cached: false };
    }
    siteHost = base.hostname;
    pages = pageUrls(base.href);
  } catch {
    return { emails: [], websitesChecked: 0, cached: false };
  }

  const robots = await getRobots(new URL(candidate.website).origin, options.signal);
  let websitesChecked = 0;

  const results = await Promise.all(
    pages.map(async (page) => {
      if (options.signal.aborted) return [] as LocatedEmail[];
      if (!isAllowed(page.pathname, robots)) return [] as LocatedEmail[];

      websitesChecked += 1;
      const response = await limitedFetch(page.href, options.signal);
      if (!response?.ok) return [] as LocatedEmail[];

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType && !/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
        return [] as LocatedEmail[];
      }

      try {
        const html = await readLimited(response);
        return extractFromHtml(html, siteHost);
      } catch {
        return [] as LocatedEmail[];
      }
    }),
  );

  const merged = new Map<string, LocatedEmail>();
  for (const list of results) {
    for (const item of list) {
      const existing = merged.get(item.email);
      if (!existing || item.score > existing.score) merged.set(item.email, item);
    }
  }

  const emails = [...merged.values()]
    .sort((a, b) => b.score - a.score || a.email.localeCompare(b.email))
    .slice(0, MAX_EMAILS_PER_BUSINESS)
    .map(({ email, source }) => ({ email, source }));

  if (emails.length > 0) {
    await setCached(cacheKey, emails, EMAIL_TTL);
  }

  return { emails, websitesChecked: websitesChecked > 0 ? 1 : 0, cached: false };
}
