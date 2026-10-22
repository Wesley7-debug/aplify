import type { NextRequest, NextResponse } from "next/server";
import { emailUserKey, ipUserKey, normalizeUserEmail } from "@/lib/identity";

/**
 * Email session and device identity for the public site.
 *
 * The email is stored in a signed, httpOnly cookie. The free limit is checked
 * against all of: the email, the hashed network address, and the browser device
 * id (localStorage header plus an httpOnly cookie fallback). That means changing
 * only the email, or only the device, does not reset the allowance.
 *
 * Admin access is handled separately by the /admin password session.
 */

export const USER_COOKIE = "aplify_user";
export const USER_SESSION_SECONDS = 30 * 24 * 60 * 60;

export const DEVICE_COOKIE = "aplify_device";
export const DEVICE_MAX_AGE = 365 * 24 * 60 * 60;

export const USER_DAILY_LIMIT = 10;
export const OWNER_SEARCH_LIMIT = 30;
export const USER_SEARCH_LIMIT = 10;

const VALID_DEVICE = /^[A-Za-z0-9-]{8,64}$/;

function secret(): string {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || "";
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
      Math.ceil(value.length / 4) * 4,
      "=",
    );
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

async function sign(payload: string): Promise<string | null> {
  const keyValue = secret();
  if (!keyValue) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(keyValue),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return toBase64Url(new Uint8Array(signature));
}

export async function createUserToken(email: string): Promise<string | null> {
  const expiresAt = Math.floor(Date.now() / 1_000) + USER_SESSION_SECONDS;
  const encoded = toBase64Url(new TextEncoder().encode(email));
  const payload = `${expiresAt}.${encoded}`;
  const signature = await sign(`v1:user:${payload}`);
  if (!signature) return null;
  return `${payload}.${signature}`;
}

export async function verifyUserToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const [expiresRaw, encoded, signature] = token.split(".");
  if (!expiresRaw || !encoded || !signature) return null;

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1_000)) {
    return null;
  }

  const expected = await sign(`v1:user:${expiresRaw}.${encoded}`);
  if (!expected || expected.length !== signature.length) return null;

  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  if (mismatch !== 0) return null;

  const decoded = fromBase64Url(encoded);
  return normalizeUserEmail(decoded);
}

export async function authenticatedEmail(request: NextRequest): Promise<string | null> {
  return verifyUserToken(request.cookies.get(USER_COOKIE)?.value);
}

export function userCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: USER_SESSION_SECONDS,
  };
}

function validDeviceId(value: string | null | undefined): string | null {
  const id = (value ?? "").trim();
  return VALID_DEVICE.test(id) ? id : null;
}

/** All device ids on this request. Header and cookie may differ after a reset. */
export function deviceIdsFromRequest(request: NextRequest): string[] {
  const ids = new Set<string>();
  const header = validDeviceId(request.headers.get("x-aplify-device"));
  const cookie = validDeviceId(request.cookies.get(DEVICE_COOKIE)?.value);
  if (header) ids.add(header);
  if (cookie) ids.add(cookie);
  return [...ids];
}

export function deviceCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DEVICE_MAX_AGE,
  };
}

/** Ensure a device cookie exists, preferring an existing cookie then the header. */
export function ensureDeviceCookie(request: NextRequest, response: NextResponse): void {
  const existing = validDeviceId(request.cookies.get(DEVICE_COOKIE)?.value);
  const header = validDeviceId(request.headers.get("x-aplify-device"));
  const id =
    existing ??
    header ??
    (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
  response.cookies.set(DEVICE_COOKIE, id, deviceCookieOptions());
}

/** Every key the free quota is checked against for this request. */
export function quotaKeysFor(request: NextRequest, email: string): string[] {
  const keys = new Set<string>([emailUserKey(email), ipUserKey(request)]);
  for (const id of deviceIdsFromRequest(request)) {
    keys.add(`device:${id}`);
  }
  return [...keys];
}

export function searchLimitFor(owner: boolean): number {
  return owner ? OWNER_SEARCH_LIMIT : USER_SEARCH_LIMIT;
}
