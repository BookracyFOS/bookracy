import { type CSSProperties } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { Slider } from "../ui/slider";
import { Switch } from "../ui/switch";
import { ClipBoardButton } from "../layout/clipboard-button";
import { cn } from "@/lib/utils";
import { AArrowDown, AArrowUp, Gauge, SlidersHorizontal } from "lucide-react";
import { READER_FONT_LIMITS, READER_FONT_STACKS, READER_THEMES, useReaderStore, type ReaderFont, type ReaderTheme, type ReaderWidth } from "@/stores/reader";

const THEME_OPTIONS: { value: ReaderTheme; label: string; swatch: string; ring: string }[] = [
  { value: "light", label: "Light", swatch: "#ffffff", ring: "#e5e7eb" },
  { value: "sepia", label: "Sepia", swatch: "#faf6ee", ring: "#e3d6b8" },
  { value: "dark", label: "Dark", swatch: "#141416", ring: "#2a2a2e" },
];

const FONT_OPTIONS: { value: ReaderFont; label: string; family?: string }[] = [
  { value: "original", label: "Original" },
  { value: "serif", label: "Serif", family: READER_FONT_STACKS.serif },
  { value: "sans", label: "Sans", family: READER_FONT_STACKS.sans },
  { value: "mono", label: "Mono", family: READER_FONT_STACKS.mono },
];

