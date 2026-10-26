import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// A hint of the app's frosted black glass for cards that otherwise sit on bg-card.
// The important `!` ensures the translucent glass background wins over `bg-card`.
export const glassCard =
  "bg-[var(--glass-bg)]! border-[var(--glass-border)] shadow-[inset_0_1px_0_var(--glass-sheen),0_10px_30px_-18px_rgba(0,0,0,0.55)] backdrop-blur-xl";

// The navbar's exact frosted look — reuse on the footer / sheet so they all match.
export const glassNav = "supports-[backdrop-filter]:bg-background/55 bg-background/80 backdrop-blur-xl backdrop-saturate-150";

// A lighter glass for small controls (theme toggle, hamburger) sitting on the navbar.
export const glassControl = "border-border/60 bg-background/70 supports-[backdrop-filter]:bg-background/45 backdrop-blur-md";

// Frosted surface for floating menus that portal over the page (dropdown, select,
// popover). Kept a touch more opaque than cards so small menu text stays legible
// over busy content behind the frost.
export const glassPopover =
  "bg-popover/85 supports-[backdrop-filter]:bg-popover/72 backdrop-blur-xl backdrop-saturate-150 border-border/60";
