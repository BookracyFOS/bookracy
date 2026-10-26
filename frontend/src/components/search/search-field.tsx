import { useRef, type ComponentProps, type ReactNode } from "react";
import { toast } from "sonner";
import { Mic, SearchIcon, Share2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { shareLink, type ShareTarget } from "@/lib/share";

const VOICE_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access is blocked — allow it in your browser settings to search by voice.",
  "service-not-allowed": "Microphone access is blocked — allow it in your browser settings to search by voice.",
  "audio-capture": "No microphone found.",
  "no-speech": "Didn't catch that. Try again.",
  network: "Voice search needs an internet connection.",
};

// The input's right padding has to clear whichever buttons are currently showing,
// indexed by how many that is. Text is left-aligned, so the padding changing as
// buttons appear never moves anything the user can see.
const PADDING_FOR_ACTIONS = ["", "pr-12", "pr-[5.25rem]", "pr-[7.5rem]"];

export interface SearchFieldProps extends Omit<ComponentProps<"input">, "value" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
  /** When set, a share button appears as soon as there's a query worth sharing. */
  share?: ShareTarget | null;
  icon?: ReactNode;
}

/**
 * The app's search box: a plain text input plus the three things every search bar
 * here should offer — clear it, dictate into it, share it.
 *
 * Voice input appends to whatever is already typed rather than replacing it, and the
 * mic is only rendered on engines that actually implement speech recognition.
 */
export function SearchField({ value, onChange, share, icon, className, ...inputProps }: SearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // What was in the box when dictation started — interim results keep rewriting the
  // tail of the query, so the typed prefix has to be held separately.
  const dictationBase = useRef("");

  const voice = useSpeechRecognition({
    onTranscript: (transcript) => onChange(dictationBase.current ? `${dictationBase.current} ${transcript}` : transcript),
    onError: (code) => toast.error(VOICE_ERRORS[code] ?? "Voice search stopped unexpectedly."),
  });

  const showClear = value.length > 0;
  const showShare = Boolean(share) && value.trim().length > 0;
  const actionCount = Number(showClear) + Number(voice.supported) + Number(showShare);

  const clear = () => {
    onChange("");
    inputRef.current?.focus();
  };

  const toggleVoice = () => {
    if (voice.listening) {
      voice.stop();
      return;
    }
    dictationBase.current = value.trim();
    voice.start();
    inputRef.current?.focus();
  };

  const actionClass =
    "text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none";

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        aria-label="Search"
        iconLeft={icon ?? <SearchIcon className="h-5 w-5" />}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(className, PADDING_FOR_ACTIONS[actionCount])}
        {...inputProps}
      />

      {actionCount > 0 && (
        <div className="absolute top-1/2 right-2 z-10 flex -translate-y-1/2 items-center gap-1">
          {showClear && (
            <button type="button" onClick={clear} aria-label="Clear search" title="Clear search" className={actionClass}>
              <X className="h-4 w-4" />
            </button>
          )}

          {voice.supported && (
            <button
              type="button"
              onClick={toggleVoice}
              aria-label={voice.listening ? "Stop voice search" : "Search by voice"}
              aria-pressed={voice.listening}
              title={voice.listening ? "Stop listening" : "Search by voice"}
              className={cn(actionClass, voice.listening && "bg-primary/15 text-primary hover:text-primary animate-pulse")}
            >
              <Mic className="h-4 w-4" />
            </button>
          )}

          {showShare && share && (
            <button type="button" onClick={() => shareLink(share)} aria-label="Share this search" title="Share this search" className={actionClass}>
              <Share2 className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
