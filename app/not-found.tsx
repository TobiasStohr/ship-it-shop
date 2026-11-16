import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-24">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-foreground">Page not found</h1>
        <p className="mt-2 text-muted-foreground">This page does not exist.</p>
        <Button asChild className="mt-6">
          <Link href="/">Back to the shop</Link>
        </Button>
      </div>
    </main>
  );
}
