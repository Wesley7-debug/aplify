/**
 * Aplify domain types.
 *
 * Every lead is a real business record sourced from OpenStreetMap — a free,
 * openly licensed, citable public dataset. A lead is only returned when the
 * business has a validated public email and no published website.
 */

/** How trustworthy the published address looks, based on what we can check. */
export type ConfidenceLevel = "high" | "medium" | "low";

/** Where the email was read from. We never guess or generate addresses. */
export type EmailSource = "osm-tag" | "website-mailto" | "website-text";

export interface LeadLocation {
  city: string | null;
  region: string | null;
  country: string | null;
  /** Pre-formatted display string, e.g. "Lagos, Nigeria". */
  display: string;
  lat: number | null;
  lon: number | null;
}

export interface LeadSource {
  /** Human name of the dataset, e.g. "OpenStreetMap". */
  name: string;
  /** Link to the exact record the email was read from. */
  url: string;
  license: string;
  retrievedAt: string;
}

export interface Lead {
  /** Stable identifier, e.g. `osm:node/123456`. */
  id: string;
  businessName: string;
  category: string;
  location: LeadLocation;
  /** The real published address, or null for a phone-only business. */
  email: string | null;
  /** How we found the address. Null when only a phone number is available. */
  emailSource: EmailSource | null;
  /** True for shared inboxes such as contact@ or info@. */
  emailIsRole: boolean;
  emailSyntaxValid: boolean;
  confidence: ConfidenceLevel;
  confidenceReason: string;
  phone: string | null;
  address: string | null;
  /** Website published on the record, when one exists. */
  website: string | null;
  source: LeadSource;
}

export interface SearchQuery {
  /** Free-text business type, e.g. "dentists". */
  audience: string;
  /** City, region or country. */
  location: string;
  /** How many emails to return. 10 for guests, 30 for the owner. */
  limit: number;
  /** Optional email used for the per-user allowance and contacted list. */
  userEmail?: string;
}

/** A single location suggestion returned by the geocoder. */
export interface LocationSuggestion {
  value: string;
  label: string;
  hint: string;
}

/**
 * Why a search ended the way it did. The three non-success states are
 * deliberately distinct so the UI never pretends "nothing matched" when the
 * real cause was an outage or a business without a public email.
 */
export type SearchOutcome =
  | "success"
  | "no_businesses_found"
  | "businesses_found_but_no_public_email"
  | "service_error";

/** Observable facts about a run, shown in the UI. */
export interface SearchDiagnostics {
  /** Unique business candidates discovered (with or without an email). */
  businessesFound: number;
  /** Candidates that publish a website. */
  withWebsite: number;
  /** Emails we actually found (before the requested-count cap). */
  withEmail: number;
  /** Websites actually fetched while looking for an address. */
  websitesChecked: number;
  /** Data sources consulted, e.g. ["snapshot", "osm-live"]. */
  sourcesTried: string[];
  /** Individual mirror requests that failed or timed out. */
  mirrorsFailed: number;
  /** How many already-seen ids/emails were withheld. */
  excluded: number;
  /** How many widening stages were used (0 = first attempt was enough). */
  widened: number;
}

export interface SearchResult {
  query: SearchQuery;
  leads: Lead[];
  count: number;
  generatedAt: string;
  outcome: SearchOutcome;
  diagnostics: SearchDiagnostics;
  /** Human-readable explanation for empty/partial results. */
  message: string | null;
  /** True when the pool ran dry and we did not pretend there was more. */
  exhausted: boolean;
  /** 1-based page of the database result set. */
  page: number;
  /** True when another page exists. */
  hasMore: boolean;
  /** Short "still collecting" note when a page is partial or empty. */
  hint: string | null;
  /** Total businesses with a valid email for this trade/place. */
  total: number;
  /** Server-computed per-user allowance (guests get 10). */
  allowance?: {
    limit: number;
    owner: boolean;
    excludedSeen: number;
  };
}

/** Client-side state machine for a search request. */
export type RunStatus = "idle" | "running" | "success" | "empty" | "error";

export interface RunError {
  title: string;
  message: string;
  hint?: string;
  field?: "audience" | "location";
  outcome?: SearchOutcome;
  diagnostics?: SearchDiagnostics;
}

/** NDJSON events streamed from /api/search. */
export type SearchEvent =
  | {
      type: "meta";
      query: SearchQuery;
      diagnostics: SearchDiagnostics;
      message: string | null;
    }
  | { type: "lead"; lead: Lead; diagnostics: SearchDiagnostics }
  | {
      type: "done";
      outcome: SearchOutcome;
      count: number;
      diagnostics: SearchDiagnostics;
      message: string | null;
      exhausted: boolean;
    }
  | {
      type: "error";
      status: number;
      message: string;
      diagnostics: SearchDiagnostics;
    };