const WIDTH_OPTIONS: { value: ReaderWidth; label: string }[] = [
  { value: "narrow", label: "Narrow" },
  { value: "standard", label: "Medium" },
  { value: "wide", label: "Wide" },
  { value: "full", label: "Full" },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-[0.7rem] font-medium tracking-wide text-[var(--rs-muted)] uppercase">{children}</div>;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; family?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-[var(--rs-track)] p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          style={opt.family ? { fontFamily: opt.family } : undefined}
          className={cn(
            "cursor-pointer rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
            value === opt.value ? "bg-[var(--rs-active)] text-[var(--rs-fg)] shadow-sm" : "text-[var(--rs-muted)] hover:text-[var(--rs-fg)]",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function ReaderSettings({
  link,
  isMobile,
  paceWpm,
  etaLabel,
}: {
  link: string;
  isMobile: boolean;
  /** Detected reading speed in words/min, or null until we've measured it. */
  paceWpm: number | null;
  /** Personalised finish-time estimate, e.g. "2h 14m left". */
  etaLabel: string | null;
}) {
  const theme = useReaderStore((s) => s.theme);
  const setTheme = useReaderStore((s) => s.setTheme);
  const font = useReaderStore((s) => s.font);
  const setFont = useReaderStore((s) => s.setFont);
  const fontSize = useReaderStore((s) => s.fontSize);
  const setFontSize = useReaderStore((s) => s.setFontSize);
  const lineHeight = useReaderStore((s) => s.lineHeight);
  const setLineHeight = useReaderStore((s) => s.setLineHeight);
  const width = useReaderStore((s) => s.width);
  const setWidth = useReaderStore((s) => s.setWidth);
  const justify = useReaderStore((s) => s.justify);
  const setJustify = useReaderStore((s) => s.setJustify);

  const { MIN_FONT_SIZE, MAX_FONT_SIZE, MIN_LINE_HEIGHT, MAX_LINE_HEIGHT } = READER_FONT_LIMITS;

  // Theme the popover off the reader palette via cascading CSS vars, so it matches
  // the page (and the bottom bar / TOC) instead of following the global app theme.
  const palette = READER_THEMES[theme];
  const surfaceStyle = {
    background: palette.chrome,
    borderColor: palette.border,
    color: palette.fg,
    "--rs-fg": palette.fg,
    "--rs-muted": palette.muted,
    "--rs-border": palette.border,
    "--rs-track": `color-mix(in srgb, ${palette.fg} 8%, transparent)`,
    "--rs-active": `color-mix(in srgb, ${palette.fg} 16%, transparent)`,
  } as CSSProperties;

  return (
    // Modal on mobile so an outside tap dismisses it even over the book's <iframe>
    // (a non-modal popover can't see pointer events that land inside the iframe).
    <Popover modal={isMobile}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="size-9 rounded-full" aria-label="Reading settings">
          <SlidersHorizontal className="size-[1.15rem]" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={isMobile ? "center" : "end"} style={surfaceStyle} className="w-[20rem] max-w-[calc(100vw-1.5rem)]">
        <div className="flex flex-col gap-4">
          <section>
            <SectionLabel>Reading pace</SectionLabel>
            <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--rs-track)] px-3 py-2">
              {paceWpm ? (
                <>
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Gauge className="text-primary size-4 shrink-0" />≈ {paceWpm.toLocaleString()} wpm
                  </span>
                  {etaLabel && <span className="text-xs tabular-nums text-[var(--rs-muted)]">{etaLabel}</span>}
                </>
              ) : (
                <span className="flex items-center gap-2 text-xs text-[var(--rs-muted)]">
                  <Gauge className="size-4 shrink-0" />
                  Measuring your reading speed as you read…
                </span>
              )}
            </div>
          </section>

          <section>
            <SectionLabel>Theme</SectionLabel>
            <div className="grid grid-cols-3 gap-2">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTheme(opt.value)}
                  className={cn(
                    "flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-2 p-2 transition-colors",
                    theme === opt.value ? "border-primary" : "border-transparent hover:border-[var(--rs-border)]",
                  )}
                >
                  <span className="h-8 w-full rounded-md" style={{ background: opt.swatch, boxShadow: `inset 0 0 0 1px ${opt.ring}` }} />
                  <span className="text-xs font-medium">{opt.label}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <SectionLabel>Text size</SectionLabel>
            <div className="flex items-center gap-3">
              <AArrowDown className="text-[var(--rs-muted)] size-4 shrink-0" />
              <Slider aria-label="Text size" value={[fontSize]} min={MIN_FONT_SIZE} max={MAX_FONT_SIZE} step={1} onValueChange={(v) => setFontSize(v[0])} className="grow" />
              <AArrowUp className="text-[var(--rs-muted)] size-5 shrink-0" />
              <span className="text-[var(--rs-muted)] w-8 text-right text-xs tabular-nums">{fontSize}</span>
            </div>
          </section>

          <section>
            <SectionLabel>Line spacing</SectionLabel>
            <div className="flex items-center gap-3">
              <span className="text-[var(--rs-muted)] shrink-0 text-xs">Tight</span>
              <Slider
                aria-label="Line spacing"
                value={[lineHeight]}
                min={MIN_LINE_HEIGHT}
                max={MAX_LINE_HEIGHT}
                step={0.1}
                onValueChange={(v) => setLineHeight(v[0])}
                className="grow"
              />
              <span className="text-[var(--rs-muted)] shrink-0 text-xs">Loose</span>
              <span className="text-[var(--rs-muted)] w-8 text-right text-xs tabular-nums">{lineHeight.toFixed(1)}</span>
            </div>
          </section>

          <section>
            <SectionLabel>Typeface</SectionLabel>
            <Segmented value={font} options={FONT_OPTIONS} onChange={setFont} />
          </section>

          {!isMobile && (
            <section>
              <SectionLabel>Page width</SectionLabel>
              <Segmented value={width} options={WIDTH_OPTIONS} onChange={setWidth} />
            </section>
          )}

          <div className="flex items-center justify-between">
            <label htmlFor="reader-justify" className="text-sm">
              Justify text
            </label>
            <Switch id="reader-justify" checked={justify} onCheckedChange={setJustify} />
          </div>

          <div className="flex items-center justify-between border-t border-[var(--rs-border)] pt-3">
            <span className="text-sm text-[var(--rs-muted)]">Share this book</span>
            <ClipBoardButton
              content={link ?? ""}
              className="border-[var(--rs-border)] bg-[var(--rs-track)] text-[var(--rs-fg)] hover:bg-[var(--rs-active)] hover:text-[var(--rs-fg)]"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
