/**
 * Typed failures so the route can tell an outage apart from "nothing matched".
 * A thrown SearchServiceError must surface as HTTP 502, never as an empty list.
 */
export class SearchServiceError extends Error {
  constructor(
    message: string,
    readonly code: "geocode_failed" | "mirrors_failed" | "providers_failed" | "internal",
  ) {
    super(message);
    this.name = "SearchServiceError";
  }
}

export function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
