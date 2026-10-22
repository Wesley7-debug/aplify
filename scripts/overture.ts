/**
 * Inspect / query the free Overture Maps places dataset.
 *
 *   npx tsx scripts/overture.ts --describe
 *   npx tsx scripts/overture.ts --count
 *
 * No API key is used. DuckDB reads the public S3 parquet files and pushes the
 * Nigeria bounding box filter down to the parquet row groups.
 */

import { DuckDBConnection } from "@duckdb/node-api";

const RELEASE = "2026-09-23.1";
const PLACES = `s3://overturemaps-us-west-2/release/${RELEASE}/theme=places/type=place/*.parquet`;

// Nigeria (including offshore islands), generous enough to include all states.
const BBOX = { west: 2.6, south: 4.2, east: 14.7, north: 13.9 };

async function main(): Promise<void> {
  const connection = await DuckDBConnection.create();
  await connection.run("INSTALL httpfs; LOAD httpfs;");
  await connection.run("SET s3_region = 'us-west-2';");
  await connection.run("SET s3_use_ssl = true;");

  if (process.argv.includes("--describe")) {
    const reader = await connection.runAndReadAll(
      `DESCRIBE SELECT * FROM read_parquet('${PLACES}') LIMIT 0`,
    );
    for (const row of reader.getRowObjects()) {
      console.log(`${String(row.column_name).padEnd(28)} ${String(row.column_type)}`);
    }
    return;
  }

  const reader = await connection.runAndReadAll(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN len(phones) > 0 THEN 1 ELSE 0 END) AS with_phone,
       SUM(CASE WHEN len(emails) > 0 THEN 1 ELSE 0 END) AS with_email,
       SUM(CASE WHEN len(websites) > 0 THEN 1 ELSE 0 END) AS with_website,
       SUM(CASE WHEN len(phones) > 0 AND len(websites) = 0 THEN 1 ELSE 0 END) AS phone_no_site,
       SUM(CASE WHEN len(emails) > 0 AND len(websites) = 0 THEN 1 ELSE 0 END) AS email_no_site,
       SUM(CASE WHEN (len(phones) > 0 OR len(emails) > 0) AND len(websites) = 0 THEN 1 ELSE 0 END) AS contact_no_site
     FROM read_parquet('${PLACES}')
     WHERE bbox.xmin >= ${BBOX.west}
       AND bbox.xmax <= ${BBOX.east}
       AND bbox.ymin >= ${BBOX.south}
       AND bbox.ymax <= ${BBOX.north}`,
  );
  console.log(reader.getRowObjects());
}

main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
