/** Thai labels for audit-log codes written by backend `audit(req, action, ...)` calls; unknown codes fall back to the raw value. */

export const ACTION_LABELS: Record<string, string> = {
  "auth.login": "เข้าสู่ระบบ",
  "auth.change_password": "เปลี่ยนรหัสผ่าน",
  "user.create": "เพิ่มผู้ใช้",
  "user.update": "แก้ไขผู้ใช้/สิทธิ์",
  "branch.create": "เพิ่มสาขา",
  "branch.update": "แก้ไขสาขา",
  "branch.delete": "ลบสาขา",
  "org.tax_update": "แก้ไขการตั้งค่าภาษี",
  "org.reset_data": "ล้างข้อมูลองค์กร",
  "integrations.config_update": "แก้ไขคีย์การเชื่อมต่อ API",
  "notify.settings": "ตั้งค่าการแจ้งเตือน",

  "pos.checkout": "ขายสินค้า (ชำระเงิน)",
  "pos.void": "ยกเลิกบิล",
  "pos.shift.open": "เปิดกะ",
  "pos.shift.close": "ปิดกะ",
  "pos.cash.pay_in": "นำเงินเข้าลิ้นชัก",
  "pos.cash.pay_out": "นำเงินออกจากลิ้นชัก",
  "pos.cash.pickup": "เก็บเงินออกจากลิ้นชัก",
  "pos.member.create": "สมัครสมาชิก",
  "pos.slip.verify": "ตรวจสลิปโอนเงิน",
  "pos.settings.update": "แก้ไขการตั้งค่า POS",

  "product.create": "เพิ่มสินค้า",
  "product.update": "แก้ไขสินค้า",
  "product.delete": "ลบสินค้า",
  "product.units": "แก้ไขหน่วยขาย",
  "category.create": "เพิ่มหมวดหมู่",
  "category.update": "แก้ไขหมวดหมู่",
  "category.delete": "ลบหมวดหมู่",

  "inventory.adjust": "ปรับสต๊อก",
  "inventory.levels": "ตั้งจุดสั่งซื้อ/สต๊อกสูงสุด",
  "inventory.receive": "รับสินค้าเข้าคลัง",
  "inventory.transfer": "โอนย้ายสต๊อก",
  "lot.markdown": "ลดราคาล็อตใกล้หมดอายุ",
  "lot.waste": "ตัดสต๊อกของเสีย",
  "stock_count.create": "สร้างใบตรวจนับ",
  "stock_count.submit": "ส่งผลตรวจนับ",
  "stock_count.approve": "อนุมัติผลตรวจนับ",
  "stock_count.cancel": "ยกเลิกใบตรวจนับ",
  "transfer.ship": "ส่งของโอนระหว่างสาขา",
  "transfer.receive": "รับของโอนระหว่างสาขา",
  "transfer.cancel": "ยกเลิกใบโอน",

  "po.create": "สร้างใบสั่งซื้อ",
  "po.send": "ส่งใบสั่งซื้อ",
  "po.receive": "รับของตามใบสั่งซื้อ",
  "po.cancel": "ยกเลิกใบสั่งซื้อ",
  "supplier.create": "เพิ่มผู้ขาย",
  "supplier.update": "แก้ไขผู้ขาย",
  "purchasing.ai_adjust": "AI ปรับจุดสั่งซื้อ",

  "transaction.create": "บันทึกรายรับ/รายจ่าย",
  "transaction.void": "ยกเลิกรายการบัญชี",
  "document.create": "สร้างเอกสาร",
  "document.issue": "ออกเอกสาร",
  "document.pay": "บันทึกรับ/จ่ายเงินเอกสาร",
  "document.void": "ยกเลิกเอกสาร",
  "document.wht_certificate": "ออกหนังสือรับรองหัก ณ ที่จ่าย",
  "tax.report.status": "อัปเดตสถานะแบบภาษี",
  "ai.extract_receipt": "AI อ่านใบเสร็จ",

  "inbox.reply": "ตอบแชตลูกค้า",
  "inbox.update": "แก้ไขสถานะแชต",
  "inbox.channel.create": "เพิ่มช่องทางแชต",
  "inbox.channel.update": "แก้ไขช่องทางแชต",
  "inbox.channel.connect": "เชื่อมเพจ Facebook/Instagram",
  "inbox.agent.update": "ตั้งค่า AI Agent",
  "offer.approve": "อนุมัติข้อเสนอ AI",
  "offer.decline": "ปฏิเสธข้อเสนอ AI",
  "return.update": "อัปเดตคำขอคืนสินค้า",
  "dispute.create": "เปิดข้อร้องเรียน",
  "dispute.update": "อัปเดตข้อร้องเรียน",

  "video.create": "สร้างโปรเจกต์วิดีโอ",
  "video.update": "แก้ไขวิดีโอ",
  "video.delete": "ลบวิดีโอ",
  "video.script": "สร้างสคริปต์วิดีโอ",
  "video.hook": "เลือก Hook วิดีโอ",
  "video.generate": "สั่งสร้างวิดีโอ AI",
  "video.compose": "ประกอบวิดีโอ",
  "video.clips_retry": "สร้างคลิปที่ล้มเหลวใหม่",
  "video.variant": "สร้างวิดีโอเวอร์ชันใหม่",
  "video.media.upload": "อัปโหลดสื่อวิดีโอ",
  "covers.create": "สร้างปกคลิป",
  "covers.regenerate": "สร้างภาพปกใหม่",
  "covers.save": "บันทึกปกคลิป",
  "covers.delete": "ลบปกคลิป",

  "social.connect": "เชื่อมบัญชีโซเชียล",
  "social.disconnect": "ยกเลิกเชื่อมบัญชีโซเชียล",
  "social.schedule": "ตั้งเวลาโพสต์",
  "social.update": "แก้ไขโพสต์",
  "social.cancel": "ยกเลิกโพสต์",
  "social.publish_now": "โพสต์ทันที",
  "social.affiliate_link": "สร้างลิงก์ Affiliate",

  "scraping.run": "สั่งดึงข้อมูลเทรนด์",
  "scraping.ai_search": "AI ค้นหาสินค้าเทรนด์",
  "scraping.analyze": "วิเคราะห์สินค้าเทรนด์",
  "scraping.import_csv": "นำเข้าเทรนด์จาก CSV",
  "scraping.import_product": "นำเทรนด์เข้าเป็นสินค้า",
  "scraping.trend.update": "แก้ไขสินค้าเทรนด์",
  "scraping.affiliate_link": "สร้างลิงก์ Affiliate จากเทรนด์",
  "scraping.benchmark.set": "ตั้งค่าเกณฑ์หมวดหมู่",
  "scraping.source.create": "เพิ่มแหล่งข้อมูลเทรนด์",
  "scraping.source.update": "แก้ไขแหล่งข้อมูลเทรนด์",
  "scraping.source.delete": "ลบแหล่งข้อมูลเทรนด์",
  "scraping.channel_profile.create": "สร้างโปรไฟล์ช่อง",
  "scraping.channel_profile.update": "แก้ไขโปรไฟล์ช่อง",
  "scraping.channel_profile.delete": "ลบโปรไฟล์ช่อง",
  "scraping.channel_profile.plan": "วางแผนคอนเทนต์ช่อง",
};

