import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/auth";

/**
 * Public-site identity is the email entered in the sign-in modal. It is stored
 * in a signed httpOnly cookie. The free 20-hour limit is checked against the
 * email, network address and device id together, so changing only one of them
 * does not reset the allowance. Admin password sessions remain separate.
 */

export function normalizeUserEmail(value: string | null | undefined): string | null {
  const email = (value ?? "").trim().toLowerCase();
  if (email.length < 5 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function emailUserKey(email: string): string {
  return `email:${email}`;
}

/** Vercel forwards the client address; local development falls back to unknown. */
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

/** Hashed network key, used alongside email and device id for the free limit. */
export function ipUserKey(request: NextRequest): string {
  const digest = createHash("sha256").update(clientIpFromRequest(request)).digest("hex");
  return `ip:${digest.slice(0, 32)}`;
}

export async function isAdminRequest(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(ADMIN_COOKIE)?.value;
  return verifySessionToken(token);
}
