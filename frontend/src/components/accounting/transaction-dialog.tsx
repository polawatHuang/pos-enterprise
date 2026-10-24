"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { base64Of, downscaleToDataUrl } from "@/lib/image";
import type { ReceiptExtraction, TxnMeta, TxnType, VatMode } from "@/lib/types";
import { cn, formatMoney, todayStr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, NativeSelect, Segmented } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";
import { useTaxSettings } from "@/lib/tax";
import { isUnreadable, readFileNow, UNREADABLE_HELP } from "@/lib/files";

export const TXN_META_KEY = ["accounting", "txn-meta"] as const;
export const useTxnMeta = () =>
  useQuery({ queryKey: TXN_META_KEY, queryFn: () => api.get<TxnMeta>("/accounting/transactions/meta"), staleTime: 30 * 60_000 });

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Mirrors the server: VAT on top / included at the shop's rate, WHT on the pre-VAT base. */
export function previewAmounts(amount: number, vatMode: VatMode, whtRate: number, vatRate = 7) {
  const base = vatMode === "inclusive" ? r2((amount * 100) / (100 + vatRate)) : r2(amount);
  const vat = vatMode === "none" ? 0 : vatMode === "inclusive" ? r2(amount - base) : r2((base * vatRate) / 100);
  const wht = whtRate ? r2((base * whtRate) / 100) : 0;
  return { base, vat, wht, net: r2(base + vat - wht) };
}

export interface TxnPrefill {
  type?: TxnType;
  category?: string;
  amount?: number;
  vatMode?: VatMode;
  vatClaimable?: boolean;
  txnDate?: string;
  description?: string;
  counterparty?: string;
  counterpartyTaxId?: string;
  whtCode?: string;
  aiExtracted?: boolean;
  aiConfidence?: ReceiptExtraction["confidence"];
}

/** Turns an AI extraction into form defaults (the user reviews before saving). */
export function prefillFromExtraction(x: ReceiptExtraction): TxnPrefill {
  const hasVat = (x.vatAmount ?? 0) > 0;
  const amount = x.total ?? (x.subtotal != null ? x.subtotal + (x.vatAmount ?? 0) : undefined);
  return {
    type: "expense",
    category: x.category,
    amount: amount ?? undefined,
    vatMode: hasVat ? "inclusive" : "none",
    vatClaimable: x.isFullTaxInvoice,
    txnDate: x.date ?? undefined,
    description: [x.description, x.documentNo ? `(เลขที่ ${x.documentNo})` : ""].filter(Boolean).join(" "),
    counterparty: x.vendorName ?? undefined,
    counterpartyTaxId: x.vendorTaxId ?? undefined,
    whtCode: x.suggestedWhtType?.code,
    aiExtracted: true,
    aiConfidence: x.confidence,
  };
}

