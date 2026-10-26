import type { Rendition } from "epubjs";
import { READER_THEMES, READER_FONT_STACKS, type ReaderAppearance } from "@/stores/reader";

// epub.js's Themes exposes `removeOverride` at runtime but it's absent from the
// shipped typings — declare the bits we lean on so we stay type-safe.
type ThemesRuntime = Rendition["themes"] & {
  removeOverride?: (name: string) => void;
  default?: (rules: object) => void;
};

/**
 * Push the reader's appearance onto a live epub.js rendition. Body-level props go
 * through `override` (applied inline with `!important` so they beat the book's own
 * CSS and re-apply to every freshly rendered chapter), while supplementary rules
 * (image fit, link colour, selection) ride on the always-injected "default" theme.
 * Safe to call before the first page renders and on every appearance change.
 */
export function applyAppearance(rendition: Rendition, a: ReaderAppearance): void {
  const themes = rendition.themes as ThemesRuntime;
  const palette = READER_THEMES[a.theme];

  themes.override("color", palette.fg, true);
  themes.override("background", palette.bg, true);
  themes.fontSize(`${a.fontSize}px`);
  themes.override("line-height", String(a.lineHeight), true);

  // "original" keeps the publisher's typeface; otherwise force a clean stack.
  if (a.font === "original") themes.removeOverride?.("font-family");
  else themes.override("font-family", READER_FONT_STACKS[a.font], true);

  if (a.justify) themes.override("text-align", "justify", true);
  else themes.removeOverride?.("text-align");

  // Supplementary rules that body inline styles can't express: keep images inside
  // the page, make links inherit the themed colour (readable on every theme), and
  // tint text selection to match.
  themes.default?.({
    "img, image, svg": {
      "max-width": "100% !important",
      "max-height": "100% !important",
      height: "auto !important",
      "object-fit": "contain",
    },
    "a, a:link, a:visited": { color: "inherit", "text-decoration": "underline" },
    "::selection": { background: palette.selection },
  });
}
