import { DuckDBConnection } from "@duckdb/node-api";

const PLACES =
  "s3://overturemaps-us-west-2/release/2026-09-23.1/theme=places/type=place/*.parquet";

async function main(): Promise<void> {
  const connection = await DuckDBConnection.create();
  await connection.run("INSTALL httpfs; LOAD httpfs;");
  await connection.run("SET s3_region = 'us-west-2';");
  await connection.run("SET s3_use_ssl = true;");

  const reader = await connection.runAndReadAll(
    `WITH ng AS (
       SELECT *,
         coalesce(len(phones), 0) AS n_phone,
         coalesce(len(emails), 0) AS n_email,
         coalesce(len(websites), 0) AS n_website
       FROM read_parquet('${PLACES}')
       WHERE bbox.xmin >= 2.6 AND bbox.xmax <= 14.7
         AND bbox.ymin >= 4.2 AND bbox.ymax <= 13.9
     )
     SELECT
       coalesce(addresses[1].country, '(none)') AS country,
       count(*) AS total,
       sum(CASE WHEN n_phone > 0 THEN 1 ELSE 0 END) AS with_phone,
       sum(CASE WHEN n_email > 0 THEN 1 ELSE 0 END) AS with_email,
       sum(CASE WHEN n_website > 0 THEN 1 ELSE 0 END) AS with_website,
       sum(CASE WHEN n_phone > 0 AND n_website = 0 THEN 1 ELSE 0 END) AS phone_no_site,
       sum(CASE WHEN n_email > 0 AND n_website = 0 THEN 1 ELSE 0 END) AS email_no_site,
       sum(CASE WHEN (n_phone > 0 OR n_email > 0) AND n_website = 0 THEN 1 ELSE 0 END) AS contact_no_site
     FROM ng
     GROUP BY 1
     ORDER BY total DESC
     LIMIT 15`,
  );
  console.log(reader.getRowObjects());
}

main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
