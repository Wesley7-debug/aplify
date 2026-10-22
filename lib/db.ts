import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Client, InStatement } from "@libsql/client/web";
import { createClient } from "@libsql/client/web";
import type { ConfidenceLevel } from "@/lib/types";
import { validateEmail } from "@/lib/email-validate";
import { normalizePlacePart, normalizeTradeKey } from "@/lib/osm/tags";

/**
 * Aplify data layer.
 *
 * The default store is a local SQLite file (Node's built-in `node:sqlite`).
 * Set `TURSO_DATABASE_URL` (plus `TURSO_AUTH_TOKEN` for a hosted database) to
 * use Turso/libSQL over HTTPS instead. Both backends speak the same SQL, and
 * Turso's HTTP client needs no native build step, so the app runs anywhere.
 */

export type DbValue = string | number | null;
export type StoredEmailSource = "osm" | "overture" | "website";

interface Statement {
  sql: string;
  args: DbValue[];
}

interface Adapter {
  kind: "local" | "remote";
  label: string;
  query<T>(sql: string, args?: DbValue[]): Promise<T[]>;
  run(sql: string, args?: DbValue[]): Promise<number>;
  batch(statements: Statement[]): Promise<void>;
  close(): Promise<void>;
}

export interface BusinessUpsert {
  id: string;
  name: string;
  category: string | null;
  tradeKey: string;
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  email?: string | null;
  emailSource?: StoredEmailSource | null;
  emailIsRole?: boolean;
  confidence?: ConfidenceLevel;
  emailValidatedAt?: string | null;
  emailValidation?: string | null;
  sourceUrl: string;
  websiteCheckedAt?: string | null;
}

export interface BusinessDbRow {
  id: string;
  name: string;
  category: string | null;
  trade_key: string;
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  email_is_role: number;
  email_source: StoredEmailSource | null;
  email_validated_at: string | null;
  email_validation: string | null;
  confidence: ConfidenceLevel | null;
  source_url: string;
  website_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrawlJobRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "done" | "failed";
  added_count: number;
  scanned_count: number;
  message: string | null;
  phase: string | null;
  cities: string | null;
  trades: string | null;
  cancel_requested: number;
}

export interface CrawlJob {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "done" | "failed";
  addedCount: number;
  scannedCount: number;
  message: string | null;
  phase: string | null;
  cities: string[];
  trades: string[];
  cancelRequested: boolean;
}

export interface BreakdownRow {
  label: string;
  total: number;
  withEmail: number;
}

