import { ofetch } from "ofetch";
import { useSettingsStore } from "@/stores/settings";

// Account sync lives outside the generic `client` because it needs a per-call
// bearer header (the account key) and talks to /api/account directly.
const accountUrl = () => `${useSettingsStore.getState().backendURL}/api/account`;

/** Create a fresh cloud account and return its key (the user's only credential). */
export async function createAccount(turnstileToken?: string): Promise<string> {
  const res = await ofetch<{ id: string }>(accountUrl(), { method: "POST", body: turnstileToken ? { token: turnstileToken } : undefined });
  return res.id;
}

/** Fetch the stored blob for an account. Returns null when the account is empty/unknown. */
export async function pullAccount(id: string): Promise<unknown | null> {
  try {
    return await ofetch(accountUrl(), { headers: { Authorization: `Bearer ${id}` } });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && (error as { status?: number }).status === 404) return null;
    throw error;
  }
}

// Browsers cap keepalive request bodies at 64 KiB; a bigger payload is sent normally
// and may be cancelled with the page — better than a request that is refused outright.
const KEEPALIVE_MAX_BYTES = 60_000;

/** Overwrite the stored blob for an account with the given payload. */
export async function pushAccount(id: string, payload: unknown, opts: { keepalive?: boolean } = {}): Promise<void> {
  const body = JSON.stringify(payload);
  await ofetch(accountUrl(), {
    method: "PUT",
    headers: { Authorization: `Bearer ${id}`, "Content-Type": "application/json" },
    body,
    keepalive: Boolean(opts.keepalive) && body.length <= KEEPALIVE_MAX_BYTES,
  });
}

/** Permanently delete the cloud copy for an account. 404 is treated as already-gone. */
export async function deleteAccount(id: string): Promise<void> {
  try {
    await ofetch(accountUrl(), { method: "DELETE", headers: { Authorization: `Bearer ${id}` } });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && (error as { status?: number }).status === 404) return;
    throw error;
  }
}
