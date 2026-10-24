"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { PosSettings } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";

export const POS_SETTINGS_KEY = ["pos", "settings"] as const;

export function PosSettingsDialog({ settings, onDone, onGateway }: { settings: PosSettings; onDone: () => void; onGateway?: () => void }) {
  const qc = useQueryClient();
  // POS settings edit the shop-wide accounts; a branch may override them in Settings › Branches
  const [promptpayId, setPromptpayId] = useState(settings.defaults?.promptpayId ?? settings.promptpayId);
  const [receiptFooter, setReceiptFooter] = useState(settings.receiptFooter);
  const [maxDiscountPct, setMaxDiscountPct] = useState(String(settings.maxDiscountPct));
  const [pointsEarnBaht, setPointsEarnBaht] = useState(String(settings.pointsEarnBaht));
  const [pointValue, setPointValue] = useState(String(settings.pointValue));
  const [cashLimit, setCashLimit] = useState(String(settings.cashLimit));
  const [lineOaId, setLineOaId] = useState(settings.lineOaId ?? "");
  const [taxInvoiceAuto, setTaxInvoiceAuto] = useState(settings.taxInvoiceAuto ?? false);
  const [bank, setBank] = useState(settings.defaults?.bankAccount ?? settings.bankAccount);
  const own = settings.paymentBranch && (settings.paymentBranch.ownPromptpay || settings.paymentBranch.ownBank) ? settings.paymentBranch : null;
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
        lineOaId: lineOaId.trim(),
        taxInvoiceAuto,
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
        {own && (
          <p className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs">
            สาขา <b>{own.name}</b> ที่คุณขายอยู่ใช้{[own.ownPromptpay && "PromptPay", own.ownBank && "บัญชีธนาคาร"].filter(Boolean).join("และ")}ของสาขาเอง — แก้ได้ที่{" "}
            <Link href="/settings/branches" className="font-medium text-primary underline-offset-2 hover:underline">
              ตั้งค่า › สาขา
            </Link>
            . ค่าด้านล่างเป็นค่าเริ่มต้นของสาขาที่ไม่ได้ตั้งเอง
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor="pp">หมายเลข PromptPay ของร้าน (ทุกสาขา)</Label>
          <Input id="pp" inputMode="numeric" value={promptpayId} onChange={(e) => setPromptpayId(e.target.value)} placeholder="เบอร์มือถือ 10 หลัก · เลขผู้เสียภาษี 13 หลัก · เลขอ้างอิง K PLUS 15 หลัก" />
          <p className="text-xs text-muted-foreground">ใช้สร้าง QR พร้อมยอดเงินตอนลูกค้าเลือกจ่ายด้วย PromptPay · ใช้ “เลขที่อ้างอิง” 15 หลักใต้ QR รับเงินในแอป K PLUS ได้ — ลองสแกนจ่าย 1 บาทเพื่อตรวจว่าขึ้นชื่อบัญชีร้านถูกต้อง</p>
        </div>
        <fieldset className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-2">
          <legend className="px-1 text-sm font-medium">บัญชีรับโอนของร้าน (ทุกสาขา)</legend>
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
          <p className="text-xs text-muted-foreground sm:col-span-2">แสดงตอนลูกค้าเลือกโอนเงิน บนจอลูกค้า และท้ายใบเสนอราคา/ใบแจ้งหนี้ · AI ใช้ตรวจชื่อผู้รับในสลิป</p>
        </fieldset>
        {onGateway && (
          <button
            type="button"
            onClick={onGateway}
            className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-left text-sm hover:bg-accent"
          >
            <span>
              <b className="font-medium">รับชำระ PromptPay อัตโนมัติ</b>
              <span className="block text-xs text-muted-foreground">
                {settings.paymentGateway?.enabled ? "เปิดใช้อยู่ — บิลปิดเองเมื่อเงินเข้า" : "ยังไม่เปิด — เชื่อมผู้ให้บริการชำระเงินให้บิลปิดเอง"}
              </span>
            </span>
            <span className="text-primary">ตั้งค่า</span>
          </button>
        )}
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
        <fieldset className="grid gap-3 rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-medium">หน้าใบเสร็จของลูกค้า (QR ท้ายใบเสร็จ)</legend>
          <div className="space-y-1.5">
            <Label htmlFor="lineoa">LINE Official Account ของร้าน</Label>
            <Input id="lineoa" value={lineOaId} onChange={(e) => setLineOaId(e.target.value)} placeholder="@myshop" />
            <p className="text-xs text-muted-foreground">ใส่แล้วหน้าใบเสร็จจะมีปุ่ม “เพิ่มเพื่อน LINE” — เว้นว่าง = ไม่แสดง</p>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-5" checked={taxInvoiceAuto} onChange={(e) => setTaxInvoiceAuto(e.target.checked)} />
            <span>
              ออกใบกำกับภาษีเต็มรูปให้อัตโนมัติเมื่อลูกค้ากรอกข้อมูลครบ
              <span className="block text-xs text-muted-foreground">ปิดไว้ = พนักงานตรวจข้อมูลแล้วกดออกเองที่หน้า บิล / คืนของ</span>
            </span>
          </label>
        </fieldset>
        <Button onClick={save} disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          บันทึก
        </Button>
      </div>
    </DialogContent>
  );
}
