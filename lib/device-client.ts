"use client";

const DEVICE_STORAGE_KEY = "aplify.device.v1";
const VALID_DEVICE = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Stable browser id stored in localStorage and sent to the server as a header.
 * It is another key for the free quota, not the place where usage is stored.
 */
export function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    if (existing && VALID_DEVICE.test(existing)) return existing;

    const created =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    window.localStorage.setItem(DEVICE_STORAGE_KEY, created);
    return created;
  } catch {
    // Private mode or storage disabled: the server still has IP and email keys.
    return "";
  }
}

export function deviceHeaders(): Record<string, string> {
  const id = getDeviceId();
  return id ? { "x-aplify-device": id } : {};
}
