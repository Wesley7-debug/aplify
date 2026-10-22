/**
 * Owner identity shared by the browser and server defaults.
 *
 * `APLIFY_OWNER_EMAILS` can extend this list on the server; the UI only uses the
 * default address to show the larger 30-email allowance before the first run.
 */
export const DEFAULT_OWNER_EMAIL = "eugenefidelis573@gmail.com";

export function isDefaultOwnerEmail(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === DEFAULT_OWNER_EMAIL;
}
