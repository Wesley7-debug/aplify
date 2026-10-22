import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/auth";
import { DEFAULT_OWNER_EMAIL } from "@/lib/owner";

/**
 * Lightweight identity for the public search page.
 *
 * The public allowance, contacted list and history are keyed by the caller's IP
 * address. That cannot be reset by clearing local storage or cookies. An
 * optional email only identifies the configured owner, and admin sessions are
 * exempt from the daily cap.
 */

export function normalizeUserEmail(value: string | null | undefined): string | null {
  const email = (value ?? "").trim().toLowerCase();
  if (email.length < 5 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function ownerEmails(): Set<string> {
  const configured = process.env.APLIFY_OWNER_EMAILS ?? DEFAULT_OWNER_EMAIL;
  return new Set(
    configured
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isOwnerEmail(email: string | null): boolean {
  return Boolean(email && ownerEmails().has(email));
}

export async function isAdminRequest(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(ADMIN_COOKIE)?.value;
  return verifySessionToken(token);
}

/**
 * The public allowance is tied to the caller's network address. Vercel forwards
 * the client address in `x-forwarded-for`; `x-real-ip` and Cloudflare's header
 * cover the other common proxies. Local development falls back to `unknown`.
 */
export function clientIpFromRequest(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const candidates = [
    forwarded.split(",")[0],
    request.headers.get("x-real-ip"),
    request.headers.get("cf-connecting-ip"),
  ];
  for (const candidate of candidates) {
    const value = (candidate ?? "").trim();
    if (value) return value.slice(0, 100);
  }
  return "unknown";
}

/** Stable per-IP key used for daily quotas, contacted lists and history. */
export function ipUserKey(request: NextRequest): string {
  // Store a one-way digest rather than the raw address.
  const digest = createHash("sha256").update(clientIpFromRequest(request)).digest("hex");
  return `ip:${digest.slice(0, 32)}`;
}

