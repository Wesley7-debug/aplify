# Aplify V1

Find Nigerian businesses you can contact. Results come from a local SQLite/Turso
database built from real OpenStreetMap data — no paid APIs, no API keys, and no
live map lookup on the search path.

A result is only returned when the business has:

- a **validated public email or a published phone number**, and
- **no published website**.

Searches are answered from the database in milliseconds. Guests get up to
**10 contacts per search** and **10 searches per minute**. The owner email
(`eugenefidelis573@gmail.com`, configurable with `APLIFY_OWNER_EMAILS`) gets up
to 30. A business a user contacts is stored in the `seen_businesses` table and is
never returned to that user again.

## Quick start

```bash
npm install
cp .env.example .env.local       # set ADMIN_PASSWORD
npm run seed                     # downloads Nigeria PBF (~700 MB) and imports it
npm run validate                 # DNS-validates every stored email
npm run dev                      # http://localhost:3000
```

Nigeria is the only seeded country for this version. The database lives at
`data/aplify.db` and is git-ignored. Re-running `npm run seed` is safe; rows are
upserted by OpenStreetMap id.

To crawl more businesses and emails later:

```bash
npm run crawl                    # up to 8 minutes
npm run crawl -- --minutes=3 --city=Lagos --trade=Restaurants
```

`npm run crawl` is also available from `/admin`, protected by `ADMIN_PASSWORD`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Next.js locally |
| `npm run build` / `npm start` | Production build / server |
| `npm run lint` | ESLint |
| `npm run seed` | Import Nigeria OSM data into SQLite/Turso |
| `npm run validate` | Syntax + junk + DNS validation for stored emails |
| `npm run crawl` | Background OSM discovery + website email finding |
| `npm run db:reset` | Delete every seeded row from local SQLite and Turso |
| `npm run snapshot` | Legacy snapshot builder (not used by `/api/search`) |

Seed options: `--file=path.osm.pbf`, `--url=...`, `--city=Lagos`,
`--target=3000`. By default the importer keeps only businesses with no website
and at least one contact (valid email syntax or phone); use `--allow-website`
or `--include-without-contact` to relax that. Crawl options: `--minutes=8`,
`--city=Lagos`, `--trade=Restaurants`.

## Database

Default: `file:data/aplify.db` using Node's built-in `node:sqlite`.

Turso (HTTP, no native build):

```env
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=...
```

Core tables:

- `businesses` — OSM records, normalized place/trade keys, validated email or phone.
- `seen_businesses` — `(user_key, business_id)` contacted list.
- `search_events` — short-window rate limiting.
- `crawl_jobs`, `crawl_cursor` — admin dashboard and resumable discovery.

`email_validated_at` is set only after syntax, junk and DNS checks pass. Invalid
addresses are removed, and a business is only kept if it still has a phone
number.

## Search API

`GET /api/search?audience=hotels&location=Enugu&limit=10&page=1`

Optional: `user=you@example.com` (allowance + contacted list), `seen=id,id`
(client-side ordering only).

`GET /api/suggestions?kind=trade|location|available&q=...` returns database-backed
typeaheads. When the typed value has no match, the top available options are
returned instead.

`POST /api/seen` marks a business as contacted. `DELETE /api/seen` clears the
caller's contacted list. Identity is an optional email plus an httpOnly
anonymous cookie.

Other routes: `GET /api/health`, `/api/locations`, and the protected
`/api/admin/*` routes.

## Admin

Set `ADMIN_PASSWORD` and open `/admin`. The dashboard shows database totals,
cities/trades, the last 10 jobs, city/trade filters, live polling, Refresh and
Stop. Starting a crawl returns immediately with a job id; the work runs in the
background.

## Attribution

Business data © OpenStreetMap contributors, available under the
[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Emails and phone
numbers are read from public records, never guessed. The UI includes an opt-out
address and an NDPR/GDPR notice; every outreach template includes an unsubscribe
instruction.
