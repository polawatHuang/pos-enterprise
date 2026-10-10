"use client";

import type { PosOrder, PosSettings } from "@/lib/types";
import { formatMoney } from "@/lib/utils";

export const METHOD_LABEL: Record<string, string> = {
  cash: "เงินสด",
  promptpay: "PromptPay",
  card: "บัตร",
  transfer: "โอนเงิน",
  platform: "แพลตฟอร์ม",
};

/**
 * 80mm thermal-printer receipt. Printed via window.print(); the global print stylesheet
 * hides everything except `.print-receipt`.
 */
export function Receipt({ order, settings }: { order: PosOrder; settings?: PosSettings }) {
  const org = settings?.org;
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
                  {i.quantity} x {i.unitPrice.toFixed(2)}
                  {i.discount > 0 ? ` ลด ${i.discount.toFixed(2)}` : ""}
                </span>
              </td>
              <td className="text-right">{i.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="my-2 border-t border-dashed border-black" />
      <Row label="รวม" value={order.subtotal} />
      {order.discount > 0 && <Row label="ส่วนลด" value={-order.discount} />}
      <Row label="ยอดสุทธิ" value={order.total} bold />
      {org?.vatRegistered && (
        <>
          <Row label="มูลค่าก่อน VAT" value={order.total - order.vatAmount} />
          <Row label="VAT 7%" value={order.vatAmount} />
        </>
      )}
      <div className="my-2 border-t border-dashed border-black" />
      {paid.map((p, i) => (
        <Row key={i} label={METHOD_LABEL[p.method] ?? p.method} value={p.method === "cash" && order.change ? p.amount + order.change : p.amount} />
      ))}
      {!!order.change && <Row label="เงินทอน" value={order.change} />}
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
