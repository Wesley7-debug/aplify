/**
 * Validate every stored email with syntax, junk and DNS checks.
 *
 *   npm run validate
 *   npm run validate -- --force
 *
 * Invalid addresses are removed from the searchable row, so every result the
 * app returns is a validated address. `--force` re-checks already-validated
 * rows (useful after a long time or a DNS outage).
 */

import { closeDb, countBusinesses, countWithEmail, validateStoredEmails } from "../lib/db";

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  console.log(force ? "Re-validating all stored emails…" : "Validating new stored emails…");
  const result = await validateStoredEmails({ force });
  console.log(
    `Checked ${result.checked.toLocaleString()} · valid ${result.valid.toLocaleString()} · ` +
      `invalid ${result.invalid.toLocaleString()}`,
  );
  console.log(
    `Database: ${(await countBusinesses()).toLocaleString()} businesses · ` +
      `${(await countWithEmail()).toLocaleString()} with a validated email`,
  );
}

main()
  .catch((cause) => {
    console.error("Validation failed:", cause);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb().catch(() => undefined);
  });
