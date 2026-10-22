import { findEmails } from "@/lib/enrich/email-finder";
import { messageOf, SearchServiceError } from "@/lib/discovery/errors";
import { readSnapshot, writeSnapshot, type SnapshotRecord } from "@/lib/discovery/snapshot";
import type { Candidate, FoundEmail } from "@/lib/discovery/types";
import { assessConfidence, isRoleAddress, normalizeEmail } from "@/lib/osm/email";
import { geocode, type GeoPlace } from "@/lib/osm/geocode";
import {
  discoverOverpass,
  expandBbox,
  type Bbox,
  type MirrorStats,
} from "@/lib/osm/overpass";
import {
  audienceKey,
  filtersKey,
  matchAudience,
  type AudienceMatch,
  type OsmFilter,
} from "@/lib/osm/tags";
import { discoverProviders } from "@/lib/providers";
import type {
  Lead,
  SearchDiagnostics,
  SearchEvent,
  SearchOutcome,
  SearchQuery,
} from "@/lib/types";

const MAX_LIMIT = 30;
const ENRICH_CONCURRENCY = 10;

export function clampLimit(value: number): number {
  return Math.min(Math.max(Math.round(value || 10), 1), MAX_LIMIT);
}

export function parseExclude(value: string | null): Set<string> {
  const tokens = (value ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 1_000);
  return new Set(tokens);
}

interface Stage {
  filters: OsmFilter[];
  bbox: Bbox;
  label: string;
}

interface DiscoveryContext {
  audience: string;
  place: GeoPlace;
  match: AudienceMatch;
  signal: AbortSignal;
  stats: MirrorStats;
  sourcesTried: Set<string>;
}

