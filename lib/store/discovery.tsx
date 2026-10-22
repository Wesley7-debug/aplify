"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { deviceHeaders } from "@/lib/device-client";
import type { Lead, RunError, RunStatus, SearchOutcome, SearchQuery, SearchResult } from "@/lib/types";

export type QueryFieldErrors = Partial<Record<"audience" | "location", string>>;

const EMPTY_QUERY: SearchQuery = { audience: "", location: "", limit: 10 };

const MAX_SEEN_TOKENS = 600;
const MAX_SEEN_QUERIES = 40;
const MAX_SEEN_SENT = 300;

type SeenMap = Record<string, string[]>;

interface DiscoveryContextValue {
  query: SearchQuery;
  hydrated: boolean;
  fieldErrors: QueryFieldErrors;
  status: RunStatus;
  result: SearchResult | null;
  error: RunError | null;
  /** How many already-seen businesses are stored for the current query. */
  seenCount: number;
  loadingMore: boolean;
  patchQuery: (patch: Partial<SearchQuery>) => void;
  reset: () => void;
  run: (seenOverride?: SeenMap) => Promise<void>;
  /** Run a suggestion immediately (patches the query too). */
  runQuery: (audience: string, location: string) => Promise<void>;
  loadMore: () => Promise<void>;
  /** Record that the user emailed this business, so it never returns again. */
  markContacted: (lead: Lead) => Promise<void>;
}

const DiscoveryContext = createContext<DiscoveryContextValue | null>(null);

function queryKey(query: SearchQuery): string {
  return `${query.audience.trim().toLowerCase()}|${query.location.trim().toLowerCase()}`;
}

function rememberSeen(map: SeenMap, key: string, tokens: string[]): SeenMap {
  if (tokens.length === 0) return map;

  const merged = Array.from(new Set([...(map[key] ?? []), ...tokens])).slice(-MAX_SEEN_TOKENS);
  const others = Object.entries(map).filter(([entryKey]) => entryKey !== key);
  const nextEntries = [
    ...others.slice(-(MAX_SEEN_QUERIES - 1)),
    [key, merged] as [string, string[]],
  ];

  return Object.fromEntries(nextEntries);
}

interface ApiError {
  error?: { message?: string; field?: "audience" | "location" };
  outcome?: SearchOutcome;
}

