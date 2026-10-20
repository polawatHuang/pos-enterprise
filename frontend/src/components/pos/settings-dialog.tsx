"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { PosSettings } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";

export const POS_SETTINGS_KEY = ["pos", "settings"] as const;

export function PosSettingsDialog({ settings, onDone }: { settings: PosSettings; onDone: () => void }) {
  const qc = useQueryClient();
  const [promptpayId, setPromptpayId] = useState(settings.promptpayId);
  const [receiptFooter, setReceiptFooter] = useState(settings.receiptFooter);
  const [maxDiscountPct, setMaxDiscountPct] = useState(String(settings.maxDiscountPct));
  const [pointsEarnBaht, setPointsEarnBaht] = useState(String(settings.pointsEarnBaht));
  const [pointValue, setPointValue] = useState(String(settings.pointValue));
  const [cashLimit, setCashLimit] = useState(String(settings.cashLimit));
  const [bank, setBank] = useState(settings.bankAccount);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.put("/pos/settings", {
        promptpayId: promptpayId.replace(/[\s-]/g, ""),
        receiptFooter,
        maxDiscountPct: Number(maxDiscountPct),
        pointsEarnBaht: Number(pointsEarnBaht) || 0,
        pointValue: Number(pointValue) || 0,
        cashLimit: Number(cashLimit) || 0,
        bankAccount: { bank: bank.bank, type: bank.type, number: bank.number, name: bank.name },
      });
      toast.success("บันทึกการตั้งค่า POS แล้ว");
      await qc.invalidateQueries({ queryKey: POS_SETTINGS_KEY });
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent title="ตั้งค่า POS">
      <div className="grid gap-4">
        <div className="space-y-2">
          <Label htmlFor="pp">หมายเลข PromptPay ของร้าน</Label>
          <Input id="pp" inputMode="numeric" value={promptpayId} onChange={(e) => setPromptpayId(e.target.value)} placeholder="เบอร์มือถือ 10 หลัก หรือเลขผู้เสียภาษี 13 หลัก" />
          <p className="text-xs text-muted-foreground">ใช้สร้าง QR พร้อมยอดเงินตอนลูกค้าเลือกจ่ายด้วย PromptPay</p>
        </div>
        <fieldset className="grid grid-cols-2 gap-3 rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-medium">บัญชีรับโอนของร้าน</legend>
          <div className="space-y-1.5">
            <Label htmlFor="bank-name">ธนาคาร</Label>
            <Input id="bank-name" value={bank.bank} onChange={(e) => setBank({ ...bank, bank: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bank-type">ประเภทบัญชี</Label>
            <Input id="bank-type" value={bank.type} onChange={(e) => setBank({ ...bank, type: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bank-no">เลขที่บัญชี</Label>
            <Input id="bank-no" inputMode="numeric" value={bank.number} onChange={(e) => setBank({ ...bank, number: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bank-holder">ชื่อบัญชี</Label>
            <Input id="bank-holder" value={bank.name} onChange={(e) => setBank({ ...bank, name: e.target.value })} />
          </div>
          <p className="col-span-2 text-xs text-muted-foreground">แสดงตอนลูกค้าเลือกโอนเงิน บนจอลูกค้า และท้ายใบเสนอราคา/ใบแจ้งหนี้ · AI ใช้ตรวจชื่อผู้รับในสลิป</p>
        </fieldset>
        <div className="space-y-2">
          <Label htmlFor="max">ส่วนลดสูงสุดที่แคชเชียร์ให้ได้เอง (%)</Label>
          <Input id="max" inputMode="decimal" value={maxDiscountPct} onChange={(e) => setMaxDiscountPct(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="earn">ซื้อครบกี่บาทได้ 1 แต้ม</Label>
            <Input id="earn" inputMode="decimal" value={pointsEarnBaht} onChange={(e) => setPointsEarnBaht(e.target.value)} />
            <p className="text-xs text-muted-foreground">ใส่ 0 = ปิดระบบแต้ม</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pv">1 แต้มแลกเป็นเงิน (บาท)</Label>
            <Input id="pv" inputMode="decimal" value={pointValue} onChange={(e) => setPointValue(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="cashlimit">เตือนให้นำเงินเข้าตู้เซฟเมื่อเงินสดในลิ้นชักเกิน (บาท)</Label>
          <Input id="cashlimit" inputMode="decimal" value={cashLimit} onChange={(e) => setCashLimit(e.target.value)} />
          <p className="text-xs text-muted-foreground">ใส่ 0 = ไม่เตือน</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="footer">ข้อความท้ายใบเสร็จ</Label>
          <Input id="footer" value={receiptFooter} onChange={(e) => setReceiptFooter(e.target.value)} />
        </div>
        <Button onClick={save} disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          บันทึก
        </Button>
      </div>
    </DialogContent>
  );
}