export function TransactionDialog({ prefill, onDone }: { prefill?: TxnPrefill; onDone: () => void }) {
  const qc = useQueryClient();
  const meta = useTxnMeta();
  const [type, setType] = useState<TxnType>(prefill?.type ?? "expense");
  const [category, setCategory] = useState(prefill?.category ?? "");
  const [txnDate, setTxnDate] = useState(prefill?.txnDate ?? todayStr());
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [amount, setAmount] = useState(prefill?.amount != null ? String(prefill.amount) : "");
  const [vatMode, setVatMode] = useState<VatMode>(prefill?.vatMode ?? "none");
  const [vatClaimable, setVatClaimable] = useState(prefill?.vatClaimable ?? true);
  const [whtCode, setWhtCode] = useState(prefill?.whtCode ?? "");
  const [whtRate, setWhtRate] = useState("");
  const [counterparty, setCounterparty] = useState(prefill?.counterparty ?? "");
  const [taxId, setTaxId] = useState(prefill?.counterpartyTaxId ?? "");
  // 40(2) is paid to individuals; the other common WHT types are usually paid to companies
  const typeForWht = (code: string): "" | "individual" | "company" => (!code ? "" : code === "40(2)" ? "individual" : "company");
  const [counterpartyType, setCounterpartyType] = useState<"" | "individual" | "company">(typeForWht(prefill?.whtCode ?? ""));
  const [paymentMethod, setPaymentMethod] = useState("transfer");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const categories = meta.data?.categories[type] ?? [];
  const whtType = meta.data?.whtTypes.find((w) => w.code === whtCode);
  const effectiveRate = type === "expense" ? (whtRate !== "" ? Number(whtRate) : whtType?.rate ?? 0) : Number(whtRate || 0);
  const { tax } = useTaxSettings();
  const preview = useMemo(() => previewAmounts(Number(amount) || 0, vatMode, effectiveRate, tax.vatRate), [amount, vatMode, effectiveRate, tax.vatRate]);

  const save = async () => {
    const errs: Record<string, string> = {};
    if (!category) errs.category = "เลือกหมวด";
    if (!(Number(amount) > 0)) errs.amount = "กรอกจำนวนเงิน";
    if (!description.trim()) errs.description = "กรอกรายละเอียด";
    if (taxId && !/^\d{13}$/.test(taxId)) errs.taxId = "ต้องเป็นตัวเลข 13 หลัก";
    if (effectiveRate > 0 && (!counterparty.trim() || !counterpartyType)) errs.counterpartyType = "รายการหัก ณ ที่จ่ายต้องระบุชื่อและประเภทผู้ถูกหัก";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await api.post("/accounting/transactions", {
        type,
        category,
        amount: Number(amount),
        vatMode,
        vatClaimable,
        whtRate: effectiveRate,
        whtIncomeType: effectiveRate ? whtType?.code.split("-")[0] ?? null : null,
        txnDate,
        description,
        counterparty: counterparty || null,
        counterpartyTaxId: taxId || null,
        counterpartyType: counterpartyType || null,
        paymentMethod,
        aiExtracted: !!prefill?.aiExtracted,
      });
      toast.success(type === "expense" ? "บันทึกรายจ่ายและลงบัญชีแล้ว" : "บันทึกรายรับและลงบัญชีแล้ว");
      void qc.invalidateQueries({ queryKey: ["accounting"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent title={prefill?.aiExtracted ? "ตรวจสอบข้อมูลที่ AI อ่านได้" : "บันทึกรายรับ-รายจ่าย"} className="max-w-2xl">
      {prefill?.aiExtracted && (
        <div
          className={cn(
            "mb-4 flex gap-2 rounded-lg p-3 text-sm",
            prefill.aiConfidence === "low" ? "bg-warning-soft text-warning" : "bg-primary-soft text-primary",
          )}
        >
          <Sparkles className="mt-0.5 size-4 shrink-0" />
          {prefill.aiConfidence === "low"
            ? "AI ไม่ค่อยมั่นใจกับเอกสารนี้ กรุณาตรวจทุกช่องให้ละเอียดก่อนบันทึก"
            : "AI กรอกข้อมูลให้แล้ว กรุณาตรวจยอดเงิน วันที่ และผู้ขายก่อนกดบันทึก"}
        </div>
      )}
      <div className="grid gap-4">
        <Segmented<TxnType>
          label="ประเภท"
          value={type}
          onChange={(t) => {
            setType(t);
            setCategory("");
            setWhtCode("");
          }}
          options={[
            { value: "expense", label: "รายจ่าย" },
            { value: "income", label: "รายรับ" },
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="cat">หมวด</Label>
            <NativeSelect id="cat" className="h-10 w-full" value={category} onChange={(e) => setCategory(e.target.value)} aria-invalid={!!errors.category}>
              <option value="">เลือกหมวด</option>
              {categories.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <FieldError message={errors.category} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="date">วันที่</Label>
            <Input id="date" type="date" value={txnDate} onChange={(e) => setTxnDate(e.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="desc">รายละเอียด</Label>
            <Input id="desc" value={description} onChange={(e) => setDescription(e.target.value)} aria-invalid={!!errors.description} />
            <FieldError message={errors.description} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="amount">จำนวนเงิน</Label>
            <Input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!errors.amount} />
            <FieldError message={errors.amount} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vat">ภาษีมูลค่าเพิ่ม</Label>
            <NativeSelect id="vat" className="h-10 w-full" value={vatMode} onChange={(e) => setVatMode(e.target.value as VatMode)}>
              <option value="none">ไม่มี VAT</option>
              <option value="inclusive">ยอดนี้รวม VAT {tax.vatRate}% แล้ว</option>
              <option value="exclusive">บวก VAT {tax.vatRate}% เพิ่ม</option>
            </NativeSelect>
            {type === "expense" && vatMode !== "none" && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={vatClaimable} onChange={(e) => setVatClaimable(e.target.checked)} className="accent-[var(--primary)]" />
                มีใบกำกับภาษีเต็มรูป (ขอคืนภาษีซื้อได้)
              </label>
            )}
          </div>
          {type === "expense" ? (
            <div className="space-y-2">
              <Label htmlFor="wht">หัก ณ ที่จ่าย</Label>
              <NativeSelect
                id="wht"
                className="h-10 w-full"
                value={whtCode}
                onChange={(e) => {
                  setWhtCode(e.target.value);
                  setWhtRate("");
                  setCounterpartyType(typeForWht(e.target.value));
                }}
              >
                <option value="">ไม่หัก</option>
                {meta.data?.whtTypes.map((w) => (
                  <option key={w.code} value={w.code}>
                    {w.label} ({w.rate}%)
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="whtin">ลูกค้าหัก ณ ที่จ่ายไว้ (%)</Label>
              <Input id="whtin" inputMode="decimal" value={whtRate} onChange={(e) => setWhtRate(e.target.value)} placeholder="0" />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="pay">ช่องทางชำระ</Label>
            <NativeSelect id="pay" className="h-10 w-full" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="transfer">โอนเงิน</option>
              <option value="cash">เงินสด</option>
              <option value="card">บัตร</option>
              <option value="promptpay">PromptPay</option>
              <option value="cheque">เช็ค</option>
              <option value="petty_cash">เงินสดย่อย</option>
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cp">{type === "expense" ? "ผู้ขาย / ผู้รับเงิน" : "ลูกค้า / ผู้จ่ายเงิน"}</Label>
            <Input id="cp" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="taxid">เลขผู้เสียภาษี</Label>
            <Input id="taxid" inputMode="numeric" value={taxId} onChange={(e) => setTaxId(e.target.value.replace(/\D/g, ""))} aria-invalid={!!errors.taxId} />
            <FieldError message={errors.taxId} />
          </div>
          {effectiveRate > 0 && type === "expense" && (
            <div className="space-y-2 sm:col-span-2">
              <Label>ประเภทผู้ถูกหัก (กำหนดว่ายื่นแบบใด)</Label>
              <Segmented<"individual" | "company">
                label="ประเภทผู้ถูกหัก"
                value={(counterpartyType || "company") as "individual" | "company"}
                onChange={setCounterpartyType}
                options={[
                  { value: "company", label: "นิติบุคคล (ภ.ง.ด.53)" },
                  { value: "individual", label: "บุคคลธรรมดา (ภ.ง.ด.3)" },
                ]}
              />
              <FieldError message={errors.counterpartyType} />
            </div>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-4 text-sm sm:grid-cols-4">
          <Amount label="ก่อน VAT" value={preview.base} />
          <Amount label="VAT" value={preview.vat} />
          <Amount label="หัก ณ ที่จ่าย" value={-preview.wht} />
          <Amount label={type === "expense" ? "จ่ายจริง" : "รับจริง"} value={preview.net} strong />
        </dl>
        <div className="flex justify-end">
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            บันทึกและลงบัญชี
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}

function Amount({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={strong ? "text-base font-semibold" : "font-medium"}>{formatMoney(value)}</dd>
    </div>
  );
}

/**
 * Prepares a receipt for upload: photos are downscaled to ≤2000px JPEG so phone pictures stay
 * well under the 4 MB API limit; PDFs are sent as-is.
 */
export async function fileToPayload(picked: File): Promise<{ mediaType: string; data: string }> {
  const file = await readFileNow(picked).catch((err) => {
    throw isUnreadable(err) ? new Error(UNREADABLE_HELP) : err;
  });
  if (file.type === "application/pdf") {
    if (file.size > 4 * 1024 * 1024) throw new Error("ไฟล์ PDF ใหญ่เกิน 4 MB");
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { mediaType: "application/pdf", data: btoa(bin) };
  }
  if (!file.type.startsWith("image/")) throw new Error("รองรับเฉพาะรูปภาพหรือ PDF");
  const dataUrl = await downscaleToDataUrl(file, { maxSide: 2000, quality: 0.85 });
  return { mediaType: "image/jpeg", data: base64Of(dataUrl) };
}
