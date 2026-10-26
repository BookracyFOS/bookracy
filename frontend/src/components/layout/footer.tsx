import { Link } from "@tanstack/react-router";

export function Footer() {
  return (
    <div className="supports-[backdrop-filter]:bg-background/55 bg-background/80 border-border/60 z-20 w-full border-t pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] backdrop-blur-xl backdrop-saturate-150">
      <div className="flex h-14 items-center justify-center gap-4 px-8">
        <Link to="/about" className="hover:text-foreground text-muted-foreground transition-colors">
          <p className="text-sm font-medium">© {new Date().getFullYear()} Bookracy</p>
        </Link>
        <div className="flex-1" />
      </div>
    </div>
  );
}
