/**
 * Playful, title-aware status messages shown while a book is being fetched /
 * converted. Keeps long downloads feeling alive instead of a silent spinner.
 */

const truncate = (title: string, max = 42) => {
  const clean = title?.trim() || "this book";
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

const DOWNLOAD_TEMPLATES = [
  (t: string) => `Summoning “${t}” from the archives…`,
  (t: string) => `Downloading the “${t}” lore…`,
  (t: string) => `Unshelving “${t}”…`,
  (t: string) => `Sneaking “${t}” past the publishers…`,
  (t: string) => `Teleporting “${t}” to your device…`,
  (t: string) => `Gathering every page of “${t}”…`,
  (t: string) => `Decrypting the secrets of “${t}”…`,
  (t: string) => `Loading “${t}” into your library…`,
];

const READY_TEMPLATES = [
  (t: string) => `“${t}” has landed. Happy reading!`,
  (t: string) => `“${t}” is ready — enjoy the lore.`,
  (t: string) => `Got it! “${t}” is yours now.`,
  (t: string) => `“${t}” delivered. Knowledge is free.`,
];

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export const funDownloadMessage = (title: string) => pick(DOWNLOAD_TEMPLATES)(truncate(title));

export const funReadyMessage = (title: string) => pick(READY_TEMPLATES)(truncate(title));

/** Short rotating captions for cover-art that is still loading in. */
const COVER_LOADING_CAPTIONS = ["Dusting off the cover…", "Polishing the spine…", "Fetching the art…", "Unwrapping…"];

export const funCoverCaption = () => pick(COVER_LOADING_CAPTIONS);

/**
 * Playful one-liners shown under the progress bar while a big EPUB is being
 * parsed. They rotate every few seconds so a long parse keeps feeling alive.
 */
const READER_PARSING_MESSAGES = [
  "Counting all the pages so you don't have to…",
  "Teaching the words to line up nicely…",
  "Untangling chapters and footnotes…",
  "Smoothing out every paragraph…",
  "Building your table of contents…",
  "Warming up the bookmark engine…",
  "Almost there — big books take big effort…",
  "Convincing the index to behave…",
  "Laying out pages just for you…",
  "Brewing some coffee for the parser…",
];

/** A rotating, non-repeating-ish parsing message keyed by an incrementing index. */
export const parsingMessageAt = (index: number) => READER_PARSING_MESSAGES[index % READER_PARSING_MESSAGES.length];
