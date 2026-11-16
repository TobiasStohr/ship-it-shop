import "server-only";
import { timingSafeEqual } from "node:crypto";
import { ADMIN_COOKIE_NAME, sessionToken } from "@/lib/admin-token";

/**
 * Admin gate. The password comes from the ADMIN_PASSWORD env var. The cookie
 * holds an HMAC of it. Every check fails closed when the env var is unset.
 */

export { ADMIN_COOKIE_NAME };

const password = process.env.ADMIN_PASSWORD || null;
const expectedToken = password ? sessionToken(password) : null;

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function checkAdminPassword(input: string): boolean {
  return expectedToken !== null && safeEqual(sessionToken(input), expectedToken);
}

export function adminSessionToken(): string {
  if (!expectedToken) throw new Error("ADMIN_PASSWORD is not set.");
  return expectedToken;
}

export function isAdminSessionToken(value: string | undefined): boolean {
  return value !== undefined && expectedToken !== null && safeEqual(value, expectedToken);
}
