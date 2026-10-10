import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const thb = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 });
const thbCompact = new Intl.NumberFormat("th-TH", { notation: "compact", maximumFractionDigits: 1 });
const num = new Intl.NumberFormat("th-TH");

export const formatTHB = (v: number) => thb.format(v);
export const formatCompact = (v: number) => thbCompact.format(v);
export const formatNumber = (v: number) => num.format(v);

/** Percentage change, or null when there is no baseline to compare with. */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function formatRelativeTime(iso: string) {
  const diffSec = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("th", { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(Math.round(diffSec), "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  return rtf.format(Math.round(diffSec / 86400), "day");
}

export function initials(name: string) {
  const parts = name.replace(/\(.*?\)/g, "").trim().split(/\s+/);
  return parts.slice(0, 2).map((p) => p[0]).join("").toUpperCase();
}

const thb2 = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Currency with satang, for prices, bills and receipts. */
export const formatMoney = (v: number) => thb2.format(v);

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Today as YYYY-MM-DD in the browser's local timezone. */
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** First and last day (YYYY-MM-DD) of the month `offset` months from now. */
export function monthRange(offset = 0) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: f(first), to: f(last) };
}

/** Thai long date, e.g. 10 ตุลาคม 2569 */
export const formatThaiDate = (ymd: string) =>
  new Date(`${ymd}T00:00:00`).toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" });
