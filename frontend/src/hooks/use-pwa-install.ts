import { useCallback, useEffect, useState } from "react";

/** The non-standard event Chromium fires when the app is installable. */
interface BeforeInstallPromptEvent extends Event {
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt: () => Promise<void>;
}

/**
 * Surfaces the "Add to home screen / Install app" capability:
 *  - `canInstall` + `promptInstall()` when the browser offers a native prompt (Chromium).
 *  - `installed` once it's running standalone (or after an install completes).
 *  - `isIOS` so we can show manual Add-to-Home-Screen guidance on iOS Safari.
 */
export function usePwaInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true;
    if (standalone) setInstalled(true);

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      /* user dismissed */
    }
    setDeferred(null);
  }, [deferred]);

  const isIOS =
    typeof navigator !== "undefined" &&
    // iPadOS 13+ Safari reports as a desktop Mac, so also treat a touch-capable "MacIntel" as iOS.
    (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

  return { canInstall: Boolean(deferred), installed, isIOS, promptInstall } as const;
}
