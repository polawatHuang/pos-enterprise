"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, FileCheck2, Printer } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { PaymentVoucher } from "@/lib/types";
import { formatThaiDate } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { PAYMENT_LABEL } from "./labels";

const n2 = (v: number) => v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ใบสำคัญจ่าย: what was paid to a supplier and for which bills; A4 print, 50 ทวิ, cancel. */
export function VoucherDetail({ id }: { id: number }) {
  const { can } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const key = ["accounting", "payables", "voucher", id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<PaymentVoucher>(`/accounting/payables/vouchers/${id}`) });
  if (q.isPending) return <Skeleton className="h-[70vh] w-full rounded-xl" />;
  if (q.isError) return <p className="py-16 text-center text-muted-foreground">{q.error.message}</p>;
  const v = q.data;
  const writable = can("accounting:write");

  const certificate = async () => {
    if (v.certificateId) return router.push(`/accounting/documents/${v.certificateId}`);
    try {
      const r = await api.post<{ documentId: number }>(`/accounting/payables/vouchers/${id}/wht-certificate`, {});
      void qc.invalidateQueries({ queryKey: ["accounting"] });
      router.push(`/accounting/documents/${r.documentId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ออกหนังสือรับรองไม่สำเร็จ");
    }
  };
  const voidIt = async () => {
    const reason = window.prompt(`ยกเลิก ${v.pvNo} — เหตุผล (รายการที่จ่ายจะกลับเป็นค้างจ่าย)`);
    if (!reason) return;
    try {
      await api.post(`/accounting/payables/vouchers/${id}/void`, { reason });
      toast.success("ยกเลิกและกลับรายการบัญชีแล้ว");
      void qc.invalidateQueries({ queryKey: ["accounting"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ยกเลิกไม่สำเร็จ");
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 print:hidden lg:flex-row lg:items-center lg:justify-between">
        <div>
          <Link
            href="/accounting/payables?tab=vouchers"
            className="inline-flex min-h-10 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> เจ้าหนี้ & จ่ายเงิน
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">ใบสำคัญจ่าย {v.pvNo}</h1>
            <Badge tone={v.status === "void" ? "danger" : "success"}>{v.status === "void" ? "ยกเลิก" : "จ่ายแล้ว"}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer /> พิมพ์ / PDF
          </Button>
          {v.whtAmount > 0 && v.status === "posted" && (writable || v.certificateId) && (
            <Button variant="outline" onClick={() => void certificate()}>
              <FileCheck2 /> {v.certificateId ? "ดู 50 ทวิ" : "ออกหนังสือรับรอง 50 ทวิ"}
            </Button>
          )}
          {writable && v.status === "posted" && (
            <Button variant="ghost" className="text-danger" onClick={() => void voidIt()}>
              <Ban /> ยกเลิก
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-muted/50 p-2 sm:p-6 print:bg-transparent print:p-0">
        <article className="print-a4 relative mx-auto w-full max-w-[210mm] bg-white p-8 text-[13px] leading-relaxed text-neutral-900 shadow-sm ring-1 ring-black/5 max-sm:p-5 sm:p-12">
          <header className="flex flex-col gap-6 sm:flex-row sm:justify-between">
            <div className="max-w-sm">
              <p className="text-lg font-bold">{v.org?.legalName || v.org?.name}</p>
              {v.org?.address && <p>{v.org.address}</p>}
              {v.org?.taxId && <p>เลขประจำตัวผู้เสียภาษี {v.org.taxId}</p>}
            </div>
            <div className="sm:text-right">
              <p className="text-xl font-bold">ใบสำคัญจ่าย</p>
              <dl className="mt-3 grid grid-cols-[auto_auto] justify-start gap-x-4 sm:justify-end">
                <dt className="text-neutral-500">เลขที่</dt>
                <dd className="font-semibold">{v.pvNo}</dd>
                <dt className="text-neutral-500">วันที่จ่าย</dt>
                <dd>{formatThaiDate(v.payDate)}</dd>
                <dt className="text-neutral-500">จ่ายโดย</dt>
                <dd>
                  {PAYMENT_LABEL[v.paymentMethod] ?? v.paymentMethod}
                  {v.reference ? ` (${v.reference})` : ""}
                </dd>
              </dl>
            </div>
          </header>
          <section className="mt-6 rounded-md border border-neutral-300 p-4">
            <p className="text-xs text-neutral-500">จ่ายให้</p>
            <p className="font-semibold">{v.supplierName}</p>
            {v.supplierAddress && <p>{v.supplierAddress}</p>}
            {v.supplierTaxId && <p>เลขประจำตัวผู้เสียภาษี {v.supplierTaxId}</p>}
          </section>
          <div className="-mx-5 mt-6 overflow-x-auto px-5 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[540px] border-collapse text-[12.5px] sm:min-w-0">
              <thead>
                <tr className="border-y border-neutral-400 bg-neutral-100 text-left">
                  <th className="w-10 px-2 py-2 font-semibold">#</th>
                  <th className="px-2 py-2 font-semibold">รายการ</th>
                  <th className="px-2 py-2 font-semibold">เลขที่เอกสารผู้ขาย</th>
                  <th className="px-2 py-2 font-semibold">ลงวันที่</th>
                  <th className="w-32 px-2 py-2 text-right font-semibold">จำนวนเงิน</th>
                </tr>
              </thead>
              <tbody>
                {v.bills?.map((b, i) => (
                  <tr key={b.id} className="border-b border-neutral-200">
                    <td className="px-2 py-2">{i + 1}</td>
                    <td className="px-2 py-2">
                      {b.kind === "credit_note" ? "หักใบลดหนี้" : "ชำระตามใบแจ้งหนี้"} {b.billNo}
                    </td>
                    <td className="px-2 py-2">{b.supplierDocNo ?? "-"}</td>
                    <td className="px-2 py-2">{formatThaiDate(b.billDate)}</td>
                    <td className="px-2 py-2 text-right">{n2(b.signedTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section className="mt-4 flex flex-col-reverse gap-6 sm:flex-row sm:justify-between">
            <p className="max-w-sm self-start rounded-md bg-neutral-100 px-3 py-2 font-semibold">({v.amountText})</p>
            <dl className="grid min-w-64 grid-cols-[1fr_auto] gap-x-6 gap-y-1">
              <dt>รวมตามเอกสาร</dt>
              <dd className="text-right">{n2(v.gross)}</dd>
              {v.whtAmount > 0 && (
                <>
                  <dt>
                    หักภาษี ณ ที่จ่าย {v.whtRate}% ({v.payeeType === "individual" ? "ภ.ง.ด.3" : "ภ.ง.ด.53"})
                  </dt>
                  <dd className="text-right">-{n2(v.whtAmount)}</dd>
                </>
              )}
              <dt className="border-t border-neutral-400 pt-1 font-bold">จ่ายสุทธิ</dt>
              <dd className="border-t border-neutral-400 pt-1 text-right font-bold">{n2(v.netPaid)}</dd>
            </dl>
          </section>
          {v.note && <p className="mt-3 text-xs text-neutral-600">หมายเหตุ: {v.note}</p>}
          <footer className="mt-16 grid grid-cols-3 gap-6 text-center text-xs">
            {["ผู้จัดทำ", "ผู้อนุมัติ", "ผู้รับเงิน"].map((label) => (
              <div key={label}>
                <div className="mx-auto mb-2 h-10 w-40 border-b border-dotted border-neutral-500" />
                <p>{label}</p>
                <p className="mt-1 text-neutral-500">วันที่ ......../......../........</p>
              </div>
            ))}
          </footer>
        </article>
      </div>
    </>
  );
}
