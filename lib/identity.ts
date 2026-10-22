import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/auth";
import { DEFAULT_OWNER_EMAIL } from "@/lib/owner";

/**
 * Public-site identity is the email entered in the sign-in modal. It is stored
 * in a signed httpOnly cookie and used as the key for daily limits, contacted
 * businesses and history. Admin password sessions remain separate.
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

export function emailUserKey(email: string): string {
  return `email:${email}`;
}

export async function isAdminRequest(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(ADMIN_COOKIE)?.value;
  return verifySessionToken(token);
}
