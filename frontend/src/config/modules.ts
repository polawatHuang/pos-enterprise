import type { ModuleSpec } from "@/components/layout/module-placeholder";

export const modules: Record<string, ModuleSpec> = {
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
      "AI (MiniMax) เขียนสคริปต์รีวิวจากข้อมูลสินค้า (hook–ปัญหา–ทางแก้–CTA)",
      "เสียงพากย์ด้วย MiniMax Speech (สำรอง: ElevenLabs) พร้อม timestamp",
      "ภาพ/วิดีโอด้วย MiniMax Hailuo หรือ AI avatar รีวิวด้วย HeyGen",
      "ประกอบคลิป + ซับ + เพลง ด้วย Shotstack (เรนเดอร์บนคลาวด์)",
      "เก็บไฟล์บน R2 และส่งต่อไปตั้งเวลาโพสต์",
    ],
    keys: ["MiniMax API (ค่าเริ่มต้น)", "ElevenLabs / HeyGen (ทางเลือก)", "Shotstack", "Cloudflare R2"],
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
};
