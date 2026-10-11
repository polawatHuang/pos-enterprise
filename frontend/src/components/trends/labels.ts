import type { ChecklistStatus, LifecyclePhase, SourcePlatform, TrendStatus } from "@/lib/types";

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
  { value: "pick", label: "เหมาะทำนายหน้า" },
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
  { key: "categoryRank", label: "อันดับในหมวด" },
  { key: "monthlySold", label: "ขายเดือนที่แล้ว" },
  { key: "prevMonthlySold", label: "ขายเดือนก่อนหน้า" },
  { key: "reviewCount", label: "จำนวนรีวิว" },
  { key: "mediaReviewCount", label: "รีวิวรูป/วิดีโอ" },
  { key: "positiveReviewPct", label: "รีวิวเชิงบวก (%)" },
  { key: "shopRating", label: "คะแนนร้าน" },
  { key: "shopResponseRate", label: "อัตราตอบกลับ (%)" },
  { key: "shopShip48Rate", label: "จัดส่งใน 48 ชม. (%)" },
  { key: "hasFlashSale", label: "แฟลชเซล (มี/ไม่มี)" },
];

/** Lifecycle phases (book: 1–5 rising, A peak, B–E declining; 3 is the sweet spot, 2–4 acceptable). */
export const PHASES: LifecyclePhase[] = ["1", "2", "3", "4", "5", "A", "B", "C", "D", "E"];
export const PHASE_META: Record<LifecyclePhase, { label: string; hint: string; tone: Tone }> = {
  "1": { label: "เริ่มมีคนซื้อ", hint: "ยังเร็วไป ความต้องการยังน้อย", tone: "neutral" },
  "2": { label: "ขาขึ้น", hint: "เริ่มเป็นกระแส รับได้", tone: "primary" },
  "3": { label: "จังหวะดีที่สุด", hint: "ความต้องการกำลังโต คนทำคลิปยังไม่เยอะ", tone: "success" },
  "4": { label: "ใกล้พีก", hint: "ยังทำได้ แต่ต้องเร็ว", tone: "primary" },
  "5": { label: "เกือบอิ่มตัว", hint: "คู่แข่งเยอะแล้ว", tone: "warning" },
  A: { label: "จุดสูงสุด", hint: "ตลาดอิ่มตัว", tone: "warning" },
  B: { label: "เริ่มขาลง", hint: "ความต้องการเริ่มลด", tone: "danger" },
  C: { label: "ขาลง", hint: "ความต้องการลดชัดเจน", tone: "danger" },
  D: { label: "ขาลงหนัก", hint: "ไม่แนะนำ", tone: "danger" },
  E: { label: "หมดกระแส", hint: "ไม่แนะนำ", tone: "danger" },
};
export const phaseLabel = (p: LifecyclePhase) => `Phase ${p} · ${PHASE_META[p].label}`;

export const CHECK_STATUS: Record<ChecklistStatus, { label: string; tone: Tone }> = {
  pass: { label: "ผ่าน", tone: "success" },
  partial: { label: "พอใช้", tone: "warning" },
  fail: { label: "ไม่ผ่าน", tone: "danger" },
  unknown: { label: "ยังไม่มีข้อมูล", tone: "neutral" },
};

export const PHASE_FILTERS = [
  { value: "all", label: "ทุก Phase" },
  { value: "2-4", label: "เฉพาะ Phase 2–4" },
  { value: "rising", label: "ขาขึ้น (1–5)" },
  { value: "declining", label: "ขาลง (B–E)" },
] as const;

/** Score → tone for the badge (status-like meaning, shown with the number, never color alone). */
export const scoreTone = (s: number | null): Tone => (s == null ? "neutral" : s >= 80 ? "success" : s >= 60 ? "primary" : s >= 40 ? "warning" : "neutral");
