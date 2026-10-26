// Opt-in cloud sync: backs up the local stores (bookmarks, folders, reading
// progress, settings) to a no-password account keyed by a secret the user saves.
// Off by default; this just wires up the auto-push subscriptions + initial pull.
import { initCloudSync } from "./cloud";

initCloudSync();
