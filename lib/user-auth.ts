import type { NextRequest } from "next/server";
import { normalizeUserEmail } from "@/lib/identity";

/**
 * Email session for the public site.
 *
 * The browser stores a signed, httpOnly cookie. The email inside it is the key
 * for daily limits, contacted businesses and history, so the same person keeps
 * their allowance even after clearing local storage. The cookie is signed with
 * ADMIN_SESSION_SECRET (or ADMIN_PASSWORD when the former is unset).
 */

export const USER_COOKIE = "aplify_user";
export const USER_SESSION_SECONDS = 30 * 24 * 60 * 60;

export const USER_DAILY_LIMIT = 10;
export const OWNER_DAILY_LIMIT = 30;

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

export function dailyLimitFor(owner: boolean): number {
  return owner ? OWNER_DAILY_LIMIT : USER_DAILY_LIMIT;
}

export function searchLimitFor(owner: boolean): number {
  return owner ? OWNER_DAILY_LIMIT : USER_DAILY_LIMIT;
}
