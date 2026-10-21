import type { CustomerSort } from "@/lib/types";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger";

export const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "รอชำระ", tone: "warning" },
  paid: { label: "ชำระแล้ว", tone: "success" },
  packed: { label: "แพ็กแล้ว", tone: "primary" },
  shipped: { label: "จัดส่งแล้ว", tone: "primary" },
  completed: { label: "สำเร็จ", tone: "success" },
  cancelled: { label: "ยกเลิก", tone: "danger" },
  refunded: { label: "คืนเงินแล้ว", tone: "danger" },
};

export const SORT_OPTIONS: { value: CustomerSort; label: string }[] = [
  { value: "recent", label: "ซื้อล่าสุด" },
  { value: "top", label: "ยอดซื้อสูงสุด" },
  { value: "orders", label: "ซื้อบ่อยที่สุด" },
  { value: "newest", label: "สมัครล่าสุด" },
  { value: "name", label: "ชื่อ ก–ฮ" },
];

const DAY = 86_400_000;

/**
 * A simple RFM-style label from purchase history, so staff can see at a glance who to look after.
 * Thresholds suit a retail shop: regulars buy 3+ times, "at risk" has not bought for 90 days.
 */
export function customerSegment(c: { orderCount: number; totalSpent: number; lastOrderAt: string | null }): { label: string; tone: Tone } | null {
  if (!c.orderCount || !c.lastOrderAt) return { label: "ยังไม่เคยซื้อ", tone: "neutral" };
  const idleDays = (Date.now() - new Date(c.lastOrderAt).getTime()) / DAY;
  if (idleDays > 90) return { label: "เสี่ยงหาย", tone: "danger" };
  if (c.orderCount >= 10 || c.totalSpent >= 20_000) return { label: "VIP", tone: "warning" };
  if (c.orderCount >= 3) return { label: "ลูกค้าประจำ", tone: "success" };
  if (c.orderCount === 1) return { label: "ซื้อครั้งแรก", tone: "primary" };
  return null;
}

/** "3 วันที่แล้ว" style, or a dash. */
export function daysAgoLabel(iso: string | null) {
  if (!iso) return "–";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
  if (days <= 0) return "วันนี้";
  if (days === 1) return "เมื่อวาน";
  if (days < 30) return `${days} วันที่แล้ว`;
  if (days < 365) return `${Math.floor(days / 30)} เดือนที่แล้ว`;
  return `${Math.floor(days / 365)} ปีที่แล้ว`;
}

/** 0812345678 -> 081-234-5678 (other formats are shown as stored). */
export function formatPhone(phone: string | null) {
  if (!phone) return null;
  const m = /^(0\d{1,2})(\d{3})(\d{4})$/.exec(phone);
  if (!m) return phone;
  return phone.length === 10 ? `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}` : `${m[1]}-${m[2]}-${m[3]}`;
}
