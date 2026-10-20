import { useSyncExternalStore } from "react";

/** Pinned "favourite" products for this till (per device, like a 7-Eleven hot-key board). */
const KEY = "pos.favorites";
const listeners = new Set<() => void>();
let cache: number[] | null = null;
const EMPTY: number[] = [];

function read(): number[] {
  if (cache) return cache;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    cache = Array.isArray(v) ? v.filter((n) => Number.isInteger(n)) : [];
  } catch {
    cache = [];
  }
  return cache;
}

export function toggleFavorite(id: number) {
  const cur = read();
  cache = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-48);
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // private mode: keep the in-memory list for this session
  }
  listeners.forEach((l) => l());
}

export function useFavorites(): number[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => EMPTY,
  );
}
