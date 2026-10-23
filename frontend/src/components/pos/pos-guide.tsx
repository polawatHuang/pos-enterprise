"use client";

import { CreditCard, GraduationCap, PackageOpen, ReceiptText, ScanBarcode, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const STEPS = [
  { icon: ScanBarcode, title: "สแกนหรือแตะสินค้า", text: "ยิงบาร์โค้ด หรือแตะรูปสินค้า ของจะเข้าตะกร้าทันที" },
  { icon: CreditCard, title: "กด ชำระเงิน", text: "เลือก เงินสด หรือ PromptPay แล้วกดยอดที่ลูกค้าให้มา" },
  { icon: ReceiptText, title: "ทอนเงิน ส่งใบเสร็จ", text: "จอบอกเงินทอนตัวใหญ่ กด ขายบิลถัดไป ได้เลย" },
];
const TIPS = [
  { icon: PackageOpen, text: "ของไม่มีบาร์โค้ด → ปุ่ม ระบุราคา" },
  { icon: Undo2, text: "ลูกค้าคืนของ → ปุ่ม บิล / คืนของ (ผู้จัดการกรอก PIN)" },
  { icon: ReceiptText, text: "เลิกงาน → ปุ่ม ปิดกะ แล้วนับเงินในลิ้นชัก" },
];

/** A first-day card: how a sale goes, in three steps, plus where the less common jobs live. */
export function PosGuide({ onClose, onTraining }: { onClose: () => void; onTraining?: () => void }) {
  return (
    <section aria-label="วิธีขาย" className="relative mb-3 rounded-2xl border border-primary/30 bg-primary-soft/40 p-4">
      <button onClick={onClose} className="absolute right-2 top-2 grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-accent" aria-label="ปิดวิธีใช้">
        <X className="size-4" />
      </button>
      <p className="pr-10 font-semibold">ขายบิลแรกใน 3 ขั้น</p>
      <ol className="mt-3 grid gap-3 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-xl bg-card p-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{i + 1}</span>
            <span className="min-w-0 text-sm">
              <span className="flex items-center gap-1.5 font-medium">
                <s.icon className="size-4 text-primary" /> {s.title}
              </span>
              <span className="mt-0.5 block text-muted-foreground">{s.text}</span>
            </span>
          </li>
        ))}
      </ol>
      <ul className="mt-3 grid gap-1.5 text-sm text-muted-foreground sm:grid-cols-3">
        {TIPS.map((t) => (
          <li key={t.text} className="flex items-center gap-2">
            <t.icon className="size-4 shrink-0" /> {t.text}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        {onTraining && (
          <Button variant="outline" size="sm" className="h-10" onClick={onTraining}>
            <GraduationCap /> ลองฝึกขาย (ไม่บันทึกจริง)
          </Button>
        )}
        <Button size="sm" className="h-10" onClick={onClose}>
          เข้าใจแล้ว
        </Button>
      </div>
    </section>
  );
}
