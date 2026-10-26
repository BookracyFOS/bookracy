import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 40;
const DEFAULT_FONT_SIZE = 18;

const MIN_LINE_HEIGHT = 1.2;
const MAX_LINE_HEIGHT = 2.4;
const DEFAULT_LINE_HEIGHT = 1.6;

/** The reader's own theme — deliberately independent of the global app theme so a
 *  reader can read in sepia at night without flipping the whole site. */
export type ReaderTheme = "light" | "sepia" | "dark";
/** "original" keeps the book's own typeface; the rest force a clean reading stack. */
export type ReaderFont = "original" | "serif" | "sans" | "mono";
/** Page measure on desktop — controls the centred reading column width. */
export type ReaderWidth = "narrow" | "standard" | "wide" | "full";

/** Per-theme palette shared by epub.js overrides AND the React chrome.
 *  `canvas` = the surround behind the page; `bg` = the page itself; `chrome` tints
 *  the header/footer glass so sepia/dark feel blended instead of bolted-on. */
export const READER_THEMES: Record<
  ReaderTheme,
  { bg: string; canvas: string; fg: string; muted: string; selection: string; chrome: string; border: string }
> = {
  light: {
    bg: "#ffffff",
    canvas: "#eef0f4",
    fg: "#1a1a1a",
    muted: "#6b7280",
    selection: "rgba(99,102,241,0.20)",
    chrome: "rgba(255,255,255,0.78)",
    border: "rgba(0,0,0,0.06)",
  },
  sepia: {
    bg: "#faf6ee",
    canvas: "#e5d9c0",
    fg: "#5b4636",
    muted: "#8a7a63",
    selection: "rgba(139,108,66,0.22)",
    chrome: "rgba(250,246,238,0.82)",
    border: "rgba(91,70,54,0.10)",
  },
  dark: {
    bg: "#141416",
    canvas: "#0b0b0d",
    fg: "#e6e3df",
    muted: "#9aa0a6",
    selection: "rgba(139,128,255,0.28)",
    chrome: "rgba(20,20,22,0.82)",
    border: "rgba(255,255,255,0.08)",
  },
};

/** CSS font-family stacks for the forced typefaces. */
export const READER_FONT_STACKS: Record<Exclude<ReaderFont, "original">, string> = {
  serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif',
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: '"SF Mono", ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace',
};

/** Max reading-column width (px) per measure; "full" means no cap. */
export const READER_WIDTH_PX: Record<ReaderWidth, number | null> = {
  narrow: 580,
  standard: 720,
  wide: 900,
  full: null,
};

export interface ReaderAppearance {
  theme: ReaderTheme;
  font: ReaderFont;
  fontSize: number;
  lineHeight: number;
  width: ReaderWidth;
  justify: boolean;
}

interface ReaderStoreState extends ReaderAppearance {
  setFontSize: (fontSize: number) => void;
  setTheme: (theme: ReaderTheme) => void;
  setFont: (font: ReaderFont) => void;
  setLineHeight: (lineHeight: number) => void;
  setWidth: (width: ReaderWidth) => void;
  setJustify: (justify: boolean) => void;
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const clampFontSize = (size: number) => clamp(Math.round(size), MIN_FONT_SIZE, MAX_FONT_SIZE);
// Snap to one decimal so the slider doesn't accumulate float dust (1.5999999…).
const clampLineHeight = (lh: number) => Math.round(clamp(lh, MIN_LINE_HEIGHT, MAX_LINE_HEIGHT) * 10) / 10;

export const useReaderStore = create<ReaderStoreState>()(
  persist(
    (set) => ({
      theme: "dark",
      font: "original",
      fontSize: DEFAULT_FONT_SIZE,
      lineHeight: DEFAULT_LINE_HEIGHT,
      width: "standard",
      justify: false,

      setFontSize: (fontSize) => set({ fontSize: clampFontSize(fontSize) }),
      setTheme: (theme) => set({ theme }),
      setFont: (font) => set({ font }),
      setLineHeight: (lineHeight) => set({ lineHeight: clampLineHeight(lineHeight) }),
      setWidth: (width) => set({ width }),
      setJustify: (justify) => set({ justify }),
    }),
    {
      name: "BR::reader",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // v0 only stored `fontSize`; the new appearance fields fall back to defaults.
      migrate: (persisted) => persisted as Partial<ReaderStoreState>,
    },
  ),
);

export const READER_FONT_LIMITS = { MIN_FONT_SIZE, MAX_FONT_SIZE, MIN_LINE_HEIGHT, MAX_LINE_HEIGHT };
