import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell, ProviderCard, Section } from "@/components/legal/legal-shell";
import { DataRequestForm } from "@/components/legal/data-request-form";

export const metadata: Metadata = {
  title: "คำขอลบข้อมูล",
  description: "วิธีขอลบข้อมูลส่วนบุคคลและใช้สิทธิของเจ้าของข้อมูล รวมถึงข้อมูลจาก Facebook, Instagram และ LINE",
  robots: { index: true, follow: true },
};

const link = "text-primary hover:underline";

export default function DataDeletionPage() {
  return (
    <LegalShell title="คำขอลบข้อมูลและการใช้สิทธิเจ้าของข้อมูล">
      <p>
        คุณขอให้ลบข้อมูลส่วนบุคคล ขอสำเนา ขอแก้ไข คัดค้าน หรือถอนความยินยอมได้ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562
        รวมถึงข้อมูลที่ร้านได้รับเมื่อคุณส่งข้อความผ่าน Facebook Page, Instagram หรือ LINE Official Account (ดู <Link href="/privacy" className={link}>นโยบายความเป็นส่วนตัว</Link>)
      </p>

      <Section n={1} title="ส่งคำขอ">
        <DataRequestForm />
      </Section>

      <Section n={2} title="สิ่งที่เราจะทำ">
        <ol>
          <li>เมื่อได้รับคำขอ คุณจะได้เลขอ้างอิง และเราอาจติดต่อกลับเพื่อยืนยันตัวตน เช่น ให้ส่งข้อความยืนยันจากบัญชีแชตเดิม</li>
          <li>
            เราจะดำเนินการและแจ้งผลภายใน 30 วัน สำหรับคำขอลบ เราจะลบประวัติแชต ชื่อและรูปโปรไฟล์ รหัสผู้ใช้ของแพลตฟอร์ม และข้อมูลติดต่อของคุณออกจากระบบ
          </li>
          <li>
            ข้อมูลที่กฎหมายกำหนดให้เก็บ เช่น ใบกำกับภาษีและเอกสารบัญชี (ไม่น้อยกว่า 5 ปี) จะเก็บไว้จนครบระยะเวลาและใช้เฉพาะตามกฎหมาย
            หลังจากนั้นจะลบหรือทำให้ไม่สามารถระบุตัวบุคคลได้
          </li>
        </ol>
      </Section>

      <Section n={3} title="ลบการเชื่อมต่อจาก Facebook / Instagram ด้วยตนเอง">
        <p>หากคุณเคยเชื่อมบัญชี Facebook กับแอปของเรา (เช่น ผู้ดูแลเพจ) คุณยกเลิกการเข้าถึงได้เองที่</p>
        <ol>
          <li>Facebook: การตั้งค่าและความเป็นส่วนตัว → การตั้งค่า → แอปและเว็บไซต์ → เลือกแอปนี้ → ลบ</li>
          <li>Instagram: การตั้งค่า → ความปลอดภัย → แอปและเว็บไซต์ → เลือกแอปนี้ → ลบ</li>
        </ol>
        <p>
          การลบแอปจะหยุดการเข้าถึงใหม่ทันที แต่ข้อความที่ส่งถึงร้านไว้ก่อนหน้ายังอยู่ในระบบของร้าน หากต้องการให้ลบด้วย โปรดส่งคำขอในข้อ 1
          สำหรับ LINE คุณบล็อกบัญชี LINE Official Account ของร้านได้ และส่งคำขอในข้อ 1 เพื่อให้ลบประวัติแชต
        </p>
      </Section>

      <Section n={4} title="ติดต่อผู้ควบคุมข้อมูล">
        <ProviderCard />
      </Section>
    </LegalShell>
  );
}
