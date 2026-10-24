"use client";

import { useSyncExternalStore } from "react";
import { ApiError, api } from "@/lib/api";
import { idbAll, idbDelete, idbGet, idbPut } from "@/lib/offline-db";
import type { CatalogItem, PosOrder } from "@/lib/types";

/** A cash bill sold while the internet was down, waiting to be sent. */
export interface OfflineBill {
  clientRef: string;
  userId: number;
  userName: string;
  soldAt: string;
  items: { productId: number; unitId?: number | null; quantity: number; unitPrice?: number; name?: string }[];
  payments: { method: "cash"; amount: number }[];
  ageConfirmed?: boolean;
  /** what the till charged: a different total after sending is reported */
  expectedTotal: number;
  /** for the list on screen */
  summary: { orderNo: string; total: number; units: number };
  status: "queued" | "failed";
  error?: string;
}

/* ------------------------------------------------------------- product list */

const CATALOG_KEY = "all";
let memoryCatalog: CatalogItem[] | null = null;

export async function saveCatalog(items: CatalogItem[]) {
  memoryCatalog = items;
  try {
    await idbPut("catalog", { items, savedAt: Date.now() }, CATALOG_KEY);
  } catch {
    /* storage blocked: offline scanning then works only until this page is closed */
  }
}

async function loadCatalog(): Promise<CatalogItem[]> {
  if (memoryCatalog) return memoryCatalog;
  try {
    memoryCatalog = (await idbGet<{ items: CatalogItem[] }>("catalog", CATALOG_KEY))?.items ?? [];
  } catch {
    memoryCatalog = [];
  }
  return memoryCatalog;
}

/** A scanned code (barcode / code) or typed name against the saved product list. */
export async function offlineLookup(code: string): Promise<CatalogItem | null> {
  const list = await loadCatalog();
  const c = code.trim().toLowerCase();
  if (!c) return null;
  const exact = list.find((i) => i.barcode?.toLowerCase() === c || i.sku.toLowerCase() === c);
  if (exact) return exact;
  const byName = list.filter((i) => i.name.toLowerCase().includes(c));
  return byName.length === 1 ? byName[0] : null;
}

/* -------------------------------------------------------------------- queue */

let bills: OfflineBill[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    bills = (await idbAll<OfflineBill>("queue")).sort((a, b) => a.soldAt.localeCompare(b.soldAt));
  } catch {
    bills = [];
  }
  emit();
}
if (typeof window !== "undefined") void ensureLoaded();

export const useOfflineBills = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => bills,
    () => [] as OfflineBill[],
  );

export async function enqueueBill(bill: OfflineBill) {
  await ensureLoaded();
  bills = [...bills, bill];
  emit();
  try {
    await idbPut("queue", bill);
  } catch {
    // the bill is only in memory now: tell the cashier so the receipt is kept
    throw new Error("เครื่องนี้บันทึกบิลออฟไลน์ลงเบราว์เซอร์ไม่ได้ — เก็บใบเสร็จไว้และอย่าปิดหน้านี้จนกว่าจะส่งบิล");
  }
}

async function update(clientRef: string, patch: Partial<OfflineBill>) {
  bills = bills.map((b) => (b.clientRef === clientRef ? { ...b, ...patch } : b));
  emit();
  const row = bills.find((b) => b.clientRef === clientRef);
  if (row) await idbPut("queue", row).catch(() => undefined);
}

export async function removeBill(clientRef: string) {
  bills = bills.filter((b) => b.clientRef !== clientRef);
  emit();
  await idbDelete("queue", clientRef).catch(() => undefined);
}

export async function retryBill(clientRef: string) {
  await update(clientRef, { status: "queued", error: undefined });
}

let syncing = false;

export interface SyncResult {
  sent: number;
  failed: number;
  changed: { orderNo: string; charged: number; recorded: number }[];
}

/**
 * Sends this user's queued bills one by one, oldest first. A lost connection or a server hiccup stops
 * the run (the bill stays queued and goes next time); a bill the server refuses is marked failed with
 * the reason so a manager can look at it.
 */
export async function syncBills(userId: number): Promise<SyncResult> {
  const result: SyncResult = { sent: 0, failed: 0, changed: [] };
  if (syncing) return result;
  syncing = true;
  try {
    await ensureLoaded();
    for (const b of bills.filter((x) => x.userId === userId && x.status === "queued")) {
      try {
        const r = await api.post<PosOrder & { mismatch: { charged: number; recorded: number } | null }>("/pos/checkout", {
          clientRef: b.clientRef,
          soldAt: b.soldAt,
          items: b.items,
          payments: b.payments,
          ageConfirmed: b.ageConfirmed,
          expectedTotal: b.expectedTotal,
        });
        await removeBill(b.clientRef);
        result.sent++;
        if (r.mismatch) result.changed.push({ orderNo: r.orderNo, ...r.mismatch });
      } catch (err) {
        if (!(err instanceof ApiError) || err.status === 0 || err.status >= 500 || err.status === 401) break; // try again later
        // "open a shift first" is not the bill's fault: wait for the shift
        if (err.status === 409 && /เปิดกะ/.test(err.message)) break;
        await update(b.clientRef, { status: "failed", error: err.message });
        result.failed++;
      }
    }
  } finally {
    syncing = false;
  }
  return result;
}
