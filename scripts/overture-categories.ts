import { DuckDBConnection } from "@duckdb/node-api";

const PLACES =
  "s3://overturemaps-us-west-2/release/2026-09-23.1/theme=places/type=place/*.parquet";

async function main(): Promise<void> {
  const connection = await DuckDBConnection.create();
  await connection.run("INSTALL httpfs; LOAD httpfs;");
  await connection.run("SET s3_region = 'us-west-2';");
  await connection.run("SET s3_use_ssl = true;");

  const reader = await connection.runAndReadAll(
    `SELECT basic_category, count(*) AS total
     FROM read_parquet('${PLACES}')
     WHERE bbox.xmin >= 2.6 AND bbox.xmax <= 14.7
       AND bbox.ymin >= 4.2 AND bbox.ymax <= 13.9
       AND addresses[1].country = 'NG'
       AND (coalesce(len(phones), 0) > 0 OR coalesce(len(emails), 0) > 0)
       AND coalesce(len(websites), 0) = 0
     GROUP BY 1
     ORDER BY total DESC
     LIMIT 60`,
  );
  console.log(reader.getRowObjects());
}

main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
