import type { ModuleSpec } from "@/components/layout/module-placeholder";

export const modules: Record<string, ModuleSpec> = {
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
