import type { ReactNode } from "react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Skeleton } from "@/components/ui/skeleton";

export function Loading({ label, rows, tall = false }: { label: string; rows: number; tall?: boolean }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <Shimmer className="text-sm">{`${label}…`}</Shimmer>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={tall ? "h-40 w-full" : "h-[4.5rem] w-full"} />
      ))}
    </div>
  );
}

export function Notice({
  children,
  icon,
  tone = "info",
}: {
  children: ReactNode;
  icon: ReactNode;
  tone?: "info" | "error";
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "flex items-start gap-2 rounded-lg border border-destructive/40 p-3 text-sm"
          : "flex items-start gap-2 rounded-lg border border-border p-3 text-sm text-muted-foreground"
      }
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <p className="min-w-0">{children}</p>
    </div>
  );
}

/**
 * True when the model sent arguments that failed the tool's input schema.
 * The model sees the error and calls the tool again, so the UI hides it.
 */
export function isInvalidInputError(part: { state: string; errorText?: string }) {
  if (part.state !== "output-error" || !part.errorText) return false;
  return part.errorText.includes("InvalidToolInputError") || part.errorText.startsWith("Invalid input for tool");
}
