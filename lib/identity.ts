import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/auth";
import { DEFAULT_OWNER_EMAIL } from "@/lib/owner";

/**
 * Lightweight identity for the public search page.
 *
 * Nobody has to sign up. A stable httpOnly cookie identifies an anonymous
 * browser, and an optional email identifies a person across devices. Admin
 * sessions and the configured owner email are exempt from the guest cap.
 */

export const UID_COOKIE = "aplify_uid";
export const UID_MAX_AGE = 365 * 24 * 60 * 60;

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

export function uidFromRequest(request: NextRequest): string | null {
  const value = request.cookies.get(UID_COOKIE)?.value ?? "";
  if (!/^[0-9a-f-]{16,64}$/i.test(value)) return null;
  return value;
}

export function userKeyFor(options: {
  email: string | null;
  uid: string | null;
  admin: boolean;
}): string {
  if (options.email) return `email:${options.email}`;
  if (options.admin) return "admin";
  return `anon:${options.uid ?? "no-cookie"}`;
}
