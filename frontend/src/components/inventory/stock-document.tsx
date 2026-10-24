"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { api } from "@/lib/api";
import type { StockDocument } from "@/lib/types";
import { formatDateTime, formatThaiDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";

const TITLE: Record<StockDocument["docType"], string> = { goods_receipt: "ใบรับสินค้า", adjustment: "ใบปรับปรุงสต๊อก", waste: "ใบตัดของเสีย" };
const n2 = (v: number) => v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: number) => v.toLocaleString("th-TH", { maximumFractionDigits: 3 });

/** ใบรับสินค้า (GR) / ใบปรับสต๊อก (AJ) / ใบตัดของเสีย (WS): view and print on A4. */
export function StockDocumentView({ id }: { id: number }) {
  const doc = useQuery({ queryKey: ["inventory", "document", id], queryFn: () => api.get<StockDocument>(`/inventory/documents/${id}`) });
  if (doc.isPending) return <Skeleton className="h-[70vh] w-full rounded-xl" />;
  if (doc.isError) return <p className="py-16 text-center text-muted-foreground">{doc.error.message}</p>;
  const d = doc.data;
  const signed = d.docType === "adjustment";
  return (
    <>
      <div className="mb-4 flex flex-col gap-3 print:hidden sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/documents?category=stock" className="inline-flex min-h-10 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> ศูนย์เอกสาร
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">
            {TITLE[d.docType]} {d.docNo}
          </h1>
        </div>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer /> พิมพ์ / PDF
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl bg-muted/50 p-2 sm:p-6 print:bg-transparent print:p-0">
        <article className="print-a4 relative mx-auto w-full max-w-[210mm] bg-white p-8 text-[13px] leading-relaxed text-neutral-900 shadow-sm ring-1 ring-black/5 max-sm:p-5 sm:p-12">
          <header className="flex flex-col gap-6 sm:flex-row sm:justify-between">
            <div className="max-w-sm">
              <p className="text-lg font-bold">{d.org.legalName || d.org.name}</p>
              {d.org.address && <p>{d.org.address}</p>}
              {d.org.taxId && <p>เลขประจำตัวผู้เสียภาษี {d.org.taxId}</p>}
            </div>
            <div className="sm:text-right">
              <p className="text-xl font-bold">{TITLE[d.docType]}</p>
              <dl className="mt-3 grid grid-cols-[auto_auto] justify-start gap-x-4 sm:justify-end">
                <dt className="text-neutral-500">เลขที่</dt>
                <dd className="font-semibold">{d.docNo}</dd>
                <dt className="text-neutral-500">วันที่</dt>
                <dd>{formatThaiDate(d.docDate)}</dd>
                <dt className="text-neutral-500">คลัง</dt>
                <dd>{d.warehouseName}</dd>
                {d.poNo && (
                  <>
                    <dt className="text-neutral-500">ใบสั่งซื้อ</dt>
                    <dd>{d.poNo}</dd>
                  </>
                )}
                {d.reference && (
                  <>
                    <dt className="text-neutral-500">เลขที่ใบส่งของ</dt>
                    <dd>{d.reference}</dd>
                  </>
                )}
              </dl>
            </div>
          </header>

          {(d.supplierName || d.reason) && (
            <section className="mt-6 rounded-md border border-neutral-300 p-4">
              {d.supplierName ? (
                <>
                  <p className="text-xs text-neutral-500">ผู้ขาย</p>
                  <p className="font-semibold">{d.supplierName}</p>
                  {d.supplierTaxId && <p>เลขประจำตัวผู้เสียภาษี {d.supplierTaxId}</p>}
                </>
              ) : (
                <>
                  <p className="text-xs text-neutral-500">เหตุผล</p>
                  <p className="font-semibold">{d.reason}</p>
                </>
              )}
            </section>
          )}

          <div className="-mx-5 mt-6 overflow-x-auto px-5 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[540px] border-collapse text-[12.5px] sm:min-w-0">
              <thead>
                <tr className="border-y border-neutral-400 bg-neutral-100 text-left">
                  <th className="w-10 px-2 py-2 font-semibold">#</th>
                  <th className="px-2 py-2 font-semibold">รหัส</th>
                  <th className="px-2 py-2 font-semibold">สินค้า</th>
                  <th className="w-24 px-2 py-2 text-right font-semibold">{signed ? "เพิ่ม/ลด" : "จำนวน"}</th>
                  <th className="w-28 px-2 py-2 text-right font-semibold">ต้นทุน/หน่วย</th>
                  <th className="w-32 px-2 py-2 text-right font-semibold">มูลค่า</th>
                </tr>
              </thead>
              <tbody>
                {d.lines.map((l, i) => (
                  <tr key={`${l.productId}-${i}`} className="border-b border-neutral-200 align-top">
                    <td className="px-2 py-2">{i + 1}</td>
                    <td className="px-2 py-2">{l.sku}</td>
                    <td className="px-2 py-2">{l.name}</td>
                    <td className="px-2 py-2 text-right">
                      {signed && l.quantity > 0 ? "+" : ""}
                      {qty(signed ? l.quantity : Math.abs(l.quantity))} {l.unit}
                    </td>
                    <td className="px-2 py-2 text-right">{l.unitCost == null ? "-" : n2(l.unitCost)}</td>
                    <td className="px-2 py-2 text-right">{n2(l.value)}</td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td className="px-2 py-2" colSpan={5}>
                    รวมมูลค่า
                  </td>
                  <td className="px-2 py-2 text-right">{n2(d.totalCost)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {d.note && <p className="mt-3 text-xs text-neutral-600">หมายเหตุ: {d.note}</p>}
          <p className="mt-3 text-xs text-neutral-500">
            บันทึกโดย {d.createdBy ?? "-"} · {formatDateTime(d.createdAt)}
          </p>

          <footer className="mt-16 grid grid-cols-2 gap-10 text-center text-xs">
            {[d.docType === "goods_receipt" ? "ผู้รับสินค้า" : "ผู้บันทึก", d.docType === "goods_receipt" ? "ผู้ตรวจสอบ" : "ผู้อนุมัติ"].map((label) => (
              <div key={label}>
                <div className="mx-auto mb-2 h-10 w-48 border-b border-dotted border-neutral-500" />
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
