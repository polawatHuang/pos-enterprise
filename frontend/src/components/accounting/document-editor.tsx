"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, apiFetch } from "@/lib/api";
import type { AccDocument, DocItem, DocType, Paged, VatType } from "@/lib/types";
import { formatMoney, formatThaiDate, todayStr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, FieldError, Input, Label, NativeSelect, Textarea } from "@/components/ui/primitives";
import { ProductPicker } from "@/components/common/product-picker";
import { CREATABLE_DOC_TYPES, DOC_TYPE_LABEL } from "./labels";
import { lineVatRate, netOfInclusive, type TaxSettings, useTaxSettings } from "@/lib/tax";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Line being edited: numbers stay strings while typing so "1." or "0.5" can be entered. */
type EditLine = Omit<DocItem, "quantity" | "unitPrice"> & { quantity: string; unitPrice: string };
const num = (v: string) => Number(v) || 0;

/** Same math as the server: prices exclude VAT; the shop's VAT rate on vat7 lines after the bill discount. */
function totalsOf(items: EditLine[], discount: number, tax: TaxSettings) {
  const lines = items.map((i) => r2(num(i.quantity) * num(i.unitPrice) - (i.discount || 0)));
  const subtotal = r2(lines.reduce((s, v) => s + v, 0));
  const net = r2(subtotal - discount);
  const ratio = subtotal ? net / subtotal : 0;
  const vat = r2(items.reduce((s, it, idx) => s + (lines[idx] * ratio * lineVatRate(tax, it.vatType)) / 100, 0));
  return { lines, subtotal, net, vat, total: r2(net + vat) };
}

const emptyLine = (): EditLine => ({ productId: null, description: "", quantity: "1", unitPrice: "", discount: 0, vatType: "vat7" });
const toEdit = (i: DocItem): EditLine => ({ ...i, quantity: String(i.quantity), unitPrice: String(i.unitPrice) });

