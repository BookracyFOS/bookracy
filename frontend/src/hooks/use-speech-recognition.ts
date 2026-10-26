import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Speech-to-text on top of the browser's own Web Speech API — no dependency needed,
 * because every engine that can do this at all already exposes it: Chrome/Edge/Opera
 * as `SpeechRecognition`, Safari (macOS 14.1+, iOS 14.5+) behind the `webkit` prefix.
 * Firefox keeps it off by default, so `supported` is false there and callers hide the
 * mic entirely rather than offer a button that can't work.
 *
 * Recognition requires a secure context (https, or localhost in dev) and, in most
 * implementations, a network round-trip to the vendor's speech service.
 */

// TypeScript's DOM lib ships the *result* half of the API but not the recognizer, and
// nothing at all for the webkit-prefixed constructor, so the surface we touch is
// declared here.
interface SpeechRecognitionLikeEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionLikeEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

interface Options {
  /** Fires on every update, interim included, with the whole utterance so far. */
  onTranscript: (transcript: string, isFinal: boolean) => void;
  onError?: (code: string) => void;
  /** BCP 47 tag. Defaults to the browser's UI language. */
  lang?: string;
}

export function useSpeechRecognition({ onTranscript, onError, lang }: Options) {
  const [supported] = useState(() => Boolean(recognitionCtor()));
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Callbacks are read through a ref so a re-render mid-dictation never has to tear
  // down and rebuild a live recognizer.
  const handlers = useRef({ onTranscript, onError });
  handlers.current = { onTranscript, onError };

  const start = useCallback(() => {
    if (recognitionRef.current) return;
    const Recognition = recognitionCtor();
    if (!Recognition) return;

    const recognition = new Recognition();
    recognition.lang = lang || (typeof navigator !== "undefined" ? navigator.language : "") || "en-US";
    // One utterance at a time: the mic switches itself off when the user stops
    // talking, which is what people expect from a search box.
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let transcript = "";
      let isFinal = false;
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        transcript += result[0]?.transcript ?? "";
        isFinal = result.isFinal;
      }
      handlers.current.onTranscript(transcript.trim(), isFinal);
    };
    recognition.onerror = (event) => {
      // "aborted" is what we get back when we stopped it ourselves.
      if (event.error !== "aborted") handlers.current.onError?.(event.error);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };

    try {
      recognition.start();
    } catch {
      handlers.current.onError?.("start-failed");
      return;
    }
    recognitionRef.current = recognition;
    setListening(true);
  }, [lang]);

  const stop = useCallback(() => recognitionRef.current?.stop(), []);

  // A recognizer left running after its component unmounts keeps the mic hot.
  useEffect(() => () => recognitionRef.current?.abort(), []);

  return { supported, listening, start, stop };
}
