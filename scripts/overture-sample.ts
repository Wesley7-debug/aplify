import { DuckDBConnection } from "@duckdb/node-api";

const PLACES =
  "s3://overturemaps-us-west-2/release/2026-09-23.1/theme=places/type=place/*.parquet";

async function main(): Promise<void> {
  const connection = await DuckDBConnection.create();
  await connection.run("INSTALL httpfs; LOAD httpfs;");
  await connection.run("SET s3_region = 'us-west-2';");
  await connection.run("SET s3_use_ssl = true;");

  const reader = await connection.runAndReadAll(
    `SELECT names.primary AS name, phones, websites, emails, basic_category,
            addresses[1].locality AS city, addresses[1].region AS region
     FROM read_parquet('${PLACES}')
     WHERE bbox.xmin >= 2.6 AND bbox.xmax <= 14.7
       AND bbox.ymin >= 4.2 AND bbox.ymax <= 13.9
       AND len(phones) > 0
     LIMIT 20`,
  );
  console.log(reader.getRowObjects());
}

main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