export interface DbStats {
  totalBusinesses: number;
  totalWithEmail: number;
  added24h: number;
  checkedWebsites: number;
  cities: BreakdownRow[];
  trades: BreakdownRow[];
  recentJobs: CrawlJob[];
  lastJob: CrawlJob | null;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS businesses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    trade_key TEXT NOT NULL,
    city TEXT,
    region TEXT,
    country TEXT,
    city_norm TEXT,
    region_norm TEXT,
    country_norm TEXT,
    lat REAL,
    lon REAL,
    address TEXT,
    phone TEXT,
    website TEXT,
    email TEXT,
    email_is_role INTEGER NOT NULL DEFAULT 0,
    email_source TEXT,
    email_validated_at TEXT,
    email_validation TEXT,
    confidence TEXT,
    source_url TEXT NOT NULL,
    website_checked_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS businesses_email_unique
     ON businesses(lower(email)) WHERE email IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS businesses_place_trade
     ON businesses(country_norm, city_norm, trade_key)`,
  `CREATE INDEX IF NOT EXISTS businesses_trade ON businesses(trade_key)`,
  `CREATE INDEX IF NOT EXISTS businesses_has_email ON businesses((email IS NOT NULL))`,
  `CREATE INDEX IF NOT EXISTS businesses_email_queue
     ON businesses(website_checked_at) WHERE email IS NULL AND website IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS crawl_jobs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    added_count INTEGER NOT NULL DEFAULT 0,
    scanned_count INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    phase TEXT,
    cities TEXT,
    trades TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS crawl_jobs_started ON crawl_jobs(started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS crawl_cursor (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS seen_businesses (
    user_key TEXT NOT NULL,
    business_id TEXT NOT NULL,
    email TEXT,
    seen_at TEXT NOT NULL,
    PRIMARY KEY (user_key, business_id)
  )`,
  `CREATE INDEX IF NOT EXISTS seen_businesses_user
     ON seen_businesses(user_key, seen_at DESC)`,
  `CREATE TABLE IF NOT EXISTS search_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_key TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS search_events_user
     ON search_events(user_key, created_at DESC)`,
];

function nowIso(): string {
  return new Date().toISOString();
}

function localPath(url: string): string {
  const value = url.startsWith("file:") ? url.slice("file:".length) : url;
  if (value.startsWith("//")) return value.slice(2);
  return value;
}

function createAdapter(): Adapter {
  const url = (process.env.TURSO_DATABASE_URL ?? process.env.APLIFY_DB_URL ?? "").trim();
  const authToken = (process.env.TURSO_AUTH_TOKEN ?? "").trim();
  const target = url || "file:data/aplify.db";
  const remote = /^(libsql|https?|wss?):\/\//i.test(target);
  const needsToken = /^libsql:\/\//i.test(target);
  const useRemote = remote && (!needsToken || Boolean(authToken));
  if (remote && !useRemote) {
    console.warn(
      "[db] TURSO_AUTH_TOKEN is missing; using the local SQLite database instead. " +
        "Add a token to TURSO_AUTH_TOKEN to use Turso.",
    );
  }

  if (useRemote) {
    const client: Client = createClient({ url: target, authToken: authToken || undefined });
    let host = target;
    try {
      host = new URL(target).host;
    } catch {
      // keep the raw URL as a harmless label
    }

    return {
      kind: "remote",
      label: `turso:${host}`,
      async query<T>(sql: string, args: DbValue[] = []): Promise<T[]> {
        const result = await client.execute({ sql, args });
        return result.rows.map((row) => ({ ...row })) as T[];
      },
      async run(sql: string, args: DbValue[] = []): Promise<number> {
        const result = await client.execute({ sql, args });
        return Number(result.rowsAffected ?? 0);
      },
      async batch(statements: Statement[]): Promise<void> {
        if (statements.length === 0) return;
        const batch: InStatement[] = statements.map((statement) => ({
          sql: statement.sql,
          args: statement.args,
        }));
        await client.batch(batch, "write");
      },
      async close(): Promise<void> {
        client.close();
      },
    };
  }

  const path = localPath(target);
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA synchronous = NORMAL");

  return {
    kind: "local",
    label: `sqlite:${path}`,
    async query<T>(sql: string, args: DbValue[] = []): Promise<T[]> {
      return database.prepare(sql).all(...args) as T[];
    },
    async run(sql: string, args: DbValue[] = []): Promise<number> {
      const result = database.prepare(sql).run(...args);
      return Number(result.changes ?? 0);
    },
    async batch(statements: Statement[]): Promise<void> {
      if (statements.length === 0) return;
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const statement of statements) {
          database.prepare(statement.sql).run(...statement.args);
        }
        database.exec("COMMIT");
      } catch (cause) {
        try {
          database.exec("ROLLBACK");
        } catch {
          // Ignore a rollback failure; the original error is more useful.
        }
        throw cause;
      }
    },
    async close(): Promise<void> {
      database.close();
    },
  };
}

let adapter: Adapter | null = null;
let schemaReady: Promise<void> | null = null;

function db(): Adapter {
  if (!adapter) adapter = createAdapter();
  return adapter;
}

async function initSchema(): Promise<void> {
  await db().batch(SCHEMA.map((sql) => ({ sql, args: [] })));

  // Databases created before email validation existed need the new columns.
  const columns = await db().query<{ name: string }>("PRAGMA table_info(businesses)");
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("email_validated_at")) {
    await db().run("ALTER TABLE businesses ADD COLUMN email_validated_at TEXT");
  }
  if (!names.has("email_validation")) {
    await db().run("ALTER TABLE businesses ADD COLUMN email_validation TEXT");
  }
}

/** Idempotent — safe to call on every request; the work happens once. */
export function ensureDb(): Promise<void> {
  if (!schemaReady) {
    schemaReady = initSchema().catch((cause) => {
      schemaReady = null;
      throw cause;
    });
  }
  return schemaReady;
}

export function dbTarget(): { kind: "local" | "remote"; label: string } {
  return { kind: db().kind, label: db().label };
}

export async function closeDb(): Promise<void> {
  if (!adapter) return;
  await adapter.close();
  adapter = null;
  schemaReady = null;
}

function toBusinessStatements(row: BusinessUpsert): Statement[] {
  const now = nowIso();
  const cityNorm = row.city ? normalizePlacePart(row.city) : null;
  const regionNorm = row.region ? normalizePlacePart(row.region) : null;
  const countryNorm = row.country ? normalizePlacePart(row.country) : null;
  const statements: Statement[] = [
    {
      sql: `INSERT INTO businesses (
        id, name, category, trade_key, city, region, country,
        city_norm, region_norm, country_norm, lat, lon, address, phone, website,
        email, email_is_role, email_source, confidence, source_url,
        website_checked_at, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,0,NULL,NULL,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        category = excluded.category,
        trade_key = excluded.trade_key,
        city = excluded.city,
        region = excluded.region,
        country = excluded.country,
        city_norm = excluded.city_norm,
        region_norm = excluded.region_norm,
        country_norm = excluded.country_norm,
        lat = excluded.lat,
        lon = excluded.lon,
        address = COALESCE(excluded.address, businesses.address),
        phone = COALESCE(excluded.phone, businesses.phone),
        website = COALESCE(excluded.website, businesses.website),
        source_url = excluded.source_url,
        website_checked_at = COALESCE(excluded.website_checked_at, businesses.website_checked_at),
        updated_at = excluded.updated_at`,
      args: [
        row.id,
        row.name,
        row.category,
        row.tradeKey,
        row.city,
        row.region,
        row.country,
        cityNorm,
        regionNorm,
        countryNorm,
        row.lat,
        row.lon,
        row.address,
        row.phone,
        row.website,
        row.sourceUrl,
        row.websiteCheckedAt ?? null,
        now,
        now,
      ],
    },
  ];

  if (row.email) {
    statements.push(emailAssignment(row.id, row.email, {
      source: row.emailSource ?? "osm",
      isRole: row.emailIsRole ?? false,
      confidence: row.confidence ?? "low",
      validatedAt: row.emailValidatedAt ?? now,
      validation: row.emailValidation ?? "syntax",
    }));
  }

  return statements;
}

function emailAssignment(
  id: string,
  email: string,
  meta: {
    source: StoredEmailSource;
    isRole: boolean;
    confidence: ConfidenceLevel;
    validatedAt: string;
    validation: string;
  },
): Statement {
  const normalized = email.trim().toLowerCase();
  return {
    sql: `UPDATE businesses
      SET email = ?, email_is_role = ?, email_source = ?, confidence = ?,
          email_validated_at = ?, email_validation = ?, updated_at = ?
      WHERE id = ?
        AND (email IS NULL OR lower(email) = ?)
        AND NOT EXISTS (
          SELECT 1 FROM businesses WHERE lower(email) = ? AND id <> ?
        )`,
    args: [
      normalized,
      meta.isRole ? 1 : 0,
      meta.source,
      meta.confidence,
      meta.validatedAt,
      meta.validation,
      nowIso(),
      id,
      normalized,
      normalized,
      id,
    ],
  };
}

/**
 * Validate and upsert a batch of OSM/seed records. A record whose email fails
 * syntax/junk/DNS checks is kept without the email only when it has a phone
 * number; otherwise it is dropped.
 */
export async function upsertBusinesses(rows: BusinessUpsert[]): Promise<number> {
  if (rows.length === 0) return 0;
  await ensureDb();

  const checked = (
    await Promise.all(
      rows.map(async (row) => {
        if (!row.email || row.emailValidatedAt) return row;
        const validation = await validateEmail(row.email);
        if (!validation.valid) {
          if (!row.phone) return null;
          return { ...row, email: null, emailSource: null, emailIsRole: false };
        }
        return {
          ...row,
          emailValidatedAt: nowIso(),
          emailValidation: validation.method,
        };
      }),
    )
  ).filter((row): row is BusinessUpsert => row !== null);

  const statements = checked.flatMap(toBusinessStatements);
  for (let index = 0; index < statements.length; index += 500) {
    await db().batch(statements.slice(index, index + 500));
  }
  return checked.length;
}

/** Attach a validated email when no other business already owns that inbox. */
export async function assignEmail(
  id: string,
  email: string,
  meta: { source: StoredEmailSource; isRole: boolean; confidence: ConfidenceLevel },
): Promise<boolean> {
  await ensureDb();
  const validation = await validateEmail(email);
  if (!validation.valid) return false;
  const statement = emailAssignment(id, email, {
    ...meta,
    validatedAt: nowIso(),
    validation: validation.method,
  });
  const changes = await db().run(statement.sql, statement.args);
  return changes > 0;
}

export async function markWebsiteChecked(
  id: string,
  email: string | null,
  meta?: { source: StoredEmailSource; isRole: boolean; confidence: ConfidenceLevel },
): Promise<boolean> {
  await ensureDb();
  let assigned = false;
  if (email && meta) assigned = await assignEmail(id, email, meta);
  await db().run("UPDATE businesses SET website_checked_at = ?, updated_at = ? WHERE id = ?", [
    nowIso(),
    nowIso(),
    id,
  ]);
  return assigned;
}

export interface SearchDbOptions {
  tradeKeys: string[];
  location: string;
  exactTradeKey: string;
  limit: number;
  offset: number;
  /** Client-side ids used only to float fresh records to the top. */
  seenIds: string[];
  /** Server-side ids this user has already contacted; removed entirely. */
  excludeIds?: string[];
}

export async function searchBusinesses(options: SearchDbOptions): Promise<{
  rows: BusinessDbRow[];
  total: number;
  excluded: number;
}> {
  await ensureDb();

  const tradeKeys = [...new Set(options.tradeKeys.length > 0 ? options.tradeKeys : [options.exactTradeKey])];
  const parts = options.location
    .split(",")
    .map((part) => normalizePlacePart(part))
    .filter(Boolean);

  const where: string[] = [
    `((email IS NOT NULL AND TRIM(email) <> '' AND email_validated_at IS NOT NULL)
      OR (phone IS NOT NULL AND TRIM(phone) <> ''))`,
    // The product only shows businesses that do not publish a website.
    "(website IS NULL OR TRIM(website) = '')",
    `trade_key IN (${tradeKeys.map(() => "?").join(",")})`,
  ];
  const args: DbValue[] = [...tradeKeys];

  for (const part of parts) {
    where.push("(city_norm LIKE ? OR region_norm LIKE ? OR country_norm LIKE ?)");
    const like = `%${part}%`;
    args.push(like, like, like);
  }

  const excluded = [
    ...new Set((options.excludeIds ?? []).map((id) => id.trim()).filter(Boolean)),
  ].slice(0, 500);
  if (excluded.length > 0) {
    where.push(`id NOT IN (${excluded.map(() => "?").join(",")})`);
    args.push(...excluded);
  }

  const whereSql = where.join(" AND ");
  const countRows = await db().query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM businesses WHERE ${whereSql}`,
    args,
  );
  const total = Number(countRows[0]?.total ?? 0);

  const seen = [...new Set(options.seenIds.map((id) => id.trim()).filter(Boolean))].slice(0, 300);
  const seenSql =
    seen.length > 0
      ? `CASE WHEN id IN (${seen.map(() => "?").join(",")}) THEN 1 ELSE 0 END`
      : "CASE WHEN 1 = 1 THEN 0 ELSE 0 END";
  const orderArgs: DbValue[] = [...seen];
  orderArgs.push(options.exactTradeKey, options.limit, options.offset);

  const rows = await db().query<BusinessDbRow>(
    `SELECT id, name, category, trade_key, city, region, country, lat, lon,
            address, phone, website, email, email_is_role, email_source,
            email_validated_at, email_validation, confidence, source_url,
            website_checked_at, created_at, updated_at
     FROM businesses
     WHERE ${whereSql}
     ORDER BY
       ${seenSql} ASC,
       CASE WHEN trade_key = ? THEN 0 ELSE 1 END ASC,
       CASE WHEN email IS NOT NULL AND email_validated_at IS NOT NULL THEN 0 ELSE 1 END ASC,
       CASE confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END ASC,
       name COLLATE NOCASE ASC
     LIMIT ? OFFSET ?`,
    [...args, ...orderArgs],
  );

  return { rows, total, excluded: excluded.length };
}

export async function countWithEmail(): Promise<number> {
  await ensureDb();
  const rows = await db().query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM businesses WHERE email IS NOT NULL AND email_validated_at IS NOT NULL",
  );
  return Number(rows[0]?.n ?? 0);
}

export async function countBusinesses(): Promise<number> {
  await ensureDb();
  const rows = await db().query<{ n: number }>("SELECT COUNT(*) AS n FROM businesses");
  return Number(rows[0]?.n ?? 0);
}

// ── Search suggestions ─────────────────────────────────────────────────────
// These queries only count rows the public search can actually return:
// a validated email or phone number, and no published website.

const SUGGESTION_WHERE = `((email IS NOT NULL
    AND TRIM(email) <> ''
    AND email_validated_at IS NOT NULL)
  OR (phone IS NOT NULL AND TRIM(phone) <> ''))
  AND (website IS NULL OR TRIM(website) = '')`;

export interface TradeCount {
  tradeKey: string;
  total: number;
}

export async function tradeCounts(limit = 300): Promise<TradeCount[]> {
  await ensureDb();
  const rows = await db().query<{ trade_key: string; total: number }>(
    `SELECT trade_key, COUNT(*) AS total
     FROM businesses
     WHERE ${SUGGESTION_WHERE}
     GROUP BY trade_key
     ORDER BY total DESC
     LIMIT ?`,
    [Math.max(1, Math.min(limit, 500))],
  );
  return rows.map((row) => ({ tradeKey: row.trade_key, total: Number(row.total ?? 0) }));
}

export interface CityCount {
  city: string;
  region: string | null;
  country: string | null;
  total: number;
}

export async function cityCounts(limit = 300): Promise<CityCount[]> {
  await ensureDb();
  const rows = await db().query<{
    city: string;
    region: string | null;
    country: string | null;
    total: number;
  }>(
    `SELECT city, MAX(region) AS region, MAX(country) AS country, COUNT(*) AS total
     FROM businesses
     WHERE ${SUGGESTION_WHERE}
       AND city IS NOT NULL
       AND TRIM(city) <> ''
     GROUP BY city
     ORDER BY total DESC
     LIMIT ?`,
    [Math.max(1, Math.min(limit, 500))],
  );
  return rows.map((row) => ({
    city: row.city,
    region: row.region,
    country: row.country,
    total: Number(row.total ?? 0),
  }));
}

export interface CombinationCount {
  tradeKey: string;
  city: string;
  country: string | null;
  total: number;
}

export async function topCombinations(limit = 8): Promise<CombinationCount[]> {
  await ensureDb();
  const rows = await db().query<{
    trade_key: string;
    city: string;
    country: string | null;
    total: number;
  }>(
    `SELECT trade_key, city, MAX(country) AS country, COUNT(*) AS total
     FROM businesses
     WHERE ${SUGGESTION_WHERE}
       AND city IS NOT NULL
       AND TRIM(city) <> ''
     GROUP BY trade_key, city
     ORDER BY total DESC
     LIMIT ?`,
    [Math.max(1, Math.min(limit, 50))],
  );
  return rows.map((row) => ({
    tradeKey: row.trade_key,
    city: row.city,
    country: row.country,
    total: Number(row.total ?? 0),
  }));
}

export async function getStats(): Promise<DbStats> {
  await ensureDb();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [totals, added, checked, cities, trades, jobs] = await Promise.all([
    db().query<{ total: number; with_email: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN email IS NOT NULL AND email_validated_at IS NOT NULL THEN 1 ELSE 0 END) AS with_email
       FROM businesses`,
    ),
    db().query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM businesses WHERE email IS NOT NULL AND email_validated_at IS NOT NULL AND created_at >= ?",
      [since],
    ),
    db().query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM businesses
       WHERE website_checked_at IS NOT NULL`,
    ),
    db().query<{ label: string | null; total: number; with_email: number }>(
      `SELECT COALESCE(NULLIF(city, ''), 'Unknown') AS label,
              COUNT(*) AS total,
              SUM(CASE WHEN email IS NOT NULL AND email_validated_at IS NOT NULL THEN 1 ELSE 0 END) AS with_email
       FROM businesses
       GROUP BY COALESCE(NULLIF(city, ''), 'Unknown')
       ORDER BY total DESC
       LIMIT 12`,
    ),
    db().query<{ label: string | null; total: number; with_email: number }>(
      `SELECT COALESCE(NULLIF(trade_key, ''), 'business') AS label,
              COUNT(*) AS total,
              SUM(CASE WHEN email IS NOT NULL AND email_validated_at IS NOT NULL THEN 1 ELSE 0 END) AS with_email
       FROM businesses
       GROUP BY COALESCE(NULLIF(trade_key, ''), 'business')
       ORDER BY total DESC
       LIMIT 12`,
    ),
    db().query<CrawlJobRow>("SELECT * FROM crawl_jobs ORDER BY started_at DESC LIMIT 10"),
  ]);