/** First segment of the action code (what the "module" filter matches). */
export const MODULE_LABELS: Record<string, string> = {
  auth: "เข้าสู่ระบบ",
  user: "ผู้ใช้",
  branch: "สาขา",
  org: "องค์กร",
  integrations: "การเชื่อมต่อ API",
  notify: "การแจ้งเตือน",
  pos: "ขายหน้าร้าน (POS)",
  product: "สินค้า",
  category: "หมวดหมู่สินค้า",
  inventory: "สต๊อก",
  lot: "ล็อตสินค้า",
  stock_count: "ตรวจนับสต๊อก",
  transfer: "โอนย้ายสาขา",
  po: "ใบสั่งซื้อ",
  supplier: "ผู้ขาย",
  purchasing: "จัดซื้อ",
  transaction: "รายรับ-รายจ่าย",
  document: "เอกสารบัญชี",
  tax: "ภาษี",
  ai: "AI บัญชี",
  inbox: "แชตลูกค้า",
  offer: "ข้อเสนอ AI",
  return: "คืนสินค้า",
  dispute: "ข้อร้องเรียน",
  video: "AI Video",
  covers: "AI ปกคลิป",
  social: "โซเชียล",
  scraping: "สินค้าเทรนด์",
};

export const ENTITY_LABELS: Record<string, string> = {
  user: "ผู้ใช้",
  branch: "สาขา",
  organization: "องค์กร",
  app_config: "คีย์ API",
  settings: "การตั้งค่า",
  product: "สินค้า",
  category: "หมวดหมู่",
  warehouse: "คลังสินค้า",
  stock_lot: "ล็อตสินค้า",
  stock_count: "ใบตรวจนับ",
  stock_transfer: "ใบโอนสินค้า",
  purchase_order: "ใบสั่งซื้อ",
  supplier: "ผู้ขาย",
  sales_order: "บิลขาย",
  pos_shift: "กะการขาย",
  payment_slip: "สลิปโอนเงิน",
  customer: "ลูกค้า",
  transaction: "รายการบัญชี",
  document: "เอกสาร",
  tax_report: "แบบภาษี",
  conversation: "แชต",
  channel: "ช่องทางแชต",
  ai_agent_profile: "AI Agent",
  ai_offer: "ข้อเสนอ AI",
  return: "คำขอคืนสินค้า",
  dispute: "ข้อร้องเรียน",
  video_project: "วิดีโอ",
  cover_project: "ปกคลิป",
  scheduled_post: "โพสต์",
  social_account: "บัญชีโซเชียล",
  affiliate_link: "ลิงก์ Affiliate",
  scrape_source: "แหล่งข้อมูลเทรนด์",
  trending_product: "สินค้าเทรนด์",
  trend_category_benchmark: "เกณฑ์หมวดหมู่",
  channel_profile: "โปรไฟล์ช่อง",
};

