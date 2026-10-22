/**
 * Admin session helpers.
 *
 * A cookie is a signed expiry timestamp: `<expiresAt>.<hmac>`. The HMAC key is
 * `ADMIN_SESSION_SECRET` when set, otherwise `ADMIN_PASSWORD`. No session table
 * or external service is needed, so this works in the proxy runtime too.
 *
 * Uses Web Crypto only — safe in both Node and edge runtimes.
 */

export const ADMIN_COOKIE = "aplify_admin";
export const ADMIN_SESSION_SECONDS = 12 * 60 * 60;

function encoder(): TextEncoder {
  return new TextEncoder();
}

function toBase64Url(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function secret(): string {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || "";
}

export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

async function sign(payload: string): Promise<string | null> {
  const keyValue = secret();
  if (!keyValue) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder().encode(keyValue),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder().encode(payload));
  return toBase64Url(signature);
}

export async function createSessionToken(): Promise<string | null> {
  const expiresAt = Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS;
  const payload = `v1:${expiresAt}`;
  const signature = await sign(payload);
  if (!signature) return null;
  return `${expiresAt}.${signature}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [expiresRaw, signature] = token.split(".");
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || !signature) return false;
  if (expiresAt <= Math.floor(Date.now() / 1000)) return false;

  const expected = await sign(`v1:${expiresAt}`);
  if (!expected || expected.length !== signature.length) return false;

  // Constant-time comparison of the two signatures.
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  return mismatch === 0;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_SESSION_SECONDS,
  };
}

/** Length-safe comparison for the submitted password. */
export function passwordMatches(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!expected) return false;
  const length = Math.max(candidate.length, expected.length);
  let mismatch = candidate.length ^ expected.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (candidate.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}
