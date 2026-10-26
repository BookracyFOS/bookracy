/* src/polyfills/node-globals.ts
   Minimal DOM globals so code that runs in Node
   can use Node.ELEMENT_NODE / TEXT_NODE safely.  */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const globalThis: any;

if (typeof globalThis.Node === 'undefined') {
  globalThis.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
}
