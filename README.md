# Aplify V1

Find Nigerian businesses you can contact. Results come from a local SQLite/Turso
database built from real OpenStreetMap and Overture Maps data — no paid APIs, no
API keys, and no live map lookup on the search path.

A result is only returned when the business has:

- a **validated public email or a published phone number**, and
- **no published website**.

Searches are answered from the database in milliseconds. Visitors must enter an
email in a blocking modal before they can search; the email is kept in a signed
httpOnly cookie. A random device id is kept in localStorage and sent as a header,
with an httpOnly device cookie as a fallback — no usage is stored in localStorage.

Normal visitors get **10 fresh contacts per search** and **10 per rolling 20-hour
window**. The window is checked against the email, a hashed network address and
the device id together, so changing only the email, only the device, or only the
network does not reset the allowance. Admin access is the separate `/admin`
password session: it is not limited and can return up to **30 per search**.
Typing an admin email into the public modal does not grant admin rights.

Every delivered business is stored in `seen_businesses`, so neither the same lead
nor the same email address is returned again — including on later days. Fetched
contacts are saved to the email's `/history` page, and the home page restores the
last fetched batch after a reload or full navigation.

## Quick start

```bash
npm install
cp .env.example .env.local       # set ADMIN_PASSWORD
npm run seed:overture -- --target=3200   # real no-website contacts from Overture Maps
npm run validate                 # DNS-validates every stored email
npm run dev                      # http://localhost:3000
```

Nigeria is the only seeded country for this version. The database lives at
`data/aplify.db` and is git-ignored. Re-running the seed is safe; rows are
upserted by their source id.

The Overture import uses DuckDB to read the free, public Overture Maps places
parquet files. It keeps only Nigerian businesses with a phone number or email
and no published website, assigns coordinates to Nigeria's 36 states + FCT using
the openly licensed geoBoundaries polygons, then balances the seed across every
state. No API key is needed.

To import OSM instead (larger download, fewer contact details):

```bash
npm run seed -- --target=3200    # downloads the Nigeria PBF (~700 MB)
```

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
| `npm run seed:overture` | Import no-website Nigerian contacts from Overture Maps |
| `npm run validate` | Syntax + junk + DNS validation for stored emails |
| `npm run crawl` | Background OSM discovery + website email finding |
| `npm run db:reset` | Delete every seeded row from local SQLite and Turso |
| `npm run snapshot` | Legacy snapshot builder (not used by `/api/search`) |

Seed options: `--file=path.osm.pbf`, `--url=...`, `--city=Lagos`,
`--target=3000`. By default the OSM importer keeps only businesses with no
website and at least one contact (valid email syntax or phone); use
`--allow-website` or `--include-without-contact` to relax that.
Overture options: `--target=3200`. Crawl options: `--minutes=8`, `--city=Lagos`,
`--trade=Restaurants`.

## Database

Default: `file:data/aplify.db` using Node's built-in `node:sqlite`.

Turso (HTTP, no native build):

```env
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=...
```

Core tables:

- `businesses` — real OSM/Overture records, normalized place/trade keys, validated email or phone.
- `daily_contacts` — unique businesses shown per email/IP/device key; rolling 20-hour quota + history.
- `seen_businesses` — `(user_key, business_id)` contacted list.
- `search_events` — short-window rate limiting per email/IP/device.
- `crawl_jobs`, `crawl_cursor` — admin dashboard and resumable discovery.

`email_validated_at` is set only after syntax, junk and DNS checks pass. Invalid
addresses are removed, and a business is only kept if it still has a phone
number.

## Search API

`GET /api/search?audience=hotels&location=Enugu`

Requires the email session cookie set by `/api/auth`. Normal visitors get up to
10 contacts and admins up to 30 per search, never more than the remaining
20-hour allowance. `seen=id,id` only affects ordering. History and the contacted
list are keyed by the signed-in email; the quota takes the maximum usage across
the email, hashed IP and device keys.

`GET /api/suggestions?kind=trade|location|available&q=...` returns database-backed
typeaheads. When the typed value has no match, the top available options are
returned instead.

`GET /api/auth` returns the current email session. `POST /api/auth` signs in with
an email (no public password). `DELETE /api/auth` signs out without resetting the
device quota. Admin privileges require signing in at `/admin` with
`ADMIN_PASSWORD`.

`GET /api/history?days=7` returns the contacts already fetched by this email.
`GET /api/recent` returns the batch from the most recent fetch, used to restore
the home page after a reload. `GET /api/allowance` reports whether the search
button should be enabled.
`POST /api/seen` records a contacted lead. Delivered leads are marked as seen
automatically and are not recycled.

Other routes: `GET /api/health`, `/api/locations`, and the protected
`/api/admin/*` routes.

## Admin

Set `ADMIN_PASSWORD` and open `/admin`. The dashboard shows database totals,
cities/trades, the last 10 jobs, city/trade filters, live polling, Refresh and
Stop. Starting a crawl returns immediately with a job id; the work runs in the
background. Use **Search leads** in the dashboard to return to the public search;
the signed admin session makes that browser unlimited.

## Attribution

Business data © OpenStreetMap contributors (ODbL 1.0) and Overture Maps
Foundation contributors (CDLA-Permissive 2.0). State assignment uses
geoBoundaries Nigeria ADM1 boundaries (CC BY 4.0). Emails and phone numbers are
read from public records, never guessed. The UI includes an opt-out address;
every outreach template includes an unsubscribe instruction.