  const recentJobs = jobs.map(mapCrawlJob);

  return {
    totalBusinesses: Number(totals[0]?.total ?? 0),
    totalWithEmail: Number(totals[0]?.with_email ?? 0),
    added24h: Number(added[0]?.n ?? 0),
    checkedWebsites: Number(checked[0]?.n ?? 0),
    cities: cities.map((row) => ({
      label: row.label ?? "Unknown",
      total: Number(row.total ?? 0),
      withEmail: Number(row.with_email ?? 0),
    })),
    trades: trades.map((row) => ({
      label: row.label ?? "business",
      total: Number(row.total ?? 0),
      withEmail: Number(row.with_email ?? 0),
    })),
    recentJobs,
    lastJob: recentJobs[0] ?? null,
  };
}

function mapCrawlJob(row: CrawlJobRow): CrawlJob {
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    addedCount: Number(row.added_count ?? 0),
    scannedCount: Number(row.scanned_count ?? 0),
    message: row.message,
    phase: row.phase,
    cities: parseList(row.cities),
    trades: parseList(row.trades),
    cancelRequested: Boolean(row.cancel_requested),
  };
}

function parseList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function createCrawlJob(options: {
  id: string;
  cities: string[];
  trades: string[];
}): Promise<CrawlJob> {
  await ensureDb();
  const startedAt = nowIso();
  await db().run(
    `INSERT INTO crawl_jobs (id, started_at, status, added_count, scanned_count, phase, cities, trades)
     VALUES (?, ?, 'running', 0, 0, 'starting', ?, ?)`,
    [options.id, startedAt, options.cities.join(","), options.trades.join(",")],
  );
  return {
    id: options.id,
    startedAt,
    finishedAt: null,
    status: "running",
    addedCount: 0,
    scannedCount: 0,
    message: null,
    phase: "starting",
    cities: options.cities,
    trades: options.trades,
    cancelRequested: false,
  };
}

