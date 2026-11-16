"use client";

import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function StoreError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-24">
      <div role="alert" className="text-center">
        <h1 className="text-2xl font-semibold text-foreground">The store is not responding</h1>
        <p className="mt-2 text-muted-foreground">We could not load this page. Try again in a moment.</p>
        <Button className="mt-6" onClick={() => retry()}>
          <RotateCw aria-hidden="true" className="mr-2 h-4 w-4" />
          Try again
        </Button>
      </div>
    </div>
  );
}
