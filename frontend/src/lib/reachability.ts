"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the till can reach the server. The browser's own "online" flag is not enough (wifi up,
 * internet down; backend restarting), so a failed request also marks it unreachable, and while it
 * is unreachable the server's health check is tried every few seconds until it answers.
 */
let reachable = typeof navigator === "undefined" ? true : navigator.onLine;
const listeners = new Set<() => void>();
let probing = false;

function emit() {
  listeners.forEach((l) => l());
}

export function setReachable(value: boolean) {
  if (value === reachable) return;
  reachable = value;
  emit();
  if (!value) startProbe();
}

function startProbe() {
  if (probing || typeof window === "undefined") return;
  probing = true;
  const base = `${(process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "")}/api`;
  const tick = async () => {
    try {
      const res = await fetch(`${base}/health`, { cache: "no-store" });
      if (res.ok) setReachable(true);
    } catch {
      /* still down */
    }
    if (reachable) probing = false;
    else setTimeout(tick, 4000);
  };
  setTimeout(tick, 2000);
}

if (typeof window !== "undefined") {
  window.addEventListener("offline", () => setReachable(false));
  window.addEventListener("online", () => {
    // the browser says it is back: confirm with the server before trusting it
    probing = false;
    reachable = false;
    startProbe();
    emit();
  });
}

export const useOnline = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => reachable,
    () => true,
  );
