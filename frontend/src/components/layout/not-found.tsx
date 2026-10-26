import { Link } from "@tanstack/react-router";
import { Compass, Home, Library } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNoindex } from "@/hooks/use-seo";

/**
 * Liquid-glass 404. A frosted, tinted icon orb floating over an ambient glow,
 * with clear ways back into the app.
 */
export function NotFound() {
  // The SPA serves a 200 + this component for unknown URLs; tell crawlers not
  // to index it so it doesn't get logged as a soft 404.
  useNoindex();

  return (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center p-4">
      <div className="glass-strong relative flex w-full max-w-md flex-col items-center gap-6 overflow-hidden rounded-3xl p-8 text-center sm:p-10">
        {/* ambient glow behind the orb */}
        <div aria-hidden className="bg-primary/30 pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full blur-3xl" />

        <div className="liquid-orb animate-float relative flex h-24 w-24 items-center justify-center rounded-[28px]">
          <Compass className="text-primary relative z-10 h-10 w-10" />
        </div>

        <div className="relative flex flex-col gap-2">
          <p className="text-primary text-xs font-semibold tracking-[0.25em] uppercase">Error 404</p>
          <h1 className="text-3xl font-bold tracking-tight">Lost in the stacks</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">This page wandered off the shelf. The link may be broken, or the page has moved.</p>
        </div>

        <div className="relative flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
          <Button asChild className="gap-2">
            <Link to="/" search={{ q: "" }}>
              <Home className="h-4 w-4" />
              Back home
            </Link>
          </Button>
          <Button asChild variant="outline" className="gap-2">
            <Link to="/library">
              <Library className="h-4 w-4" />
              Browse library
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
