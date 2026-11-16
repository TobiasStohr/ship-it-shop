import "server-only";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, isAdminSessionToken } from "@/lib/admin-auth";

/**
 * Checks the admin cookie in API routes and pages. `proxy.ts` only guards
 * the `/admin` pages, so every admin API route calls this itself.
 */
export async function isAdminRequest(): Promise<boolean> {
  return isAdminSessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value);
}
