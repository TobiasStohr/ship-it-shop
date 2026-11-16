import { createHmac } from "node:crypto";

/**
 * Admin session token without `server-only`, so the test scripts can derive
 * the cookie the same way. The token is an HMAC of the admin password.
 */

export const ADMIN_COOKIE_NAME = "admin_auth";

export function sessionToken(password: string): string {
  return createHmac("sha256", password).update("ship-shop-admin-session").digest("hex");
}
