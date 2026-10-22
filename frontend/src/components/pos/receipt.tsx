"use client";

import type { PosOrder, PosSettings } from "@/lib/types";
import { formatMoney } from "@/lib/utils";
import { useTaxSettings } from "@/lib/tax";

export const METHOD_LABEL: Record<string, string> = {
  cash: "เงินสด",
  promptpay: "PromptPay",
  card: "บัตร",
  transfer: "โอนเงิน",
  ewallet: "e-Wallet",
  platform: "แพลตฟอร์ม",
  split: "แบ่งจ่าย",
};

/**
 * 80mm thermal-printer receipt. Printed via window.print(); the global print stylesheet
 * hides everything except `.print-receipt`.
 */
export function Receipt({ order, settings }: { order: PosOrder; settings?: PosSettings }) {
  const org = settings?.org;
  const { tax } = useTaxSettings();
  const paid = order.payments.filter((p) => p.amount > 0);
  const voided = order.status === "cancelled";
  return (
    <div className="print-receipt mx-auto w-full max-w-[300px] bg-white p-4 font-mono text-[12px] leading-snug text-black">
      <div className="text-center">
        <p className="text-[14px] font-bold">{org?.legalName || org?.name || "ใบเสร็จรับเงิน"}</p>
        {org?.address && <p>{org.address}</p>}
        {org?.taxId && (
          <p>
            เลขประจำตัวผู้เสียภาษี {org.taxId}
            {order.branchNo ? ` (สาขา ${order.branchNo === "00000" ? "สำนักงานใหญ่" : order.branchNo})` : ""}
          </p>
        )}
        <p className="mt-1 font-bold">{org?.vatRegistered ? "ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ" : "ใบเสร็จรับเงิน"}</p>
        {voided && <p className="mt-1 border border-black font-bold">*** ยกเลิกแล้ว ***</p>}
      </div>
      <div className="my-2 border-t border-dashed border-black" />
      <p>เลขที่ {order.orderNo}</p>
      <p>{new Date(order.orderedAt).toLocaleString("th-TH")}</p>
      <p>
        {order.branchName} · พนักงาน {order.cashierName}
      </p>
      <div className="my-2 border-t border-dashed border-black" />
      <table className="w-full">
        <tbody>
          {order.items.map((i, idx) => (
            <tr key={idx} className="align-top">
              <td className="pr-2">
                {i.name}
                <br />
                <span className="text-[11px]">
                  {i.quantity}
                  {i.unitName ? ` ${i.unitName}` : ""} x {i.unitPrice.toFixed(2)}
                  {i.discount - (i.promoDiscount ?? 0) > 0.004 ? ` ลด ${(i.discount - (i.promoDiscount ?? 0)).toFixed(2)}` : ""}
                </span>
                {(i.promoDiscount ?? 0) > 0 && (
                  <span className="block text-[11px]">
                    โปร {i.promotionName ?? ""} -{i.promoDiscount.toFixed(2)}
                  </span>
                )}
              </td>
              <td className="text-right">{i.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="my-2 border-t border-dashed border-black" />
      <Row label="รวม" value={order.subtotal} />
      {order.discount - (order.codeDiscount ?? 0) > 0 && <Row label="ส่วนลด" value={-(order.discount - (order.codeDiscount ?? 0))} />}
      {order.codeDiscount > 0 && <Row label={`โค้ด ${order.discountCode ?? ""}`} value={-order.codeDiscount} />}
      <Row label="ยอดสุทธิ" value={order.total} bold />
      {org?.vatRegistered && (
        <>
          <Row label="มูลค่าก่อน VAT" value={order.total - order.vatAmount} />
          <Row label={`VAT ${tax.vatRate}%`} value={order.vatAmount} />
        </>
      )}
      <div className="my-2 border-t border-dashed border-black" />
      {paid.map((p, i) => (
        <Row key={i} label={METHOD_LABEL[p.method] ?? p.method} value={p.method === "cash" && order.change ? p.amount + order.change : p.amount} />
      ))}
      {!!order.change && <Row label="เงินทอน" value={order.change} />}
      {order.customerName && (
        <>
          <div className="my-2 border-t border-dashed border-black" />
          <p>สมาชิก {order.customerName}</p>
          {order.pointsUsed > 0 && <p>ใช้แต้ม {order.pointsUsed.toLocaleString("th-TH")} แต้ม</p>}
          {order.pointsEarned > 0 && <p>ได้รับแต้ม +{order.pointsEarned.toLocaleString("th-TH")} แต้ม</p>}
          {order.customerPoints !== null && <p>แต้มคงเหลือ {order.customerPoints.toLocaleString("th-TH")} แต้ม</p>}
        </>
      )}
      {order.returns?.length > 0 && (
        <>
          <div className="my-2 border-t border-dashed border-black" />
          <p className="font-bold">รายการคืนสินค้า</p>
          {order.returns.map((r) => (
            <div key={r.id}>
              <Row label={`${r.returnNo} (${METHOD_LABEL[r.refundMethod] ?? r.refundMethod})`} value={-r.refundAmount} />
              {r.items.map((i, idx) => (
                <p key={idx} className="pl-2 text-[11px]">
                  {i.name} x {i.quantity}
                </p>
              ))}
            </div>
          ))}
          <Row label="คงเหลือสุทธิ" value={order.total - order.refundedAmount} bold />
        </>
      )}
      <p className="mt-3 text-center">{settings?.receiptFooter || "ขอบคุณที่อุดหนุน"}</p>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <p className={`flex justify-between ${bold ? "text-[14px] font-bold" : ""}`}>
      <span>{label}</span>
      <span>{formatMoney(value).replace("฿", "")}</span>
    </p>
  );
}
