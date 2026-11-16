"use client";

import { useEffect } from "react";
import { useFormStatus } from "react-dom";
import { loginAction } from "@/lib/admin-actions";
import { ADMIN_CHAT_STORAGE_KEY } from "@/lib/admin-chat-storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LoginFormProps {
  hasError: boolean;
}

export function LoginForm({ hasError }: LoginFormProps) {
  // Sign out lands here. The admin chat holds store data, so it does not
  // stay in this browser.
  useEffect(() => {
    try {
      window.localStorage.removeItem(ADMIN_CHAT_STORAGE_KEY);
    } catch {
      // Storage is blocked. Nothing was stored.
    }
  }, []);

  return (
    <form action={loginAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
        />
      </div>
      {hasError && (
        <p role="alert" className="text-sm text-destructive">
          Incorrect password.
        </p>
      )}
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}