export function DiscoveryProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState<SearchQuery>(EMPTY_QUERY);
  const [seen, setSeen] = useState<SeenMap>({});
  const hydrated = true;
  const [status, setStatus] = useState<RunStatus>("idle");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<RunError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<QueryFieldErrors>({});
  const [loadingMore, setLoadingMore] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const patchQuery = useCallback(
    (patch: Partial<SearchQuery>) => {
      setQuery((previous) => ({ ...previous, ...patch }));
      setFieldErrors({});
      setError(null);
      setStatus((current) => (current === "error" ? "idle" : current));
    },
    [setQuery],
  );

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    setQuery({ ...EMPTY_QUERY });
    setResult(null);
    setError(null);
    setFieldErrors({});
    setStatus("idle");
  }, [setQuery]);

  const request = useCallback(
    async (options: {
      page: number;
      append: boolean;
      activeSeen: SeenMap;
      requestQuery: SearchQuery;
      key: string;
    }): Promise<void> => {
      const { page, append, activeSeen, requestQuery, key } = options;
      const limit = requestQuery.limit;

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      if (append) setLoadingMore(true);
      else {
        setStatus("running");
        setError(null);
        setResult(null);
      }

      const seenTokens = (activeSeen[key] ?? [])
        .filter((token) => !token.includes("@"))
        .slice(-MAX_SEEN_SENT);

      const params = new URLSearchParams({
        audience: requestQuery.audience,
        location: requestQuery.location,
        limit: String(limit),
        page: String(page),
      });
      if (seenTokens.length > 0) params.set("seen", seenTokens.join(","));

      try {
        const response = await fetch(`/api/search?${params.toString()}`, {
          signal: controller.signal,
          headers: { Accept: "application/json", ...deviceHeaders() },
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as ApiError | null;
          if (data?.outcome === "auth_required") {
            window.location.reload();
            return;
          }
          const failure = new Error(
            data?.error?.message ?? "The search could not be completed.",
          ) as Error & { field?: "audience" | "location"; outcome?: SearchOutcome };
          failure.field = data?.error?.field;
          failure.outcome = data?.outcome;
          throw failure;
        }

        const data = (await response.json()) as SearchResult;
        const leads = append
          ? [...(result?.leads ?? []), ...data.leads]
          : data.leads;

        setResult({
          ...data,
          leads,
          count: leads.length,
        });
        setStatus(leads.length > 0 ? "success" : "empty");

        if (data.leads.length > 0) {
          const tokens = data.leads.flatMap((lead: Lead) => [
            lead.id.toLowerCase(),
            ...(lead.email ? [lead.email.toLowerCase()] : []),
          ]);
          setSeen((previous) => rememberSeen(previous, key, tokens));
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        const failure = cause as Error & {
          field?: "audience" | "location";
          outcome?: SearchOutcome;
        };
        setStatus("error");
        setError({
          title: failure.outcome === "daily_limit" ? "Limit reached" : "Search failed",
          message:
            cause instanceof Error ? cause.message : "Something went wrong. Please try again.",
          field: failure.field,
          outcome: failure.outcome,
        });
      } finally {
        if (append) setLoadingMore(false);
      }
    },
    [result, setSeen],
  );

  const run = useCallback(
    async (seenOverride?: SeenMap) => {
      const next: QueryFieldErrors = {};
      if (query.audience.trim().length < 2) next.audience = "Enter a business type.";
      if (query.location.trim().length < 2) next.location = "Enter a location.";
      setFieldErrors(next);

      if (Object.keys(next).length > 0) {
        setStatus("error");
        setError({
          title: "Add a bit more detail",
          message: Object.values(next).join(" "),
          field: next.audience ? "audience" : "location",
        });
        return;
      }

      const limit = Math.min(Math.max(Math.round(query.limit || 10), 1), 30);
      const requestQuery: SearchQuery = {
        audience: query.audience.trim(),
        location: query.location.trim(),
        limit,
      };
      const key = queryKey(requestQuery);
      await request({
        page: 1,
        append: false,
        activeSeen: seenOverride ?? seen,
        requestQuery,
        key,
      });
    },
    [query, request, seen],
  );

  const loadMore = useCallback(async () => {
    if (!result || !result.hasMore || loadingMore) return;
    const key = queryKey(result.query);
    await request({
      page: result.page + 1,
      append: true,
      activeSeen: seen,
      requestQuery: result.query,
      key,
    });
  }, [loadingMore, request, result, seen]);

  const runQuery = useCallback(
    async (audience: string, location: string) => {
      const requestQuery: SearchQuery = {
        audience: audience.trim(),
        location: location.trim(),
        limit: Math.min(Math.max(Math.round(query.limit || 10), 1), 30),
      };
      patchQuery({ audience: requestQuery.audience, location: requestQuery.location });
      await request({
        page: 1,
        append: false,
        activeSeen: seen,
        requestQuery,
        key: queryKey(requestQuery),
      });
    },
    [patchQuery, query.limit, request, seen],
  );

  const markContacted = useCallback(
    async (lead: Lead) => {
      const key = queryKey(query);
      const tokens = [lead.id.toLowerCase()];
      if (lead.email) tokens.push(lead.email.toLowerCase());
      setSeen((previous) => rememberSeen(previous, key, tokens));
      try {
        await fetch("/api/seen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({
            leadId: lead.id,
            email: lead.email ?? undefined,
          }),
        });
      } catch {
        // The email client still opens; the browser keeps its local seen list.
      }
    },
    [query, setSeen],
  );

  const value = useMemo(
    () => ({
      query,
      hydrated,
      fieldErrors,
      status,
      result,
      error,
      seenCount: (seen[queryKey(query)] ?? []).filter((token) => token.includes("@")).length,
      loadingMore,
      patchQuery,
      reset,
      run,
      runQuery,
      loadMore,
      markContacted,
    }),
    [
      query,
      hydrated,
      fieldErrors,
      status,
      result,
      error,
      seen,
      loadingMore,
      patchQuery,
      reset,
      run,
      runQuery,
      loadMore,
      markContacted,
    ],
  );

  return <DiscoveryContext.Provider value={value}>{children}</DiscoveryContext.Provider>;
}

export function useDiscovery(): DiscoveryContextValue {
  const context = useContext(DiscoveryContext);
  if (!context) throw new Error("useDiscovery must be used inside <DiscoveryProvider>");
  return context;
}
