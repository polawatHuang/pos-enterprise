"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Autosave for an editor: `value` is saved (debounced) whenever it differs from `saved`, the copy the
 * server last confirmed. Compare normalised values (e.g. without empty lines) so a value the server
 * tidies up does not look unsaved forever. Every editor with unsaved changes is listed in a page-wide
 * registry, so actions that start AI work can call `flushDrafts()` first and never run on old text.
 */
export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

const drafts = new Set<() => Promise<boolean>>();

/** Save every editor that has unsaved changes (before generating, switching steps…); throws if one cannot be saved. */
export async function flushDrafts() {
  const ok = await Promise.all([...drafts].map((f) => f()));
  if (ok.includes(false)) throw new Error("บันทึกที่แก้ไว้ไม่สำเร็จ จึงยังไม่เริ่มงาน — ลองอีกครั้ง");
}

/** Whether any editor on the page still has unsaved changes. */
export const hasDrafts = () => drafts.size > 0;

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (!drafts.size) return;
    flushDrafts().catch(() => {});
    e.preventDefault();
  });
}

export function useAutosave<T>({
  value,
  saved,
  save,
  delay = 1200,
  enabled = true,
  onError,
}: {
  value: T;
  saved: T;
  save: (value: T) => Promise<unknown>;
  delay?: number;
  enabled?: boolean;
  onError?: (err: unknown) => void;
}) {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const key = JSON.stringify(value);
  const savedKey = JSON.stringify(saved);
  const latest = useRef({ value, key, save, onError, enabled });
  useEffect(() => {
    latest.current = { value, key, save, onError, enabled };
  });
  // what the server has (or is about to have, once a save in flight lands)
  const confirmed = useRef(savedKey);
  useEffect(() => {
    confirmed.current = savedKey;
  }, [savedKey]);
  const inflight = useRef<Promise<boolean> | null>(null);

  /** Save now if anything is unsaved; false when the save failed. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (inflight.current) await inflight.current;
    const { value: v, key: k, save: fn, enabled: on } = latest.current;
    if (!on || k === confirmed.current) return true;
    setStatus("saving");
    const run = (async () => {
      try {
        await fn(v);
        confirmed.current = k;
        setStatus("saved");
        return true;
      } catch (err) {
        setStatus("error");
        latest.current.onError?.(err);
        return false;
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, []);

  const dirty = enabled && key !== savedKey;
  useEffect(() => {
    if (!dirty) return;
    drafts.add(flush);
    const t = window.setTimeout(() => void flush(), delay);
    return () => {
      window.clearTimeout(t);
      drafts.delete(flush);
    };
  }, [dirty, key, delay, flush]);

  // leaving the editor (step change, dialog closed) saves what was typed
  useEffect(
    () => () => {
      if (latest.current.enabled && latest.current.key !== confirmed.current) void flush();
    },
    [flush],
  );

  // unsaved changes show as waiting (or saving); "error" stays until the next save works
  const shown: AutosaveStatus = dirty && status !== "saving" && status !== "error" ? "pending" : status;
  return { status: shown, dirty, flush };
}