/** Friendlier names for common metadata keys (the raw key is still shown). */
export const METADATA_LABELS: Record<string, string> = {
  reason: "เหตุผล",
  total: "ยอดรวม",
  amount: "จำนวนเงิน",
  fields: "ฟิลด์ที่แก้ไข",
  items: "จำนวนรายการ",
  status: "สถานะ",
  name: "ชื่อ",
  sku: "SKU",
  platform: "แพลตฟอร์ม",
  roles: "บทบาท",
  methods: "วิธีชำระเงิน",
  method: "วิธีชำระเงิน",
  warehouseId: "คลัง",
  difference: "ส่วนต่าง",
  openingCash: "เงินทอนตั้งต้น",
  docType: "ประเภทเอกสาร",
  set: "ตั้งค่าแล้ว",
  reset: "ล้างค่า",
};

// Pages that show a single record; anything else is shown without a link.
const ENTITY_LINKS: Record<string, (id: string) => string> = {
  video_project: (id) => `/videos/${id}`,
  cover_project: (id) => `/covers/${id}`,
  conversation: (id) => `/inbox?c=${id}`,
  product: (id) => `/products/${id}`,
  purchase_order: (id) => `/purchasing/orders/${id}`,
  document: (id) => `/accounting/documents/${id}`,
  stock_count: (id) => `/inventory/counts/${id}`,
};

export function entityHref(type: string | null, id: string | null) {
  if (!type || !id || !/^\d+$/.test(id)) return null;
  return ENTITY_LINKS[type]?.(id) ?? null;
}

export const actionLabel = (action: string) => ACTION_LABELS[action] ?? action;
export const moduleLabel = (m: string) => MODULE_LABELS[m] ?? m;
export const entityLabel = (t: string) => ENTITY_LABELS[t] ?? t;

/** Badge colour from the verb at the end of the action code. */
export function actionTone(action: string): "danger" | "success" | "primary" | "warning" | "neutral" {
  const verb = action.split(".").pop() ?? "";
  if (/^(void|delete|cancel|reset_data|disconnect|decline|waste)$/.test(verb)) return "danger";
  if (/^(create|approve|connect|checkout|issue|open)$/.test(verb)) return "success";
  if (/^(update|settings|config_update|tax_update|levels|units|adjust)$/.test(verb)) return "primary";
  if (/^(login|change_password)$/.test(verb)) return "warning";
  return "neutral";
}
