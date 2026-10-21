"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { TAX_KEY, type TaxSettings, useTaxSettings, vatTypeLabel } from "@/lib/tax";
import type { VatType } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect, Skeleton } from "@/components/ui/primitives";
import { PageHeader } from "@/components/layout/page";

export function TaxSettingsView() {
  const settings = useTaxSettings();
  return (
    <>
      <PageHeader title="ภาษีมูลค่าเพิ่ม" description="ใช้คำนวณ VAT ในการขายหน้าร้าน ใบกำกับภาษี/เอกสาร รายรับ-รายจ่าย และรายงาน" />
      {settings.isPending ? <Skeleton className="h-80 max-w-2xl rounded-xl" /> : <TaxForm key={JSON.stringify(settings.data)} initial={settings.tax} />}
    </>
  );
}

function TaxForm({ initial }: { initial: TaxSettings }) {
  const qc = useQueryClient();
  const [registered, setRegistered] = useState(initial.vatRegistered);
  const [rate, setRate] = useState(String(initial.vatRate));
  const [defaultType, setDefaultType] = useState<VatType>(initial.defaultVatType);
  const [busy, setBusy] = useState(false);
  const rateNum = Number(rate);
  const rateValid = rate.trim() !== "" && rateNum >= 0 && rateNum <= 30;
  const preview: TaxSettings = { vatRegistered: registered, vatRate: rateValid ? rateNum : initial.vatRate, defaultVatType: defaultType };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rateValid) return toast.error("อัตรา VAT ต้องอยู่ระหว่าง 0–30%");
    setBusy(true);
    try {
      await api.put("/org/tax", { vatRegistered: registered, vatRate: rateNum, defaultVatType: defaultType });
      await qc.invalidateQueries({ queryKey: TAX_KEY });
      toast.success("บันทึกการตั้งค่าภาษีแล้ว");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  // Example: a 107-baht item at the chosen rate
  const example = 100 + preview.vatRate;
  return (
    <form onSubmit={save} className="max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>สถานะการจดทะเบียน</CardTitle>
          <CardDescription>ร้านที่ยังไม่จด VAT ห้ามเรียกเก็บหรือแยก VAT ในใบเสร็จ</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-start gap-3 rounded-lg border border-border p-3">
            <input type="checkbox" checked={registered} onChange={(e) => setRegistered(e.target.checked)} className="mt-0.5 size-4 accent-primary" />
            <span>
              <span className="block font-medium">ร้านจดทะเบียนภาษีมูลค่าเพิ่ม (VAT)</span>
              <span className="block text-sm text-muted-foreground">
                {registered
                  ? "ใบเสร็จเป็น \"ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ\" แยกยอดก่อน VAT และ VAT ให้อัตโนมัติ"
                  : "ใบเสร็จเป็น \"ใบเสร็จรับเงิน\" ธรรมดา ไม่คิดและไม่บันทึก VAT ในการขาย"}
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>อัตราและค่าเริ่มต้น</CardTitle>
          <CardDescription>อัตรามาตรฐานของไทยคือ 7% เปลี่ยนเฉพาะเมื่อกรมสรรพากรประกาศอัตราใหม่</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="vat-rate">อัตรา VAT (%)</Label>
            <Input id="vat-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} disabled={!registered} aria-invalid={!rateValid} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vat-default">ประเภท VAT เริ่มต้นของสินค้าใหม่</Label>
            <NativeSelect id="vat-default" className="h-10 w-full" value={defaultType} onChange={(e) => setDefaultType(e.target.value as VatType)}>
              {(["vat7", "exempt", "zero"] as const).map((t) => (
                <option key={t} value={t}>
                  {vatTypeLabel(preview, t)}
                </option>
              ))}
            </NativeSelect>
          </div>
          {registered && (
            <p className="rounded-lg bg-muted px-3 py-2.5 text-sm sm:col-span-2">
              ตัวอย่าง: สินค้าราคา {example} บาท (รวม VAT) = ก่อน VAT 100 บาท + VAT {preview.vatRate} บาท
            </p>
          )}
        </CardContent>
      </Card>

      <p className="flex gap-2 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        การเปลี่ยนแปลงมีผลกับบิลและเอกสารที่สร้างหลังจากนี้ บิลเก่าและรายงานภาษีที่บันทึกแล้วไม่เปลี่ยน
      </p>
      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} บันทึก
        </Button>
      </div>
    </form>
  );
}
