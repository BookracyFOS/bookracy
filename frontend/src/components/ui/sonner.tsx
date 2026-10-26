"use client";

import { useSettingsStore } from "@/stores/settings";
import { Toaster as Sonner, ToasterProps } from "sonner";

// Default lifetime for any toast that doesn't specify one. Sonner's own default is
// also 4s, but pinning it here makes the intent explicit and stops future upstream
// changes from silently affecting our UX.
export const TOAST_DURATION_MS = 4000;
// Slightly longer for the "warning" style messages (fallback book, might not match)
// so users get time to actually read the caveat.
export const TOAST_DURATION_LONG_MS = 6000;

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useSettingsStore((state) => state.theme);

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      duration={TOAST_DURATION_MS}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