export async function getRunningJob(): Promise<CrawlJob | null> {
  await ensureDb();
  // A crashed process leaves a "running" row behind. Anything older than
  // 30 minutes is stale and must not block future refreshes.
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await db().run(
    `UPDATE crawl_jobs
     SET status = 'failed', finished_at = ?, message = 'Interrupted before finishing.'
     WHERE status = 'running' AND started_at < ?`,
    [nowIso(), cutoff],
  );
  const rows = await db().query<CrawlJobRow>(
    "SELECT * FROM crawl_jobs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1",
  );
  return rows[0] ? mapCrawlJob(rows[0]) : null;
}

export async function getCrawlJob(id: string): Promise<CrawlJob | null> {
  await ensureDb();
  const rows = await db().query<CrawlJobRow>("SELECT * FROM crawl_jobs WHERE id = ? LIMIT 1", [id]);
  return rows[0] ? mapCrawlJob(rows[0]) : null;
}

export async function updateCrawlJob(
  id: string,
  patch: {
    phase?: string;
    scannedCount?: number;
    addedCount?: number;
    message?: string | null;
  },
): Promise<void> {
  const allowed: Array<[keyof typeof patch, string]> = [
    ["phase", "phase"],
    ["scannedCount", "scanned_count"],
    ["addedCount", "added_count"],
    ["message", "message"],
  ];
  const sets: string[] = [];
  const args: DbValue[] = [];
  for (const [key, column] of allowed) {
    if (patch[key] === undefined) continue;
    sets.push(`${column} = ?`);
    args.push(patch[key] as DbValue);
  }
  if (sets.length === 0) return;
  args.push(id);
  await db().run(`UPDATE crawl_jobs SET ${sets.join(", ")} WHERE id = ?`, args);
}

