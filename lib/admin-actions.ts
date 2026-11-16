"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ADMIN_COOKIE_NAME, adminSessionToken, checkAdminPassword } from "./admin-auth";

const COOKIE_MAX_AGE = 60 * 60 * 24;

const passwordSchema = z.string().min(1).max(200);

export async function loginAction(formData: FormData): Promise<void> {
  const password = passwordSchema.safeParse(formData.get("password"));
  if (!password.success || !checkAdminPassword(password.data)) {
    redirect("/admin/login?error=1");
  }
  const store = await cookies();
  store.set(ADMIN_COOKIE_NAME, adminSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE,
    // "/" so that the admin API routes under /api/admin also get the cookie.
    path: "/",
  });
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  store.delete({ name: ADMIN_COOKIE_NAME, path: "/" });
  redirect("/admin/login");
}
