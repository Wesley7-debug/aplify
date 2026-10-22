import { extractEmailsFromHtml, isJunkEmail } from "@/lib/enrich/email-finder";
import { isRoleAddress } from "@/lib/osm/email";

/**
 * Phase B: look for a published email on a business website.
 *
 * Respectful by construction: robots.txt is checked, requests are spaced one
 * second apart per domain, at most five domains are fetched at once, each
 * response is capped at 500KB and redirects are followed manually (max two).
 */

const USER_AGENT =
  "Mozilla/5.0 (compatible; AplifyBot/1.0; +https://github.com/aplify)";
const FETCH_TIMEOUT_MS = 5_000;
const MAX_BYTES = 500_000;
const MAX_REDIRECTS = 2;
const MAX_CONCURRENT = 5;
const DOMAIN_INTERVAL_MS = 1_000;

const PAGES = ["/", "/contact", "/contact-us", "/about"];

const COMMON_PROVIDERS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.fr",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "protonmail.com",
  "proton.me",
  "aol.com",
  "mail.com",
  "gmx.com",
  "gmx.net",
  "yandex.com",
  "zoho.com",
  "web.de",
  "t-online.de",
]);

class Semaphore {
  private active = 0;
  private waiters: Array<() => void> = [];

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
    this.waiters.shift()?.();
  }
}

const semaphore = new Semaphore(MAX_CONCURRENT);
const domainChains = new Map<string, Promise<void>>();
const domainLastStart = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scheduleDomain(host: string): Promise<void> {
  const previous = domainChains.get(host) ?? Promise.resolve();
  const next = previous.then(async () => {
    const elapsed = Date.now() - (domainLastStart.get(host) ?? 0);
    const wait = Math.max(0, DOMAIN_INTERVAL_MS - elapsed);
    if (wait > 0) await sleep(wait);
    domainLastStart.set(host, Date.now());
  });
  domainChains.set(
    host,
    next.catch(() => undefined),
  );
  await next;
}

interface RobotsRules {
  disallow: string[];
  allow: string[];
}

const robotsCache = new Map<string, RobotsRules>();

function parseRobots(text: string): RobotsRules {
  const groups: Array<{ agents: string[]; disallow: string[]; allow: string[] }> = [];
  let current: { agents: string[]; disallow: string[]; allow: string[] } | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
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
      if (!value) continue;
      if (field === "disallow") current.disallow.push(value);
      else current.allow.push(value);
    }
  }

  const specific = groups.find((group) => group.agents.some((agent) => agent.includes("aplify")));
  const wildcard = groups.find((group) => group.agents.includes("*"));
  const chosen = specific ?? wildcard;
  if (!chosen) return { disallow: [], allow: [] };
  return { disallow: chosen.disallow, allow: chosen.allow };
}

async function getRobots(origin: string, signal: AbortSignal): Promise<RobotsRules> {
  const cached = robotsCache.get(origin);
  if (cached) return cached;

  try {
    const response = await request(`${origin}/robots.txt`, signal);
    const rules =
      response && response.ok ? parseRobots(await readText(response)) : { disallow: [], allow: [] };
    robotsCache.set(origin, rules);
    return rules;
  } catch {
    const rules = { disallow: [], allow: [] };
    robotsCache.set(origin, rules);
    return rules;
  }
}

function isAllowed(pathname: string, rules: RobotsRules): boolean {
  const path = pathname || "/";
  const longest = (prefixes: string[], floor: number): number =>
    prefixes.reduce((best, prefix) => {
      if (prefix === "/") return Math.max(best, 1);
      return path.startsWith(prefix) ? Math.max(best, prefix.length) : best;
    }, floor);

  const disallow = longest(rules.disallow, -1);
  if (disallow === -1) return true;
  return longest(rules.allow, -1) >= disallow;
}

function signalWithTimeout(outer: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  try {
    return AbortSignal.any([timeout, outer]);
  } catch {
    return timeout;
  }
}

async function request(url: string, outer: AbortSignal): Promise<Response | null> {
  const host = new URL(url).host;
  await semaphore.acquire();
  try {
    await scheduleDomain(host);
    return await fetch(url, {
      redirect: "manual",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "Accept-Language": "en",
      },
      signal: signalWithTimeout(outer),
    });
  } catch {
    return null;
  } finally {
    semaphore.release();
  }
}

async function fetchPage(url: string, outer: AbortSignal): Promise<Response | null> {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await request(current, outer);
    if (!response) return null;
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    try {
      current = new URL(location, current).href;
    } catch {
      return null;
    }
  }

  return null;
}

async function readText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = MAX_BYTES - size;
      const slice = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(slice);
      size += slice.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(buffer);
}

function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  return parts.slice(-2).join(".");
}

export interface WebsiteEmailResult {
  email: string | null;
  pagesChecked: number;
}

/**
 * Check one website. Always resolves; callers persist `website_checked_at`
 * regardless of whether an address was found.
 */
export async function findWebsiteEmail(
  website: string,
  outer: AbortSignal,
): Promise<WebsiteEmailResult> {
  if (outer.aborted) return { email: null, pagesChecked: 0 };

  let base: URL;
  try {
    base = new URL(website);
  } catch {
    return { email: null, pagesChecked: 0 };
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    return { email: null, pagesChecked: 0 };
  }

  const rules = await getRobots(base.origin, outer);

  const urls: string[] = [];
  for (const path of PAGES) {
    try {
      const url = new URL(path, base.origin);
      if (!isAllowed(url.pathname, rules)) continue;
      if (!urls.includes(url.href)) urls.push(url.href);
    } catch {
      // skip malformed page URL
    }
  }

  interface Candidate {
    email: string;
    sameDomain: boolean;
    isRole: boolean;
    mailto: boolean;
  }

  const found = new Map<string, Candidate>();
  let pagesChecked = 0;

  for (const url of urls) {
    if (outer.aborted) break;
    const response = await fetchPage(url, outer);
    if (!response?.ok) continue;

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/text\/html|application\/xhtml|text\/plain/i.test(contentType)) continue;

    pagesChecked += 1;
    let html = "";
    try {
      html = await readText(response);
    } catch {
      continue;
    }

    for (const candidate of extractEmailsFromHtml(html, base.hostname)) {
      if (isJunkEmail(candidate.email)) continue;
      const emailDomain = registrableDomain(candidate.email.split("@")[1] ?? "");
      const allowed = candidate.sameDomain || COMMON_PROVIDERS.has(emailDomain);
      if (!allowed) continue;

      const value: Candidate = {
        email: candidate.email,
        sameDomain: candidate.sameDomain,
        isRole: isRoleAddress(candidate.email),
        mailto: candidate.source === "website-mailto",
      };
      const existing = found.get(value.email);
      if (!existing || (!value.isRole && existing.isRole) || (value.mailto && !existing.mailto)) {
        found.set(value.email, value);
      }
    }
  }

  const ranked = [...found.values()].sort((a, b) => {
    if (a.sameDomain !== b.sameDomain) return a.sameDomain ? -1 : 1;
    if (a.isRole !== b.isRole) return a.isRole ? 1 : -1;
    if (a.mailto !== b.mailto) return a.mailto ? -1 : 1;
    return a.email.localeCompare(b.email);
  });

  return { email: ranked[0]?.email ?? null, pagesChecked };
}