export async function finishCrawlJob(
  id: string,
  options: {
    status: "done" | "failed";
    scannedCount: number;
    addedCount: number;
    message: string | null;
  },
): Promise<void> {
  await db().run(
    `UPDATE crawl_jobs
     SET status = ?, finished_at = ?, scanned_count = ?, added_count = ?, message = ?, phase = 'finished'
     WHERE id = ?`,
    [options.status, nowIso(), options.scannedCount, options.addedCount, options.message, id],
  );
}

export async function requestCrawlStop(id: string): Promise<boolean> {
  const changes = await db().run(
    "UPDATE crawl_jobs SET cancel_requested = 1 WHERE id = ? AND status = 'running'",
    [id],
  );
  return changes > 0;
}

export async function isCrawlStopRequested(id: string): Promise<boolean> {
  const rows = await db().query<{ cancel_requested: number }>(
    "SELECT cancel_requested FROM crawl_jobs WHERE id = ? LIMIT 1",
    [id],
  );
  return Boolean(rows[0]?.cancel_requested);
}

export interface CursorValue {
  tile: number;
  cycle: number;
  lastRunAt: string;
}

export async function getCursors(prefix = "pair:"): Promise<Map<string, CursorValue>> {
  await ensureDb();
  const rows = await db().query<{ key: string; value: string | null }>(
    "SELECT key, value FROM crawl_cursor WHERE key LIKE ?",
    [`${prefix}%`],
  );
  const output = new Map<string, CursorValue>();
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.value ?? "{}") as Partial<CursorValue>;
      output.set(row.key, {
        tile: Number(parsed.tile ?? 0) || 0,
        cycle: Number(parsed.cycle ?? 0) || 0,
        lastRunAt: typeof parsed.lastRunAt === "string" ? parsed.lastRunAt : "",
      });
    } catch {
      output.set(row.key, { tile: 0, cycle: 0, lastRunAt: "" });
    }
  }
  return output;
}

