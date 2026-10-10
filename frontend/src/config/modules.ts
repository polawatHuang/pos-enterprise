import type { ModuleSpec } from "@/components/layout/module-placeholder";

export const modules: Record<string, ModuleSpec> = {
  accounting: {
    href: "/accounting",
    description: "รายรับรายจ่าย เอกสารทางบัญชี และแบบภาษี ครบในระบบเดียว พร้อม AI ช่วยลงบัญชี",
    features: [
      "บันทึกรายรับ–รายจ่าย ผูกผังบัญชี",
      "ใบเสนอราคา / ใบแจ้งหนี้ / ใบกำกับภาษี / ใบเสร็จ / ใบลดหนี้",
      "หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)",
      "ร่างแบบ ภ.พ.30, ภ.ง.ด.3/53 อัตโนมัติจากข้อมูลในระบบ",
      "AI อ่านใบเสร็จ (OCR) แล้วลงบัญชีให้",
      "สรุปงบกำไรขาดทุนรายเดือน",
    ],
    keys: ["Anthropic Claude API (AI อ่านใบเสร็จ)", "Cloudflare R2 (เก็บไฟล์เอกสาร)"],
    notes: ["เอกสารภาษีที่ระบบสร้างเป็นร่างเพื่อช่วยงาน ควรให้นักบัญชีตรวจทานก่อนยื่นจริง"],
  },
  inbox: {
    href: "/inbox",
    description: "รวมแชตลูกค้าทุกช่องทาง ให้ AI คุยปิดการขาย และดูแลการคืนสินค้า/ข้อร้องเรียน",
    features: [
      "Facebook Messenger, Instagram, LINE OA, Shopee, TikTok Shop ในหน้าเดียว",
      "AI ตอบเป็นธรรมชาติ รู้จักสินค้าทุกตัวจากฐานความรู้",
      "AI สร้างออร์เดอร์/คูปองได้เอง ภายใต้เพดานส่วนลดที่กำหนด",
      "Return & Dispute: AI เสนอทางแก้หรือส่วนลดเพื่อรักษาลูกค้า",
      "ส่งต่อให้แอดมินอัตโนมัติเมื่อเจอคำสำคัญหรือลูกค้าไม่พอใจ",
      "ประวัติลูกค้าและออร์เดอร์ข้างหน้าต่างแชต",
    ],
    keys: ["Anthropic Claude API", "Meta App (Messenger/Instagram)", "LINE Messaging API", "Shopee / TikTok Shop (แชตร้าน)"],
    notes: ["Meta อนุญาตให้ตอบได้ภายใน 24 ชั่วโมงหลังข้อความล่าสุดของลูกค้าเท่านั้น (นอกเวลาต้องใช้ message tag ที่ถูกต้อง)"],
  },
  trends: {
    href: "/trends",
    description: "ดึงข้อมูลสินค้าขายดีและค่าคอมมิชชันสูง เพื่อเลือกสินค้ามาทำคอนเทนต์",
    features: [
      "Shopee Affiliate API: สินค้าค่าคอมสูง/ขายดี",
      "TikTok Shop API: สินค้าและยอดขายของร้าน",
      "ตั้งเวลาดึงข้อมูลอัตโนมัติผ่านคิวงาน",
      "คะแนนเทรนด์ + กดสร้างวิดีโอจากสินค้าได้ทันที",
    ],
    keys: ["Shopee Affiliate Open API", "TikTok Shop Partner API", "Apify (ทางเลือกสำรอง)"],
    notes: ["การ scrape หน้าเว็บ Shopee/TikTok โดยตรงขัดกับข้อกำหนดการใช้งาน ระบบจึงใช้ API ทางการเป็นหลัก"],
  },
  videos: {
    href: "/videos",
    description: "สร้างคลิปแนวตั้ง 9:16 ที่มี AI คนรีวิวสินค้า เสียงพากย์ไทย และซับไตเติลอัตโนมัติ",
    features: [
      "AI เขียนสคริปต์รีวิวจากข้อมูลสินค้า (hook–ปัญหา–ทางแก้–CTA)",
      "เสียงพากย์ไทยด้วย ElevenLabs พร้อม timestamp",
      "AI avatar รีวิวด้วย HeyGen",
      "ประกอบคลิป + ซับ + เพลง ด้วย Shotstack (เรนเดอร์บนคลาวด์)",
      "เก็บไฟล์บน R2 และส่งต่อไปตั้งเวลาโพสต์",
    ],
    keys: ["Anthropic Claude API", "ElevenLabs", "HeyGen", "Shotstack", "Cloudflare R2"],
    notes: ["เซิร์ฟเวอร์ Plesk ไม่เหมาะกับการเรนเดอร์วิดีโอ งานทั้งหมดจึงส่งไปประมวลผลที่บริการคลาวด์แล้วรับผลกลับผ่านคิวงาน"],
  },
  social: {
    href: "/social",
    description: "ตั้งเวลาโพสต์คลิปลง TikTok / Facebook / Instagram พร้อมแนบลิงก์ Shopee Affiliate อัตโนมัติ",
    features: [
      "ปฏิทินโพสต์ ลากวางเปลี่ยนเวลาได้",
      "TikTok Content Posting API (Direct Post)",
      "Facebook Reels / Instagram Reels ผ่าน Meta Graph API",
      "สร้าง Shopee affiliate short link + sub_id แยกต่อโพสต์",
      "ติดป้ายเนื้อหา AI-generated ตามนโยบายแพลตฟอร์ม",
      "ดึงยอดวิว/ไลก์/คลิกกลับมาแสดงใน Dashboard",
    ],
    keys: ["TikTok for Developers (Content Posting API)", "Meta App", "Shopee Affiliate Open API", "Cloudflare R2"],
    notes: ["แอป TikTok ต้องผ่าน audit ก่อน จึงจะโพสต์แบบสาธารณะได้ (ก่อนผ่าน audit โพสต์ได้แค่ส่วนตัว)"],
  },
  reports: {
    href: "/settings/reports",
    description: "รายงานเชิงลึกและ audit log",
    features: ["รายงานยอดขายตามสินค้า/ช่องทาง/พนักงาน", "ส่งออก Excel/PDF", "Audit log ทุกการเปลี่ยนแปลง"],
    keys: [],
  },
};
