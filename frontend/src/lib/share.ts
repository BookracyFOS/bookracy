import { toast } from "sonner";

export interface ShareTarget {
  url: string;
  title?: string;
  text?: string;
}

/**
 * Hand a link to the OS share sheet, falling back to the clipboard where there isn't
 * one (most desktop browsers). Dismissing the sheet is a deliberate "never mind", so
 * it resolves quietly instead of silently copying something the user backed out of.
 */
export async function shareLink({ url, title, text }: ShareTarget) {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ url, title, text });
      return;
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") return;
      // Anything else (share unsupported for this payload, permission policy, …)
      // falls through to the clipboard.
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard.");
  } catch {
    toast.error("Couldn't copy the link.");
  }
}
