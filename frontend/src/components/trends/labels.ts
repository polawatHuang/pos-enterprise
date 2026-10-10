import type { SourcePlatform, TrendStatus } from "@/lib/types";

type Tone = "neutral" | "primary" | "success" | "danger" | "warning";

export const TREND_PLATFORM: Record<string, { label: string; className: string }> = {
  shopee: { label: "Shopee", className: "bg-[#EE4D2D] text-white" },
  tiktok_shop: { label: "TikTok Shop", className: "bg-black text-white dark:bg-white dark:text-black" },
  lazada: { label: "Lazada", className: "bg-[#0F146D] text-white" },
  other: { label: "อื่นๆ", className: "bg-slate-500 text-white" },
};
export const platformMeta = (p: string) => TREND_PLATFORM[p] ?? { label: p, className: "bg-slate-500 text-white" };

export const TREND_STATUS: Record<TrendStatus, { label: string; tone: Tone }> = {
  new: { label: "ใหม่", tone: "primary" },
  watching: { label: "กำลังติดตาม", tone: "warning" },
  imported: { label: "นำเข้าแล้ว", tone: "success" },
  ignored: { label: "ไม่สนใจ", tone: "neutral" },
};

export const SOURCE_PLATFORM: Record<SourcePlatform, { label: string; method: string; hint: string }> = {
  shopee_affiliate: {
    label: "Shopee Affiliate API",
    method: "API ทางการ",
    hint: "สินค้าขายดี/ค่าคอมสูงทั้งตลาด ต้องเป็น Shopee Affiliate ที่ได้สิทธิ์ Open API",
  },
  apify: { label: "Apify actor", method: "บริการ scraping", hint: "รัน actor บน Apify สำหรับเว็บที่อนุญาตให้ดึงข้อมูล" },
  custom_url: { label: "หน้าเว็บ (JSON-LD)", method: "อ่านหน้าเว็บ", hint: "อ่านข้อมูล schema.org Product จากหน้าเว็บที่อนุญาต (เคารพ robots.txt)" },
  tiktok_shop: { label: "TikTok Shop", method: "API ทางการ", hint: "API ให้ข้อมูลเฉพาะร้านตัวเอง ใช้นำเข้า CSV แทน" },
  shopee: { label: "Shopee Open Platform", method: "API ทางการ", hint: "API ให้ข้อมูลเฉพาะร้านตัวเอง" },
};

export const SORT_OPTIONS = [
  { value: "score", label: "คะแนนเทรนด์" },
  { value: "velocity", label: "ขายเร็ว (ชิ้น/วัน)" },
  { value: "sold", label: "ยอดขายรวม" },
  { value: "commission", label: "ค่าคอมสูง" },
  { value: "price", label: "ราคาต่ำ" },
  { value: "newest", label: "เจอล่าสุด" },
] as const;

export const CSV_FIELDS: { key: string; label: string }[] = [
  { key: "title", label: "ชื่อสินค้า *" },
  { key: "externalId", label: "รหัสสินค้า" },
  { key: "price", label: "ราคา" },
  { key: "soldCount", label: "ยอดขาย" },
  { key: "commissionRate", label: "ค่าคอม (%)" },
  { key: "rating", label: "คะแนนรีวิว" },
  { key: "shopName", label: "ร้าน" },
  { key: "url", label: "ลิงก์" },
  { key: "imageUrl", label: "รูป" },
  { key: "category", label: "หมวดหมู่" },
];

/** Score → tone for the badge (status-like meaning, shown with the number, never color alone). */
export const scoreTone = (s: number | null): Tone => (s == null ? "neutral" : s >= 80 ? "success" : s >= 60 ? "primary" : s >= 40 ? "warning" : "neutral");
