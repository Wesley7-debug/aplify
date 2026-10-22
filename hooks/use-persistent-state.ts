"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

/**
 * localStorage-backed state that is safe for SSR and for the React Compiler
 * lint rules.
 *
 * Reading goes through `useSyncExternalStore`, which gives us a deterministic
 * server snapshot (`null`) during hydration and then swaps to the stored value.
 * That avoids both hydration mismatches and the "setState inside an effect"
 * anti-pattern. Writes go through a small in-memory mirror so reads stay
 * consistent even when localStorage is unavailable (private mode, quota).
 */

/** Raw JSON strings, keyed by storage key. Doubles as a cache and a fallback. */
const rawCache = new Map<string, string | null>();
const listeners = new Map<string, Set<() => void>>();

function notify(key: string): void {
  const set = listeners.get(key);
  if (!set) return;
  for (const listener of set) listener();
}

function subscribeToKey(key: string, listener: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);

  // Keep other tabs (and other components) in sync.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === key) {
      rawCache.delete(key);
      listener();
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    set.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function readRaw(key: string): string | null {
  if (rawCache.has(key)) return rawCache.get(key) ?? null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    raw = null;
  }
  rawCache.set(key, raw);
  return raw;
}

function writeRaw(key: string, raw: string | null): void {
  rawCache.set(key, raw);
  try {
    if (raw === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, raw);
  } catch {
    // Quota or privacy-mode failures are non-fatal for a demo workspace:
    // the in-memory mirror above still serves consistent reads.
  }
  notify(key);
}

export function usePersistentState<T>(
  key: string,
  initial: T,
): [T, (value: T | ((previous: T) => T)) => void, boolean] {
  // Only the first value is kept, so callers can pass literals (`[]`) safely.
  const [initialValue] = useState<T>(initial);

  const subscribe = useCallback(
    (listener: () => void) => subscribeToKey(key, listener),
    [key],
  );
  const getSnapshot = useCallback(() => readRaw(key), [key]);
  const getServerSnapshot = useCallback(() => null, []);

  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const hydrated = useHydrated();

  // `raw` is a string, so the parsed value only changes when storage changes.
  const value = useMemo<T>(() => {
    if (raw === null) return initialValue;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return initialValue;
    }
  }, [raw, initialValue]);

  const update = useCallback(
    (next: T | ((previous: T) => T)) => {
      const currentRaw = readRaw(key);
      let current = initialValue;
      if (currentRaw !== null) {
        try {
          current = JSON.parse(currentRaw) as T;
        } catch {
          current = initialValue;
        }
      }
      const resolved =
        typeof next === "function" ? (next as (previous: T) => T)(current) : next;
      writeRaw(key, JSON.stringify(resolved));
    },
    [key, initialValue],
  );

  return [value, update, hydrated];
}

/**
 * False on the server and during the hydration render, true afterwards.
 * Implemented as an external store so no effect is needed.
 */
export function useHydrated(): boolean {
  const subscribe = useCallback(() => () => {}, []);
  const getSnapshot = useCallback(() => true, []);
  const getServerSnapshot = useCallback(() => false, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
