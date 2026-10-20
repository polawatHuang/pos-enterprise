"use client";

import { DialogContent } from "@/components/ui/overlays";

export const SHORTCUTS: [string, string][] = [
  ["F1", "แสดงคีย์ลัด"],
  ["F2", "ไปช่องสแกน/ค้นหา"],
  ["F3", "สมาชิก"],
  ["F4", "พักบิล"],
  ["F5", "เรียกบิลที่พัก"],
  ["F6", "ส่วนลดท้ายบิล"],
  ["F7", "แก้รายการที่เลือก"],
  ["F8", "ชำระเงินสด"],
  ["F9", "ชำระ PromptPay"],
  ["F10", "เลือกวิธีชำระ"],
  ["6 *", "พิมพ์จำนวนแล้ว * ก่อนสแกน = สแกนทีเดียว 6 ชิ้น"],
  ["↑ ↓", "เลือกรายการในตะกร้า"],
  ["+ / −", "เพิ่ม/ลดจำนวนรายการที่เลือก"],
  ["Delete", "ลบรายการที่เลือก"],
  ["Esc", "ล้างช่องค้นหา / ปิดหน้าต่าง"],
];

export function ShortcutsDialog() {
  return (
    <DialogContent title="คีย์ลัด" description="ขายได้เร็วโดยไม่ต้องใช้เมาส์" className="max-w-md">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} className="contents">
            <dt>
              <kbd className="rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs">{k}</kbd>
            </dt>
            <dd className="text-muted-foreground">{v}</dd>
          </div>
        ))}
      </dl>
    </DialogContent>
  );
}