export async function setCursor(key: string, value: CursorValue): Promise<void> {
  await db().run(
    `INSERT INTO crawl_cursor (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, JSON.stringify(value)],
  );
}

export interface WebsiteQueueRow {
  id: string;
  name: string;
  website: string;
  phone: string | null;
  address: string | null;
}

export async function nextWebsiteQueue(
  limit: number,
  staleBefore: string,
): Promise<WebsiteQueueRow[]> {
  await ensureDb();
  return db().query<WebsiteQueueRow>(
    `SELECT id, name, website, phone, address
     FROM businesses
     WHERE email IS NULL
       AND website IS NOT NULL
       AND TRIM(website) <> ''
       AND (website_checked_at IS NULL OR website_checked_at < ?)
     ORDER BY website_checked_at IS NOT NULL ASC, updated_at ASC
     LIMIT ?`,
    [staleBefore, limit],
  );
}

/** Re-normalise stored trade keys in one pass (used after dictionary edits). */
export async function normalizeStoredTradeKeys(): Promise<void> {
  await ensureDb();
  const rows = await db().query<{ id: string; trade_key: string }>(
    "SELECT id, trade_key FROM businesses",
  );
  const statements: Statement[] = [];
  for (const row of rows) {
    const next = normalizeTradeKey(row.trade_key);
    if (next === row.trade_key) continue;
    statements.push({ sql: "UPDATE businesses SET trade_key = ? WHERE id = ?", args: [next, row.id] });
  }
  for (let index = 0; index < statements.length; index += 500) {
    await db().batch(statements.slice(index, index + 500));
  }
}

// ── Per-user state ──────────────────────────────────────────────────────────
// Users are keyed by their email when they provide one, otherwise by an
// anonymous httpOnly cookie. Only this key is stored; no search history.

export interface SeenLead {
  id: string;
  email?: string | null;
}

export async function getSeenIds(userKey: string, limit = 1_000): Promise<string[]> {
  await ensureDb();
  const rows = await db().query<{ business_id: string }>(
    "SELECT business_id FROM seen_businesses WHERE user_key = ? ORDER BY seen_at DESC LIMIT ?",
    [userKey, Math.max(1, Math.min(limit, 5_000))],
  );
  return rows.map((row) => row.business_id);
}

export async function markSeen(userKey: string, leads: SeenLead[]): Promise<number> {
  if (!userKey || leads.length === 0) return 0;
  await ensureDb();
  const seenAt = nowIso();
  const unique = new Map<string, SeenLead>();
  for (const lead of leads) {
    if (lead.id) unique.set(lead.id, lead);
  }
  const statements = [...unique.values()].map((lead) => ({
    sql: `INSERT INTO seen_businesses (user_key, business_id, email, seen_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_key, business_id) DO UPDATE SET
            email = COALESCE(excluded.email, seen_businesses.email),
            seen_at = excluded.seen_at`,
    args: [userKey, lead.id, lead.email ?? null, seenAt] as DbValue[],
  }));
  for (let index = 0; index < statements.length; index += 500) {
    await db().batch(statements.slice(index, index + 500));
  }
  return unique.size;
}

export async function clearSeen(userKey: string): Promise<number> {
  await ensureDb();
  return db().run("DELETE FROM seen_businesses WHERE user_key = ?", [userKey]);
}

export async function countSeen(userKey: string): Promise<number> {
  await ensureDb();
  const rows = await db().query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM seen_businesses WHERE user_key = ?",
    [userKey],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function countRecentSearches(userKey: string, seconds = 60): Promise<number> {
  await ensureDb();
  const since = new Date(Date.now() - seconds * 1_000).toISOString();
  const rows = await db().query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM search_events WHERE user_key = ? AND created_at >= ?",
    [userKey, since],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function recordSearchEvent(userKey: string): Promise<void> {
  await ensureDb();
  const now = nowIso();
  await db().run("INSERT INTO search_events (user_key, created_at) VALUES (?, ?)", [userKey, now]);
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
  await db().run("DELETE FROM search_events WHERE created_at < ?", [cutoff]);
}

/** Validate every stored email; invalid rows lose the address. */
export async function validateStoredEmails(
  options: { force?: boolean } = {},
): Promise<{ checked: number; valid: number; invalid: number }> {
  await ensureDb();
  const rows = await db().query<{ id: string; email: string }>(
    `SELECT id, email FROM businesses
     WHERE email IS NOT NULL AND TRIM(email) <> ''
       ${options.force ? "" : "AND email_validated_at IS NULL"}
     ORDER BY updated_at ASC`,
  );

  let valid = 0;
  let invalid = 0;
  const now = nowIso();

  for (let index = 0; index < rows.length; index += 10) {
    const chunk = rows.slice(index, index + 10);
    const results = await Promise.all(
      chunk.map(async (row) => ({ row, validation: await validateEmail(row.email) })),
    );
    const statements: Statement[] = [];
    for (const { row, validation } of results) {
      if (validation.valid) {
        valid += 1;
        statements.push({
          sql: `UPDATE businesses SET email_validated_at = ?, email_validation = ?, updated_at = ?
                WHERE id = ?`,
          args: [now, validation.method, now, row.id],
        });
      } else {
        invalid += 1;
        statements.push({
          sql: `UPDATE businesses
                SET email = NULL, email_source = NULL, email_is_role = 0,
                    email_validated_at = NULL, email_validation = ?, updated_at = ?
                WHERE id = ?`,
          args: [validation.reason, now, row.id],
        });
      }
    }
    await db().batch(statements);
  }

  return { checked: rows.length, valid, invalid };
}
