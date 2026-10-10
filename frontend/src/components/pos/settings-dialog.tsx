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
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.put("/pos/settings", { promptpayId: promptpayId.replace(/[\s-]/g, ""), receiptFooter, maxDiscountPct: Number(maxDiscountPct) });
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
        <div className="space-y-2">
          <Label htmlFor="max">ส่วนลดสูงสุดที่แคชเชียร์ให้ได้เอง (%)</Label>
          <Input id="max" inputMode="decimal" value={maxDiscountPct} onChange={(e) => setMaxDiscountPct(e.target.value)} />
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
