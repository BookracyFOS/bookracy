import { useState } from "react";
import { BookOpen, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { funCoverCaption } from "@/lib/fun";

interface BookCoverProps {
  src?: string | null;
  alt: string;
  /** When provided the cover acts like a button and shows a pointer cursor. */
  onClick?: () => void;
  /** Force the pointer cursor + hover zoom even when click is handled by a parent (e.g. a Dialog trigger). */
  interactive?: boolean;
  className?: string;
  /** Hide the rotating loading caption (used on tiny thumbnails). */
  showCaption?: boolean;
  /** Referrer policy for the <img> (e.g. "no-referrer" for hotlink-protected external covers). */
  referrerPolicy?: React.ImgHTMLAttributes<HTMLImageElement>["referrerPolicy"];
}

/**
 * Cover art with a graceful loading state: a shimmer + spinner + playful caption
 * while the image streams in, a soft blur-up reveal, and an on-brand "no cover"
 * fallback (instead of a stock placeholder image) when art is missing.
 */
export function BookCover({ src, alt, onClick, interactive, className, showCaption = true, referrerPolicy }: BookCoverProps) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const [caption] = useState(funCoverCaption);

  const clickable = Boolean(onClick) || interactive;
  const noImage = errored || !src;

  return (
    <div
      className={cn("group/cover bg-muted/40 relative h-full w-full overflow-hidden rounded-xl", clickable && "cursor-pointer", className)}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === "Enter" || e.key === " ") && onClick() : undefined}
    >
      {noImage ? (
        <div className="from-primary/10 via-muted/30 to-background text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br" aria-label={`${alt} — no cover available`}>
          <BookOpen className="h-8 w-8 opacity-50" />
          <span className="px-3 text-center text-[11px] leading-tight opacity-70">No cover</span>
        </div>
      ) : (
        <>
          {!loaded && (
            <div className="skeleton-shimmer bg-muted/60 absolute inset-0 z-10">
              {/* Spinner is dead-centre in the thumbnail; caption sits at the bottom so it never shifts the spinner up. */}
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="text-muted-foreground/70 h-6 w-6 animate-spin" />
              </div>
              {showCaption && <span className="text-muted-foreground/70 absolute inset-x-0 bottom-2 px-3 text-center text-[11px] leading-tight">{caption}</span>}
            </div>
          )}
          <img
            src={src!}
            alt={alt}
            loading="lazy"
            decoding="async"
            referrerPolicy={referrerPolicy}
            onLoad={() => setLoaded(true)}
            onError={() => setErrored(true)}
            className={cn(
              "h-full w-full object-cover transition-all duration-500 ease-out",
              loaded ? "scale-100 opacity-100 blur-0" : "scale-105 opacity-0 blur-md",
              clickable && "group-hover/cover:scale-[1.04]",
            )}
          />
        </>
      )}
    </div>
  );
}
