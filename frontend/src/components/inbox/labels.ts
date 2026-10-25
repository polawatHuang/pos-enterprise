import type { Platform } from "@/lib/types";

type Tone = "neutral" | "primary" | "success" | "danger" | "warning";

export const PLATFORM: Record<Platform, { label: string; short: string; className: string }> = {
  facebook: { label: "Facebook Page", short: "FB", className: "bg-[#1877F2] text-white" },
  instagram: { label: "Instagram", short: "IG", className: "bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white" },
  line: { label: "LINE OA", short: "LINE", className: "bg-[#06C755] text-white" },
  tiktok: { label: "TikTok Shop", short: "TT", className: "bg-black text-white dark:bg-white dark:text-black" },
  shopee: { label: "Shopee", short: "SP", className: "bg-[#EE4D2D] text-white" },
  website: { label: "เว็บไซต์/ทดสอบ", short: "WEB", className: "bg-slate-500 text-white" },
  email: { label: "อีเมล", short: "MAIL", className: "bg-slate-500 text-white" },
};

export const CONV_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "เปิด", tone: "primary" },
  pending: { label: "รอดำเนินการ", tone: "warning" },
  resolved: { label: "ปิดเรื่องแล้ว", tone: "success" },
  closed: { label: "ปิด", tone: "neutral" },
};

export const INTENT_LABEL: Record<string, string> = {
  inquiry: "สอบถาม",
  purchase: "สนใจซื้อ",
  complaint: "ร้องเรียน",
  return: "คืน/เปลี่ยนสินค้า",
  tracking: "ติดตามพัสดุ",
  other: "อื่นๆ",
};

export const RETURN_STATUS: Record<string, { label: string; tone: Tone }> = {
  requested: { label: "รอตรวจสอบ", tone: "warning" },
  approved: { label: "อนุมัติแล้ว", tone: "primary" },
  received: { label: "ได้รับของคืน", tone: "primary" },
  completed: { label: "เสร็จสิ้น", tone: "success" },
  rejected: { label: "ปฏิเสธ", tone: "danger" },
};

export const RESOLUTION_LABEL: Record<string, string> = {
  pending: "ยังไม่สรุป",
  refund: "คืนเงิน",
  exchange: "เปลี่ยนสินค้า",
  discount: "ส่วนลด",
  store_credit: "เครดิตร้าน",
  rejected: "ไม่รับคืน",
};

export const DISPUTE_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "เปิด", tone: "warning" },
  negotiating: { label: "กำลังเจรจา", tone: "primary" },
  escalated: { label: "ยกระดับ", tone: "danger" },
  resolved: { label: "ยุติแล้ว", tone: "success" },
  lost: { label: "แพ้ข้อพิพาท", tone: "neutral" },
};

export const SEVERITY: Record<string, { label: string; tone: Tone }> = {
  low: { label: "ต่ำ", tone: "neutral" },
  medium: { label: "กลาง", tone: "warning" },
  high: { label: "สูง", tone: "danger" },
};

export const OFFER_STATUS: Record<string, { label: string; tone: Tone }> = {
  needs_approval: { label: "รออนุมัติ", tone: "warning" },
  proposed: { label: "AI เสนอแล้ว", tone: "primary" },
  accepted: { label: "อนุมัติ/ใช้แล้ว", tone: "success" },
  declined: { label: "ไม่อนุมัติ", tone: "danger" },
  expired: { label: "หมดอายุ", tone: "neutral" },
};

export const KNOWLEDGE_KIND: Record<string, string> = {
  policy: "นโยบาย",
  faq: "คำถามที่พบบ่อย",
  objection: "รับมือข้อโต้แย้ง",
  usage: "วิธีใช้",
  other: "อื่นๆ",
};

export const TOOL_LABEL: Record<string, string> = {
  search_products: "ค้นสินค้า",
  get_product_details: "ดูรายละเอียดสินค้า",
  lookup_orders: "เช็กออร์เดอร์",
  create_discount_code: "ออกโค้ดส่วนลด",
  open_return_request: "เปิดเรื่องคืนสินค้า",
  escalate_to_human: "ส่งต่อแอดมิน",
};

export const PROVIDER_LABEL: Record<string, string> = { minimax: "MiniMax", anthropic: "Claude" };
