import type { EmailSource } from "@/lib/types";

/** A business we know exists, before we know whether it publishes an email. */
export interface Candidate {
  id: string;
  businessName: string;
  category: string;
  website: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  display: string;
  lat: number | null;
  lon: number | null;
  /** Email already published on the source record (OSM tags, etc.). */
  publishedEmail: string | null;
  sourceName: string;
  sourceUrl: string;
  sourceLicense: string;
  retrievedAt: string;
}

export interface DiscoveryResult {
  candidates: Candidate[];
  sourcesTried: string[];
  mirrorsFailed: number;
  partial: boolean;
}

export interface FoundEmail {
  email: string;
  source: EmailSource;
}
