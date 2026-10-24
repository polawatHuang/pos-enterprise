/**
 * Last good answers of the few API calls the till needs to open (who is signed in, the open shift,
 * shop settings), kept in localStorage so /pos still works after a reload while the internet is
 * down. Nothing secret is stored: the session itself stays in the httpOnly cookie.
 */
import { ApiError } from "./api";

const PREFIX = "pos.cache.";

/** No answer from our server at all (network down, or the proxy saying the backend is down). */
export const isNetworkDown = (err: unknown) => err instanceof ApiError && (err.status === 0 || (err.status >= 502 && err.status <= 504));

export function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage blocked or full: no offline copy */
  }
}

export function recall<T>(key: string): T | undefined {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v === null ? undefined : (JSON.parse(v) as T);
  } catch {
    return undefined;
  }
}

/** Signing out: the next person must not open the till as the last one. */
export function forgetAll() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {
    /* nothing kept */
  }
}

/** Runs `fn` and keeps its answer; when the server cannot be reached, answers with the kept one. */
export async function withOfflineCopy<T>(key: string, fn: () => Promise<T>): Promise<T> {
  try {
    const v = await fn();
    remember(key, v);
    return v;
  } catch (err) {
    if (isNetworkDown(err)) {
      const kept = recall<T>(key);
      if (kept !== undefined) return kept;
    }
    throw err;
  }
}
