import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createFileRoute } from "@tanstack/react-router";
import { cn, glassCard } from "@/lib/utils";
import { Ban, BookOpen, ChevronLeft, ChevronRight, EyeOff, LockOpen, type LucideIcon, ShieldAlert, Users } from "lucide-react";
import { useRef } from "react";

export const Route = createFileRoute("/about")({
  component: About,
});

type Feature = { icon: LucideIcon; title: string; body: string };

const FEATURES: Feature[] = [
  { icon: LockOpen, title: "Free & open", body: "Knowledge that isn't behind a paywall." },
  { icon: BookOpen, title: "Read anywhere", body: "Read in-browser or download, any device." },
  { icon: Users, title: "Community-built", body: "Made by people, for people." },
  { icon: Ban, title: "Ad-free forever", body: "No ads, no trackers, no upsells. Ever." },
  { icon: EyeOff, title: "Privacy first", body: "Nothing's tied to you — data stays on-device." },
];

function About() {
  const scrollerRef = useRef<HTMLDivElement>(null);

  const scrollByPage = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (el) el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.85), behavior: "smooth" });
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Card className={cn(glassCard, "border-primary/20")}>
        <CardHeader>
          <CardTitle className="text-2xl">About Bookracy</CardTitle>
          <CardDescription className="text-base leading-relaxed">
            Bookracy is an open-source project that gives everyone a free platform to share and discover books. It's an ongoing labour of love — we're still building out features, so expect
            things to keep getting better. Got feedback or ideas? We'd genuinely love to hear them.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="group/carousel relative">
            <button
              type="button"
              aria-label="Scroll left"
              onClick={() => scrollByPage(-1)}
              className="glass glass-hover absolute top-1/2 left-0 z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full opacity-0 transition-opacity group-hover/carousel:opacity-100 sm:flex"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Scroll right"
              onClick={() => scrollByPage(1)}
              className="glass glass-hover absolute top-1/2 right-0 z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full opacity-0 transition-opacity group-hover/carousel:opacity-100 sm:flex"
            >
              <ChevronRight className="h-5 w-5" />
            </button>

            <div
              ref={scrollerRef}
              className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <div key={title} className="glass-subtle flex w-[210px] shrink-0 snap-start flex-col gap-2.5 rounded-2xl p-4">
                  <span className="bg-primary/15 text-primary flex h-10 w-10 items-center justify-center rounded-xl">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="flex flex-col gap-1">
                    <p className="font-semibold">{title}</p>
                    <p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-subtle text-muted-foreground flex items-start gap-3 rounded-xl p-4 text-sm">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <p>DMCA takedown requests will be ignored here. Please direct any DMCA request to the hosting provider.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
