/* Diagnostics are off by default: the converter used to print one line per manifest
   item, which drowned the consumer's console on every conversion. Pass
   `{ debug: true }` to convertEpubToPdf to see them. Real problems still warn. */
let enabled = false;

export const setDebug = (on: boolean): void => {
  enabled = on;
};

export const debug = (...args: unknown[]): void => {
  // eslint-disable-next-line no-console
  if (enabled) console.log(...args);
};

export const warn = (...args: unknown[]): void => {
  console.warn(...args);
};