function buildStages(place: GeoPlace, match: AudienceMatch): Stage[] {
  const base = place.bbox;
  const near = expandBbox(base, 0.15);
  const wide = expandBbox(base, 0.35);
  const related = match.related.length > 0 ? match.related : match.filters;

  const raw: Stage[] = [
    { filters: match.filters, bbox: base, label: "base" },
    { filters: match.filters, bbox: near, label: "neighbouring-tiles" },
    { filters: related, bbox: near, label: "related-trades" },
    { filters: related, bbox: wide, label: "larger-radius" },
  ];

  const seen = new Set<string>();
  return raw.filter((stage) => {
    const key = `${filtersKey(stage.filters)}|${stage.bbox.map((n) => n.toFixed(5)).join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function discoverStage(
  context: DiscoveryContext,
  stage: Stage,
  includeProviders: boolean,
  limit: number,
): Promise<{ candidates: Candidate[]; partial: boolean }> {
  const discovery = await discoverOverpass({
    filters: stage.filters,
    audience: context.audience,
    place: context.place,
    bbox: stage.bbox,
    signal: context.signal,
    stats: context.stats,
  });

  context.sourcesTried.add("osm-live");
  const candidates = discovery.candidates.slice();

  if (includeProviders) {
    const providers = await discoverProviders({
      audience: context.audience,
      filters: stage.filters,
      place: context.place,
      signal: context.signal,
      limit: Math.max(limit * 3, 20),
    });
    candidates.push(...providers.candidates);
    for (const source of providers.sourcesTried) context.sourcesTried.add(source);
  }

  return { candidates, partial: discovery.partial };
}

export interface PreparedSearch {
  query: SearchQuery;
  place: GeoPlace;
  match: AudienceMatch;
  exclude: Set<string>;
  seed: number;
  signal: AbortSignal;
  stats: MirrorStats;
  snapshot: SnapshotRecord | null;
  initialCandidates: Candidate[];
  /** True when only some source tiles answered during preparation. */
  partial: boolean;
  /** Index of the first stage still to run inside the stream. */
  nextStage: number;
  sourcesTried: Set<string>;
}

/**
 * Geocode and prepare the first batch of candidates.
 *
 * When this throws, the route can safely return HTTP 502: the failure happened
 * before any stream bytes were written. A snapshot, when present, keeps the
 * request fast and avoids the live dependency entirely.
 */
export async function prepareSearch(options: {
  query: SearchQuery;
  exclude: Set<string>;
  seed: number;
  signal: AbortSignal;
  /** Bypass the snapshot cache (used by the snapshot builder itself). */
  ignoreSnapshot?: boolean;
}): Promise<PreparedSearch> {
  const query = { ...options.query, limit: clampLimit(options.query.limit) };
  const place = await geocode(query.location);
  const match = matchAudience(query.audience);
  const snapshot = options.ignoreSnapshot ? null : await readSnapshot(place, query.audience);
  const stats: MirrorStats = { mirrorsFailed: 0 };
  const sourcesTried = new Set<string>();

  let initialCandidates: Candidate[] = [];
  let nextStage = 0;
  let partial = false;

  if (snapshot) {
    sourcesTried.add("snapshot");
  } else {
    const stages = buildStages(place, match);
    const base = stages[0];
    const context: DiscoveryContext = {
      audience: query.audience,
      place,
      match,
      signal: options.signal,
      stats,
      sourcesTried,
    };
    const discovered = await discoverStage(context, base, true, query.limit);
    initialCandidates = discovered.candidates;
    partial = discovered.partial;
    nextStage = Math.min(1, stages.length);
  }

  return {
    query,
    place,
    match,
    exclude: options.exclude,
    seed: options.seed,
    signal: options.signal,
    stats,
    snapshot,
    initialCandidates,
    partial,
    nextStage,
    sourcesTried,
  };
}

interface RunState {
  prepared: PreparedSearch;
  stages: Stage[];
  candidates: Candidate[];
  candidateIds: Set<string>;
  enrichedIds: Set<string>;
  businessIds: Set<string>;
  websiteIds: Set<string>;
  emailBusinessIds: Set<string>;
  leads: Lead[];
  emittedIds: Set<string>;
  emittedEmails: Set<string>;
  withheld: number;
  widened: number;
  serviceFailed: boolean;
  mirrorsFailed: number;
  websitesChecked: number;
  sourcesTried: Set<string>;
  snapshotBusinesses: number;
  snapshotWithWebsite: number;
  snapshotWithEmail: number;
  snapshotWebsitesChecked: number;
  triedStageKeys: Set<string>;
  runController: AbortController;
  runSignal: AbortSignal;
}

function stageKey(stage: Stage): string {
  return `${filtersKey(stage.filters)}|${stage.bbox.map((n) => n.toFixed(5)).join(",")}`;
}

function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  try {
    return AbortSignal.any([a, b]);
  } catch {
    return b;
  }
}

function createState(prepared: PreparedSearch): RunState {
  const stages = buildStages(prepared.place, prepared.match);
  const runController = new AbortController();
  const triedStageKeys = new Set<string>();

  // If the base stage was already fetched in prepareSearch, don't repeat it.
  if (prepared.nextStage > 0 && stages.length > 0) {
    triedStageKeys.add(stageKey(stages[0]));
  }

  return {
    prepared,
    stages,
    candidates: [],
    candidateIds: new Set(),
    enrichedIds: new Set(),
    businessIds: new Set(),
    websiteIds: new Set(),
    emailBusinessIds: new Set(),
    leads: [],
    emittedIds: new Set(),
    emittedEmails: new Set(),
    withheld: 0,
    widened: 0,
    serviceFailed: prepared.partial,
    mirrorsFailed: prepared.stats.mirrorsFailed,
    websitesChecked: 0,
    sourcesTried: new Set(prepared.sourcesTried),
    snapshotBusinesses: prepared.snapshot?.businessesFound ?? 0,
    snapshotWithWebsite: prepared.snapshot?.withWebsite ?? 0,
    snapshotWithEmail: prepared.snapshot?.withEmail ?? 0,
    snapshotWebsitesChecked: prepared.snapshot?.websitesChecked ?? 0,
    triedStageKeys,
    runController,
    runSignal: combineSignals(prepared.signal, runController.signal),
  };
}

function diagnosticsOf(state: RunState): SearchDiagnostics {
  return {
    businessesFound: Math.max(state.businessIds.size, state.snapshotBusinesses),
    withWebsite: Math.max(state.websiteIds.size, state.snapshotWithWebsite),
    withEmail: Math.max(
      state.emailBusinessIds.size,
      state.leads.length,
      state.snapshotWithEmail,
    ),
    websitesChecked: Math.max(state.websitesChecked, state.snapshotWebsitesChecked),
    sourcesTried: [...state.sourcesTried],
    mirrorsFailed: state.mirrorsFailed,
    excluded: state.withheld,
    widened: state.widened,
  };
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffle<T>(items: T[], seed: number): T[] {
  const random = mulberry32(seed);
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function mergeCandidates(state: RunState, candidates: Candidate[]): void {
  for (const candidate of candidates) {
    if (state.candidateIds.has(candidate.id)) continue;
    state.candidateIds.add(candidate.id);
    state.candidates.push(candidate);
    state.businessIds.add(candidate.id);
    if (candidate.website) state.websiteIds.add(candidate.id);
    if (candidate.publishedEmail) state.emailBusinessIds.add(candidate.id);
  }
}

function orderCandidates(state: RunState): Candidate[] {
  const instant: Candidate[] = [];
  const scrape: Candidate[] = [];

  for (const candidate of state.candidates) {
    if (state.enrichedIds.has(candidate.id)) continue;
    if (!candidate.publishedEmail && !candidate.website) {
      // Nothing to enrich; still counted as a business found.
      state.enrichedIds.add(candidate.id);
      continue;
    }
    if (candidate.publishedEmail) instant.push(candidate);
    else scrape.push(candidate);
  }

  return [
    ...shuffle(instant, state.prepared.seed),
    ...shuffle(scrape, state.prepared.seed ^ 0x9e3779b9),
  ];
}

interface EnrichResult {
  candidate: Candidate;
  emails: FoundEmail[];
  websitesChecked: number;
}

async function enrichOne(candidate: Candidate, state: RunState): Promise<EnrichResult> {
  try {
    const result = await findEmails(candidate, { signal: state.runSignal });
    return { candidate, emails: result.emails, websitesChecked: result.websitesChecked };
  } catch {
    return { candidate, emails: [], websitesChecked: 0 };
  }
}

function toLead(candidate: Candidate, found: FoundEmail): Lead {
  const { level, reason } = assessConfidence(found.email, {
    phone: Boolean(candidate.phone),
    address: Boolean(candidate.address),
  });

  return {
    id: candidate.id,
    businessName: candidate.businessName,
    category: candidate.category,
    location: {
      city: candidate.city,
      region: candidate.region,
      country: candidate.country,
      display: candidate.display,
      lat: candidate.lat,
      lon: candidate.lon,
    },
    email: found.email,
    emailSource: found.source,
    emailIsRole: isRoleAddress(found.email),
    emailSyntaxValid: true,
    confidence: level,
    confidenceReason: reason,
    phone: candidate.phone,
    address: candidate.address,
    website: candidate.website,
    source: {
      name: candidate.sourceName,
      url: candidate.sourceUrl,
      license: candidate.sourceLicense,
      retrievedAt: candidate.retrievedAt,
    },
  };
}

async function* enrichPool(state: RunState, limit: number): AsyncGenerator<SearchEvent> {
  const queue = orderCandidates(state);
  for (const candidate of queue) state.enrichedIds.add(candidate.id);

  const pending = new Set<Promise<EnrichResult>>();
  let cursor = 0;

  const startNext = () => {
    while (
      cursor < queue.length &&
      pending.size < ENRICH_CONCURRENCY &&
      state.leads.length < limit &&
      !state.runSignal.aborted
    ) {
      const candidate = queue[cursor];
      cursor += 1;
      pending.add(enrichOne(candidate, state));
    }
  };

  startNext();

  while (pending.size > 0) {
    const winner = await Promise.race(
      [...pending].map((promise) =>
        promise.then((result) => ({ result, promise })),
      ),
    );
    pending.delete(winner.promise);

    const { candidate, emails, websitesChecked } = winner.result;
    state.websitesChecked += websitesChecked;
    if (emails.length > 0) state.emailBusinessIds.add(candidate.id);

    for (const found of emails) {
      if (state.leads.length >= limit) break;
      const emailKey = normalizeEmail(found.email);
      const excluded =
        state.prepared.exclude.has(candidate.id.toLowerCase()) ||
        state.prepared.exclude.has(emailKey);

      if (excluded) {
        state.withheld += 1;
        continue;
      }
      if (state.emittedIds.has(candidate.id) || state.emittedEmails.has(emailKey)) {
        continue;
      }

      const lead = toLead(candidate, found);
      state.leads.push(lead);
      state.emittedIds.add(candidate.id);
      state.emittedEmails.add(emailKey);
      yield { type: "lead", lead, diagnostics: diagnosticsOf(state) };
    }

    if (state.leads.length >= limit) {
      state.runController.abort();
      break;
    }

    startNext();
  }
}

function registerSnapshotLead(state: RunState, lead: Lead): void {
  state.businessIds.add(lead.id);
  if (lead.email) state.emailBusinessIds.add(lead.id);
  if (lead.website) state.websiteIds.add(lead.id);
  state.candidateIds.add(lead.id);
  state.enrichedIds.add(lead.id);
  state.emittedIds.add(lead.id);
  if (lead.email) state.emittedEmails.add(normalizeEmail(lead.email));
}

function buildMessage(
  state: RunState,
  outcome: SearchOutcome,
  limit: number,
): string | null {
  const { audience, location } = state.prepared.query;

  if (outcome === "no_businesses_found") {
    return `We couldn't find any ${audience} in ${location}. Try a nearby city or a broader trade.`;
  }

  if (outcome === "businesses_found_but_no_public_email") {
    const count = Math.max(state.businessIds.size, state.snapshotBusinesses);
    const partial = state.serviceFailed
      ? " Some data sources were unavailable, so this may be incomplete."
      : "";
    return `Found ${count} ${count === 1 ? "business" : "businesses"} in ${location}, but none publish a public email on the sources we checked. Try another trade or area.${partial}`;
  }

  if (state.leads.length === 0) return null;

  if (state.leads.length < limit) {
    const reset = state.withheld > 0 ? " Reset your seen list to see earlier results." : "";
    const partial = state.serviceFailed
      ? " Some data sources were unavailable, so this may be incomplete."
      : "";
    return `Found ${state.leads.length} of ${limit} requested — that's every public email we could find here.${reset}${partial}`;
  }

  if (state.serviceFailed) {
    return "Some data sources were unavailable, so this list may be incomplete.";
  }

  return null;
}

export interface StreamOptions {
  /** Cap widening (used by the snapshot builder to stay quick). */
  maxStages?: number;
}

/**
 * Stream leads the moment each one is found.
 *
 * The generator never yields a fake empty result: an outage becomes an
 * `error` event, and a real absence becomes `no_businesses_found` with the
 * diagnostics that prove we looked.
 */
export async function* streamSearch(
  prepared: PreparedSearch,
  options: StreamOptions = {},
): AsyncGenerator<SearchEvent> {
  const state = createState(prepared);
  const limit = clampLimit(prepared.query.limit);
  const maxStages = Math.min(options.maxStages ?? state.stages.length, state.stages.length);

  yield {
    type: "meta",
    query: prepared.query,
    diagnostics: diagnosticsOf(state),
    message: null,
  };

  // 1. Snapshot leads are already enriched — serve them instantly.
  if (prepared.snapshot) {
    for (const lead of shuffle(prepared.snapshot.leads, prepared.seed)) {
      if (state.leads.length >= limit) break;
      if (
        prepared.exclude.has(lead.id.toLowerCase()) ||
        (lead.email ? prepared.exclude.has(lead.email.toLowerCase()) : false)
      ) {
        state.withheld += 1;
        continue;
      }
      if (lead.email && state.emittedEmails.has(normalizeEmail(lead.email))) continue;

      registerSnapshotLead(state, lead);
      state.leads.push(lead);
      yield { type: "lead", lead, diagnostics: diagnosticsOf(state) };
    }
  }

  // 2. Enrich the base candidates fetched during prepareSearch.
  if (state.leads.length < limit && prepared.initialCandidates.length > 0) {
    mergeCandidates(state, prepared.initialCandidates);
    yield* enrichPool(state, limit);
  }

  // 3. Widen / fall back to live discovery.
  for (let index = prepared.nextStage; index < maxStages; index += 1) {
    if (state.leads.length >= limit || state.runSignal.aborted) break;

    const stage = state.stages[index];
    if (!stage) break;
    const key = stageKey(stage);
    if (state.triedStageKeys.has(key)) continue;
    state.triedStageKeys.add(key);
    if (index > 0) state.widened += 1;

    try {
      const discovered = await discoverStage(
        {
          audience: prepared.query.audience,
          place: prepared.place,
          match: prepared.match,
          signal: state.runSignal,
          stats: prepared.stats,
          sourcesTried: state.sourcesTried,
        },
        stage,
        index === 0,
        limit,
      );
      state.mirrorsFailed = prepared.stats.mirrorsFailed;
      if (discovered.partial) state.serviceFailed = true;

      mergeCandidates(state, discovered.candidates);
      yield* enrichPool(state, limit);
    } catch (cause) {
      state.serviceFailed = true;
      state.mirrorsFailed = prepared.stats.mirrorsFailed;

      if (state.leads.length === 0) {
        yield {
          type: "error",
          status: 502,
          message: messageOf(
            cause,
            "The map data service is unavailable right now. Please try again.",
          ),
          diagnostics: diagnosticsOf(state),
        };
        return;
      }
    }
  }

  const outcome: SearchOutcome =
    state.leads.length > 0
      ? "success"
      : state.businessIds.size === 0 && state.snapshotBusinesses === 0
        ? "no_businesses_found"
        : "businesses_found_but_no_public_email";

  // If every source failed and we found no business at all, say so instead of
  // "zero". A partial result that did find businesses is reported honestly with
  // a note that sources were missing, rather than throwing the finding away.
  const foundAnyBusiness = state.businessIds.size > 0 || state.snapshotBusinesses > 0;
  if (outcome !== "success" && state.serviceFailed && !foundAnyBusiness) {
    yield {
      type: "error",
      status: 502,
      message:
        "The map data service is unavailable right now, so this search didn't finish. Please try again.",
      diagnostics: diagnosticsOf(state),
    };
    return;
  }

  yield {
    type: "done",
    outcome,
    count: state.leads.length,
    diagnostics: diagnosticsOf(state),
    message: buildMessage(state, outcome, limit),
    exhausted: state.leads.length < limit,
  };
}

export interface CollectedSearch {
  place: GeoPlace;
  leads: Lead[];
  diagnostics: SearchDiagnostics;
  outcome: SearchOutcome;
  message: string | null;
}

/** Drain a search to completion — used by the snapshot builder. */
export async function collectLeads(options: {
  audience: string;
  location: string;
  limit: number;
  exclude?: Set<string>;
  seed?: number;
  signal?: AbortSignal;
  maxStages?: number;
  ignoreSnapshot?: boolean;
}): Promise<CollectedSearch> {
  const prepared = await prepareSearch({
    query: {
      audience: options.audience,
      location: options.location,
      limit: clampLimit(options.limit),
    },
    exclude: options.exclude ?? new Set(),
    seed: options.seed ?? Math.floor(Math.random() * 2_147_483_647),
    signal: options.signal ?? new AbortController().signal,
    ignoreSnapshot: options.ignoreSnapshot,
  });

  const leads: Lead[] = [];
  let diagnostics = diagnosticsOf(createState(prepared));
  let outcome: SearchOutcome = "no_businesses_found";
  let message: string | null = null;

  for await (const event of streamSearch(prepared, { maxStages: options.maxStages })) {
    if (event.type === "lead") leads.push(event.lead);
    if (event.type === "done") {
      diagnostics = event.diagnostics;
      outcome = event.outcome;
      message = event.message;
    }
    if (event.type === "error") {
      throw new SearchServiceError(event.message, "internal");
    }
  }

  return { place: prepared.place, leads, diagnostics, outcome, message };
}

/** Persist a market snapshot so future searches answer locally. */
export async function saveSnapshot(collected: CollectedSearch, audience: string, location: string) {
  await writeSnapshot(collected.place, audience, {
    leads: collected.leads,
    businessesFound: collected.diagnostics.businessesFound,
    withWebsite: collected.diagnostics.withWebsite,
    withEmail: collected.diagnostics.withEmail,
    websitesChecked: collected.diagnostics.websitesChecked,
  });
  return { audience, location, leads: collected.leads.length };
}

/** Stable key used by the snapshot builder's logs. */
export function snapshotLabel(place: GeoPlace, audience: string): string {
  return `${audienceKey(audience)}@${place.city ?? place.display}`;
}
