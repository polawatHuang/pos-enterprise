"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileText, Gift, Loader2, MessageCircle, Printer, Receipt } from "lucide-react";
import { api } from "@/lib/api";
import type { PublicReceipt } from "@/lib/types";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, FieldError, Input, Label, Textarea } from "@/components/ui/primitives";

/** The page behind the QR on a printed receipt: the bill, a full tax invoice request, and points. */
export function CustomerReceipt({ token }: { token: string }) {
  const q = useQuery({ queryKey: ["public-receipt", token], queryFn: () => api.get<PublicReceipt>(`/public/r/${token}`), retry: false });
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["public-receipt", token] });

  if (q.isPending)
    return (
      <main className="grid min-h-dvh place-items-center">
        <Loader2 className="size-7 animate-spin text-muted-foreground" />
      </main>
    );
  if (q.isError)
    return (
      <main className="mx-auto grid min-h-dvh max-w-md place-items-center p-6 text-center">
        <div>
          <Receipt className="mx-auto size-10 text-muted-foreground" />
          <h1 className="mt-3 text-lg font-semibold">ไม่พบใบเสร็จนี้</h1>
          <p className="mt-1 text-sm text-muted-foreground">{q.error instanceof Error ? q.error.message : "ตรวจสอบ QR หรือลิงก์อีกครั้ง"}</p>
        </div>
      </main>
    );
  const r = q.data;
  const cancelled = r.status !== "completed";

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-6 print:max-w-none print:p-0">
      <div className="print:hidden space-y-4">
        <header className="text-center">
          <p className="text-xs text-muted-foreground">ใบเสร็จรับเงิน</p>
          <h1 className="text-xl font-semibold">{r.seller.name}</h1>
          {r.seller.branchName && <p className="text-sm text-muted-foreground">{r.seller.branchName}</p>}
        </header>

        <Card className="p-4">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">{r.orderNo}</span>
            <span className="text-muted-foreground">{new Date(r.orderedAt).toLocaleString("th-TH")}</span>
          </div>
          {cancelled && <p className="mt-2 rounded-lg bg-danger-soft px-3 py-1.5 text-sm font-medium text-danger">บิลนี้ถูกยกเลิกหรือคืนสินค้าแล้ว</p>}
          <ul className="mt-3 divide-y divide-border text-sm">
            {r.items.map((i, idx) => (
              <li key={idx} className="flex justify-between gap-3 py-2">
                <span className="min-w-0">
                  {i.name}
                  <span className="block text-xs text-muted-foreground">
                    {i.quantity}
                    {i.unitName ? ` ${i.unitName}` : ""} × {formatMoney(i.unitPrice)}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{formatMoney(i.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-2 space-y-1 border-t border-border pt-3 text-sm">
            {r.discount > 0 && <Line label="ส่วนลด" value={-r.discount} />}
            {r.seller.vatRegistered && <Line label="VAT (รวมในราคา)" value={r.vat} muted />}
            <Line label="ยอดสุทธิ" value={r.total} strong />
            {r.payments.map((p, i) => (
              <Line key={i} label={p.method} value={p.amount} muted />
            ))}
          </dl>
        </Card>

        {r.taxInvoice.status === "issued" && r.taxInvoice.invoice && (
          <Card className="space-y-2 p-4">
            <p className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="size-5 text-success" /> ออกใบกำกับภาษีเต็มรูปแล้ว
            </p>
            <p className="text-sm text-muted-foreground">เลขที่ {r.taxInvoice.invoice.docNo}</p>
            <Button className="h-11 w-full" variant="outline" onClick={() => window.print()}>
              <Printer /> พิมพ์ / บันทึกเป็น PDF
            </Button>
          </Card>
        )}
        {r.taxInvoice.status === "pending" && (
          <Card className="p-4 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <FileText className="size-5 text-primary" /> ส่งคำขอใบกำกับภาษีแล้ว
            </p>
            <p className="mt-1 text-muted-foreground">ร้านจะออกให้เร็วๆ นี้ — กลับมาเปิดลิงก์นี้เพื่อดูและพิมพ์ใบกำกับ</p>
          </Card>
        )}
        {r.taxInvoice.canRequest && r.taxInvoice.status !== "issued" && <TaxForm token={token} pending={r.taxInvoice.status === "pending"} windowDays={r.taxInvoice.windowDays} onDone={refresh} />}

        {r.points.isMember ? (
          r.points.earned > 0 && (
            <Card className="flex items-center gap-3 p-4 text-sm">
              <Gift className="size-5 shrink-0 text-primary" /> บิลนี้ได้แต้มสะสม +{r.points.earned} แต้มแล้ว
            </Card>
          )
        ) : (
          r.points.canClaim && <PointsForm token={token} wouldEarn={r.points.wouldEarn} onDone={refresh} />
        )}

        {r.lineOaId && (
          <a
            href={`https://line.me/R/ti/p/${encodeURIComponent(r.lineOaId)}`}
            target="_blank"
            rel="noreferrer"
            className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#06C755] font-medium text-white"
          >
            <MessageCircle className="size-5" /> เพิ่มเพื่อน LINE ร้าน {r.lineOaId}
          </a>
        )}
        <p className="text-center text-xs text-muted-foreground">ขอบคุณที่อุดหนุน</p>
      </div>

      {r.taxInvoice.invoice && <TaxInvoicePrint seller={r.seller} invoice={r.taxInvoice.invoice} />}
    </main>
  );
}

function Line({ label, value, strong, muted }: { label: string; value: number; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "text-base font-semibold" : ""} ${muted ? "text-muted-foreground" : ""}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{formatMoney(value)}</dd>
    </div>
  );
}

function useSubmit<T>(action: () => Promise<T>, done: (r: T) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async () => {
    setBusy(true);
    setError("");
    try {
      done(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : "ส่งข้อมูลไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function TaxForm({ token, pending, windowDays, onDone }: { token: string; pending: boolean; windowDays: number; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", taxId: "", branchNo: "00000", address: "", email: "" });
  const valid = f.name.trim() && /^\d{13}$/.test(f.taxId) && /^\d{5}$/.test(f.branchNo) && f.address.trim().length >= 5;
  const s = useSubmit(
    () => api.post<{ status: string }>(`/public/r/${token}/tax-invoice`, { ...f, email: f.email || undefined }),
    () => onDone(),
  );
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((v) => ({ ...v, [k]: e.target.value }));
  if (!open)
    return (
      <Button variant="outline" className="h-12 w-full" onClick={() => setOpen(true)}>
        <FileText /> {pending ? "แก้ข้อมูลใบกำกับภาษี" : "ขอใบกำกับภาษีเต็มรูป"}
      </Button>
    );
  return (
    <Card className="p-4">
      <h2 className="font-medium">ขอใบกำกับภาษีเต็มรูป</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">ขอได้ภายใน {windowDays} วันหลังซื้อ — กรอกให้ตรงกับเอกสารจดทะเบียน</p>
      <form
        className="mt-3 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void s.run();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="ti-name">ชื่อ (บุคคลหรือบริษัท)</Label>
          <Input id="ti-name" value={f.name} onChange={set("name")} autoComplete="organization" maxLength={191} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ti-tax">เลขประจำตัวผู้เสียภาษี 13 หลัก</Label>
          <Input id="ti-tax" inputMode="numeric" value={f.taxId} onChange={(e) => setF((v) => ({ ...v, taxId: e.target.value.replace(/\D/g, "").slice(0, 13) }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ti-branch">รหัสสาขา (สำนักงานใหญ่ = 00000)</Label>
          <Input id="ti-branch" inputMode="numeric" value={f.branchNo} onChange={(e) => setF((v) => ({ ...v, branchNo: e.target.value.replace(/\D/g, "").slice(0, 5) }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ti-addr">ที่อยู่</Label>
          <Textarea id="ti-addr" rows={3} value={f.address} onChange={set("address")} maxLength={1000} autoComplete="street-address" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ti-mail">อีเมล (ไม่บังคับ)</Label>
          <Input id="ti-mail" type="email" value={f.email} onChange={set("email")} autoComplete="email" />
        </div>
        <FieldError message={s.error} />
        <Button type="submit" size="lg" disabled={!valid || s.busy}>
          {s.busy && <Loader2 className="animate-spin" />} ส่งคำขอ
        </Button>
      </form>
    </Card>
  );
}

function PointsForm({ token, wouldEarn, onDone }: { token: string; wouldEarn: number; onDone: () => void }) {
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState<{ earned: number; balance: number } | null>(null);
  const s = useSubmit(
    () => api.post<{ earned: number; balance: number }>(`/public/r/${token}/member`, { phone, consentMarketing: consent }),
    (r) => {
      setResult(r);
      onDone();
    },
  );
  if (result)
    return (
      <Card className="p-4 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <CheckCircle2 className="size-5 text-success" /> ได้รับ +{result.earned} แต้ม
        </p>
        <p className="mt-1 text-muted-foreground">แต้มสะสมของคุณตอนนี้ {result.balance} แต้ม</p>
      </Card>
    );
  return (
    <Card className="p-4">
      <h2 className="flex items-center gap-2 font-medium">
        <Gift className="size-5 text-primary" /> สะสมแต้มจากบิลนี้{wouldEarn > 0 ? ` (+${wouldEarn} แต้ม)` : ""}
      </h2>
      <form
        className="mt-3 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void s.run();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="pt-phone">เบอร์โทรศัพท์</Label>
          <Input id="pt-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0812345678" />
        </div>
        <label className="flex items-start gap-2 text-sm text-muted-foreground">
          <input type="checkbox" className="mt-0.5 size-5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          รับข่าวสารและโปรโมชั่นจากร้าน
        </label>
        <FieldError message={s.error} />
        <Button type="submit" size="lg" disabled={phone.replace(/\D/g, "").length < 9 || s.busy}>
          {s.busy && <Loader2 className="animate-spin" />} รับแต้ม
        </Button>
      </form>
    </Card>
  );
}

function TaxInvoicePrint({ seller, invoice }: { seller: PublicReceipt["seller"]; invoice: NonNullable<PublicReceipt["taxInvoice"]["invoice"]> }) {
  return (
    <section className="print-a4 hidden bg-white p-6 text-sm text-black print:block">
      <h2 className="text-center text-lg font-bold">ใบเสร็จรับเงิน/ใบกำกับภาษี</h2>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div>
          <p className="font-bold">{seller.name}</p>
          {seller.address && <p>{seller.address}</p>}
          {seller.taxId && (
            <p>
              เลขประจำตัวผู้เสียภาษี {seller.taxId}
              {seller.branchNo ? ` (สาขา ${seller.branchNo === "00000" ? "สำนักงานใหญ่" : seller.branchNo})` : ""}
            </p>
          )}
        </div>
        <div className="text-right">
          <p>เลขที่ {invoice.docNo}</p>
          <p>วันที่ {invoice.docDate}</p>
        </div>
      </div>
      <div className="mt-3 rounded border border-black p-2">
        <p className="font-bold">ผู้ซื้อ: {invoice.buyer.name}</p>
        <p>{invoice.buyer.address}</p>
        <p>
          เลขประจำตัวผู้เสียภาษี {invoice.buyer.taxId} (สาขา {invoice.buyer.branchNo === "00000" ? "สำนักงานใหญ่" : invoice.buyer.branchNo})
        </p>
      </div>
      <table className="mt-3 w-full border-collapse">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1">รายการ</th>
            <th className="py-1 text-right">จำนวน</th>
            <th className="py-1 text-right">ราคา/หน่วย</th>
            <th className="py-1 text-right">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((l, i) => (
            <tr key={i} className="border-b border-gray-300">
              <td className="py-1">{l.description}</td>
              <td className="py-1 text-right">{l.quantity}</td>
              <td className="py-1 text-right">{formatMoney(l.unitPrice)}</td>
              <td className="py-1 text-right">{formatMoney(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 ml-auto w-64 space-y-1">
        <p className="flex justify-between"><span>มูลค่าก่อน VAT</span><span>{formatMoney(invoice.subtotal)}</span></p>
        <p className="flex justify-between"><span>ภาษีมูลค่าเพิ่ม</span><span>{formatMoney(invoice.vat)}</span></p>
        <p className="flex justify-between border-t border-black pt-1 font-bold"><span>รวมทั้งสิ้น</span><span>{formatMoney(invoice.total)}</span></p>
      </div>
    </section>
  );
}