export function DocumentEditor({ initial, defaultType }: { initial?: AccDocument; defaultType?: DocType }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [docType, setDocType] = useState<DocType>(initial?.docType ?? defaultType ?? "tax_invoice");
  const [docDate, setDocDate] = useState(initial?.docDate ?? todayStr());
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [partyName, setPartyName] = useState(initial?.partyName ?? "");
  const [partyTaxId, setPartyTaxId] = useState(initial?.partyTaxId ?? "");
  const [partyAddress, setPartyAddress] = useState(initial?.partyAddress ?? "");
  const [refDocId, setRefDocId] = useState(initial?.refDocId ? String(initial.refDocId) : "");
  const [items, setItems] = useState<EditLine[]>(initial?.items.length ? initial.items.map(toEdit) : [emptyLine()]);
  const [discount, setDiscount] = useState(initial ? String(initial.discount || "") : "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { tax } = useTaxSettings();
  const t = useMemo(() => totalsOf(items, Number(discount) || 0, tax), [items, discount, tax]);
  const reset = () => {
    setDocDate(todayStr());
    setDueDate("");
    setPartyName("");
    setPartyTaxId("");
    setPartyAddress("");
    setRefDocId("");
    setItems([emptyLine()]);
    setDiscount("");
    setNote("");
  };
  const update = (i: number, patch: Partial<EditLine>) => setItems((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const adjusts = docType === "credit_note" || docType === "debit_note";
  const needsBuyer = docType === "tax_invoice" || docType === "tax_invoice_receipt" || adjusts;

  const save = async () => {
    setError(null);
    if (needsBuyer && !partyName.trim()) return setError("ใบกำกับภาษีต้องระบุชื่อผู้ซื้อ");
    if (items.some((i) => !i.description.trim() || !(num(i.quantity) > 0))) return setError("กรอกรายการและจำนวนให้ครบทุกบรรทัด");
    if (adjusts && !refDocId) return setError(`${DOC_TYPE_LABEL[docType]}ต้องเลือกใบกำกับภาษีเดิมที่อ้างอิง`);
    setBusy(true);
    const body = {
      docType,
      docDate,
      dueDate: dueDate || null,
      partyName: partyName || null,
      partyTaxId: partyTaxId || null,
      partyAddress: partyAddress || null,
      refDocId: refDocId ? Number(refDocId) : null,
      discount: Number(discount) || 0,
      note: note || null,
      items: items.map(({ productId, description, quantity, unitPrice, discount: d, vatType }) => ({
        productId,
        description,
        quantity: num(quantity),
        unitPrice: num(unitPrice),
        discount: d || 0,
        vatType,
      })),
    };
    try {
      const doc = initial ? await api.patch<AccDocument>(`/accounting/documents/${initial.id}`, body) : await api.post<AccDocument>("/accounting/documents", body);
      void qc.invalidateQueries({ queryKey: ["accounting"] });
      // Next keeps this page mounted (hidden) after navigating away; clear it so the next
      // "create" starts blank instead of re-showing the saved document.
      if (!initial) reset();
      toast.success("บันทึกฉบับร่างแล้ว");
      router.push(`/accounting/documents/${doc.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Link href="/documents" className="mb-2 inline-flex min-h-10 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> ศูนย์เอกสาร
      </Link>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{initial ? "แก้ไขฉบับร่าง" : `สร้าง${DOC_TYPE_LABEL[docType]}`}</h1>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>ข้อมูลเอกสาร</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="type">ประเภท</Label>
              <NativeSelect id="type" className="h-10 w-full" value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
                {CREATABLE_DOC_TYPES.filter((d) => d !== "billing_note").map((d) => (
                  <option key={d} value={d}>
                    {DOC_TYPE_LABEL[d]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="date">วันที่</Label>
                <Input id="date" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="due">ครบกำหนด</Label>
                <Input id="due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="party">{docType === "quotation" ? "เรียน (ลูกค้า)" : "ชื่อผู้ซื้อ / ลูกค้า"}</Label>
              <Input id="party" value={partyName} onChange={(e) => setPartyName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ptax">เลขประจำตัวผู้เสียภาษีผู้ซื้อ</Label>
              <Input id="ptax" inputMode="numeric" value={partyTaxId} onChange={(e) => setPartyTaxId(e.target.value.replace(/[^\d]/g, ""))} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="paddr">ที่อยู่ผู้ซื้อ</Label>
              <Textarea id="paddr" rows={2} value={partyAddress} onChange={(e) => setPartyAddress(e.target.value)} />
            </div>
            {adjusts && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="ref">ใบกำกับภาษีเดิมที่{docType === "credit_note" ? "ลดหนี้" : "เพิ่มหนี้"}</Label>
                <TaxInvoicePicker
                  value={refDocId}
                  onChange={(d) => {
                    setRefDocId(String(d.id));
                    // the buyer is the same as on the tax invoice
                    if (!partyName) setPartyName(d.partyName ?? "");
                    if (!partyTaxId) setPartyTaxId(d.partyTaxId ?? "");
                    if (!partyAddress) setPartyAddress(d.partyAddress ?? "");
                  }}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:row-span-2 lg:self-start">
          <CardHeader>
            <CardTitle>สรุปยอด</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="รวมเป็นเงิน" value={t.subtotal} />
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="disc" className="text-muted-foreground">
                ส่วนลด
              </label>
              <Input id="disc" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} className="h-8 w-28 text-right" placeholder="0.00" />
            </div>
            <Row label="ยอดก่อนภาษี" value={t.net} />
            {tax.vatRegistered && <Row label={`ภาษีมูลค่าเพิ่ม ${tax.vatRate}%`} value={t.vat} />}
            <div className="flex items-baseline justify-between border-t border-border pt-2">
              <span className="font-medium">จำนวนเงินรวมทั้งสิ้น</span>
              <span className="text-xl font-semibold tabular-nums">{formatMoney(t.total)}</span>
            </div>
            <p className="pt-1 text-xs text-muted-foreground">ราคาในเอกสารเป็นราคาก่อน VAT (สินค้าจากแคตตาล็อกจะถูกถอด VAT ให้อัตโนมัติ)</p>
            <div className="space-y-2 pt-2">
              <Label htmlFor="note">หมายเหตุ</Label>
              <Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <FieldError message={error ?? undefined} />
            <Button className="mt-2 w-full" onClick={save} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              บันทึกฉบับร่าง
            </Button>
            <p className="text-center text-xs text-muted-foreground">ออกเลขที่และลงบัญชีเมื่อกด &quot;ออกเอกสาร&quot; ในหน้าถัดไป</p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>รายการ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ProductPicker
              onPick={(p) =>
                setItems((ls) => [
                  ...ls.filter((l) => l.description.trim()),
                  {
                    productId: p.id,
                    description: p.name,
                    quantity: "1",
                    unitPrice: String(r2(netOfInclusive(p.price, lineVatRate(tax, p.vatType)))),
                    discount: 0,
                    vatType: p.vatType,
                  },
                ])
              }
            />
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-12 items-end gap-2 rounded-lg border border-border p-3">
                  <div className="col-span-12 space-y-1 sm:col-span-5">
                    <Label className="text-xs text-muted-foreground">รายการ</Label>
                    <Input value={it.description} onChange={(e) => update(i, { description: e.target.value })} className="h-9" />
                  </div>
                  <div className="col-span-3 space-y-1 sm:col-span-1">
                    <Label className="text-xs text-muted-foreground">จำนวน</Label>
                    <Input inputMode="decimal" value={it.quantity} onChange={(e) => update(i, { quantity: e.target.value })} className="h-9" />
                  </div>
                  <div className="col-span-4 space-y-1 sm:col-span-2">
                    <Label className="text-xs text-muted-foreground">ราคา/หน่วย</Label>
                    <Input inputMode="decimal" value={it.unitPrice} onChange={(e) => update(i, { unitPrice: e.target.value })} className="h-9" />
                  </div>
                  <div className="col-span-5 space-y-1 sm:col-span-2">
                    <Label className="text-xs text-muted-foreground">VAT</Label>
                    <NativeSelect value={it.vatType} onChange={(e) => update(i, { vatType: e.target.value as VatType })} className="h-9 w-full">
                      <option value="vat7">{tax.vatRate}%</option>
                      <option value="exempt">ยกเว้น</option>
                      <option value="zero">0%</option>
                    </NativeSelect>
                  </div>
                  <div className="col-span-10 text-right text-sm font-medium tabular-nums sm:col-span-1">{formatMoney(t.lines[i] ?? 0)}</div>
                  <button
                    onClick={() => setItems((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [emptyLine()]))}
                    className="col-span-2 grid size-9 place-items-center justify-self-end rounded-md text-muted-foreground hover:bg-danger-soft hover:text-danger sm:col-span-1"
                    aria-label="ลบรายการ"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => setItems((ls) => [...ls, emptyLine()])}>
              <Plus /> เพิ่มบรรทัด
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{formatMoney(value)}</span>
    </div>
  );
}

/** Issued tax invoices to pick from (search by number or buyer); credit and debit notes must cite one. */
function TaxInvoicePicker({ value, onChange }: { value: string; onChange: (d: AccDocument) => void }) {
  const [q, setQ] = useState("");
  const list = useQuery({
    queryKey: ["accounting", "documents", "tax-invoices", q],
    queryFn: async () => {
      const [ti, tr] = await Promise.all(
        (["tax_invoice", "tax_invoice_receipt"] as const).map((docType) =>
          apiFetch<Paged<AccDocument>>("/accounting/documents", { query: { docType, q, pageSize: 20 } }).then((r) => r.data),
        ),
      );
      return [...ti, ...tr].filter((d) => d.status === "issued" || d.status === "paid").sort((a, b) => b.docDate.localeCompare(a.docDate));
    },
  });
  return (
    <div className="space-y-2">
      <Input id="ref" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาเลขที่ใบกำกับภาษี หรือชื่อผู้ซื้อ" aria-label="ค้นหาใบกำกับภาษีเดิม" />
      <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
        {list.isPending ? (
          <p className="p-3 text-sm text-muted-foreground">กำลังโหลด…</p>
        ) : !list.data?.length ? (
          <p className="p-3 text-sm text-muted-foreground">ไม่พบใบกำกับภาษีที่ออกแล้ว</p>
        ) : (
          list.data.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onChange(d)}
              className={`flex min-h-11 w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left text-sm last:border-0 hover:bg-muted ${
                String(d.id) === value ? "bg-primary/10 font-medium" : ""
              }`}
            >
              <span className="min-w-0">
                <span className="block">{d.docNo}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {d.partyName ?? "-"} · {formatThaiDate(d.docDate)}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">{formatMoney(d.total)}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
