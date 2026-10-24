import type { PosOrder, PosSettings, ShiftReport } from "@/lib/types";
import type { TaxSettings } from "@/lib/tax";
import { formatMoney, formatNumber } from "@/lib/utils";

/**
 * A receipt as a list of blocks: the on-screen/print-dialog receipt (HTML) and the USB thermal
 * printer (canvas → ESC/POS raster) both draw from this, so they always say the same thing.
 */
export type ReceiptBlock =
  | { kind: "text"; text: string; align?: "left" | "center"; bold?: boolean; big?: boolean; small?: boolean; boxed?: boolean; strike?: boolean }
  | { kind: "row"; left: string; right: string; bold?: boolean; big?: boolean; small?: boolean; strike?: boolean }
  | { kind: "rule" }
  | { kind: "qr"; data: string; caption?: string };

export const METHOD_LABEL: Record<string, string> = {
  cash: "เงินสด",
  promptpay: "PromptPay",
  card: "บัตร",
  transfer: "โอนเงิน",
  ewallet: "e-Wallet",
  platform: "แพลตฟอร์ม",
  split: "แบ่งจ่าย",
};

const money = (v: number) => formatMoney(v).replace("฿", "");
const row = (left: string, value: number, opts: { bold?: boolean; big?: boolean; strike?: boolean } = {}): ReceiptBlock => ({ kind: "row", left, right: money(value), ...opts });

export function receiptDoc(order: PosOrder, settings: PosSettings | undefined, tax: Pick<TaxSettings, "vatRate">): ReceiptBlock[] {
  const org = settings?.org;
  const b: ReceiptBlock[] = [];
  const voided = order.status === "cancelled";
  b.push({ kind: "text", text: org?.legalName || org?.name || "ใบเสร็จรับเงิน", align: "center", bold: true, big: true });
  if (org?.address) b.push({ kind: "text", text: org.address, align: "center" });
  if (org?.taxId) {
    const branch = order.branchNo ? ` (สาขา ${order.branchNo === "00000" ? "สำนักงานใหญ่" : order.branchNo})` : "";
    b.push({ kind: "text", text: `เลขประจำตัวผู้เสียภาษี ${org.taxId}${branch}`, align: "center" });
  }
  b.push({ kind: "text", text: org?.vatRegistered ? "ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ" : "ใบเสร็จรับเงิน", align: "center", bold: true });
  if (voided) b.push({ kind: "text", text: "*** ยกเลิกแล้ว ***", align: "center", bold: true, boxed: true });
  b.push({ kind: "rule" });
  b.push({ kind: "text", text: `เลขที่ ${order.orderNo}` });
  b.push({ kind: "text", text: new Date(order.orderedAt).toLocaleString("th-TH") });
  b.push({ kind: "text", text: `${order.branchName ?? ""} · พนักงาน ${order.cashierName ?? ""}` });
  b.push({ kind: "rule" });
  for (const i of order.items) {
    b.push({ kind: "row", left: i.name, right: i.lineTotal.toFixed(2) });
    const manual = i.discount - (i.promoDiscount ?? 0);
    b.push({
      kind: "text",
      small: true,
      text: `  ${formatNumber(i.quantity)}${i.unitName ? ` ${i.unitName}` : ""} x ${i.unitPrice.toFixed(2)}${manual > 0.004 ? ` ลด ${manual.toFixed(2)}` : ""}`,
    });
    if ((i.promoDiscount ?? 0) > 0) b.push({ kind: "text", small: true, text: `  โปร ${i.promotionName ?? ""} -${i.promoDiscount.toFixed(2)}` });
  }
  b.push({ kind: "rule" });
  b.push(row("รวม", order.subtotal));
  const billDiscount = order.discount - (order.codeDiscount ?? 0);
  if (billDiscount > 0) b.push(row("ส่วนลด", -billDiscount));
  if (order.codeDiscount > 0) b.push(row(`โค้ด ${order.discountCode ?? ""}`, -order.codeDiscount));
  b.push(row("ยอดสุทธิ", order.total, { bold: true, big: true }));
  if (org?.vatRegistered) {
    b.push(row("มูลค่าก่อน VAT", order.total - order.vatAmount));
    b.push(row(`VAT ${tax.vatRate}%`, order.vatAmount));
  }
  b.push({ kind: "rule" });
  for (const p of order.payments.filter((x) => x.amount > 0)) {
    b.push(row(METHOD_LABEL[p.method] ?? p.method, p.method === "cash" && order.change ? p.amount + order.change : p.amount));
  }
  if (order.change) b.push(row("เงินทอน", order.change));
  if (order.customerName) {
    b.push({ kind: "rule" });
    b.push({ kind: "text", text: `สมาชิก ${order.customerName}` });
    if (order.pointsUsed > 0) b.push({ kind: "text", text: `ใช้แต้ม ${order.pointsUsed.toLocaleString("th-TH")} แต้ม` });
    if (order.pointsEarned > 0) b.push({ kind: "text", text: `ได้รับแต้ม +${order.pointsEarned.toLocaleString("th-TH")} แต้ม` });
    if (order.customerPoints !== null) b.push({ kind: "text", text: `แต้มคงเหลือ ${order.customerPoints.toLocaleString("th-TH")} แต้ม` });
  }
  if (order.returns?.length) {
    b.push({ kind: "rule" });
    b.push({ kind: "text", text: "รายการคืนสินค้า", bold: true });
    for (const r of order.returns) {
      b.push(row(`${r.returnNo} (${METHOD_LABEL[r.refundMethod] ?? r.refundMethod})${r.voided ? " ยกเลิก" : ""}`, -r.refundAmount, { strike: r.voided }));
      for (const i of r.items) b.push({ kind: "text", small: true, strike: r.voided, text: `  ${i.name} x ${i.quantity}` });
    }
    b.push(row("คงเหลือสุทธิ", order.total - order.refundedAmount, { bold: true }));
  }
  b.push({ kind: "text", text: settings?.receiptFooter || "ขอบคุณที่อุดหนุน", align: "center" });
  return b;
}

export function shiftReportDoc(report: ShiftReport, methodLabel: Record<string, string> = METHOD_LABEL): ReceiptBlock[] {
  const c = report.stats.cash;
  const b: ReceiptBlock[] = [];
  b.push({ kind: "text", text: report.kind === "Z" ? "สรุปปิดกะ" : "สรุประหว่างกะ", align: "center", bold: true, big: true });
  b.push({ kind: "text", text: report.branchName, align: "center" });
  b.push({ kind: "text", text: `พนักงาน ${report.cashierName}` });
  b.push({ kind: "text", text: `เปิด ${new Date(report.openedAt).toLocaleString("th-TH")}` });
  if (report.closedAt) b.push({ kind: "text", text: `ปิด ${new Date(report.closedAt).toLocaleString("th-TH")}` });
  b.push({ kind: "rule" });
  b.push({ kind: "row", left: "จำนวนบิล", right: String(report.stats.orders) });
  b.push(row("ยอดขายสุทธิ", report.stats.sales));
  b.push(row("ส่วนลดท้ายบิล", report.discount));
  if (report.promoDiscount > 0) b.push(row("ส่วนลดโปรโมชั่น", report.promoDiscount));
  b.push(row("VAT", report.vat));
  if (report.stats.voided > 0) b.push({ kind: "row", left: "บิลยกเลิก", right: String(report.stats.voided) });
  if (report.pointsUsed > 0) b.push({ kind: "row", left: "แต้มที่ใช้", right: String(report.pointsUsed) });
  b.push({ kind: "rule" });
  for (const [m, v] of Object.entries(report.stats.byMethod)) b.push(row(methodLabel[m] ?? m, v));
  b.push({ kind: "rule" });
  b.push(row("เงินทอนตั้งต้น", report.openingCash));
  if (c.pay_in > 0) b.push(row("นำเงินเข้า", c.pay_in));
  if (c.pay_out > 0) b.push(row("จ่ายออก", -c.pay_out));
  if (c.pickup > 0) b.push(row("นำเข้าตู้เซฟ", -c.pickup));
  b.push(row("เงินสดที่ควรมี", report.expectedCash, { bold: true }));
  if (report.closingCash !== null) {
    b.push(row("นับได้จริง", report.closingCash));
    b.push(row((report.difference ?? 0) >= 0 ? "เกิน" : "ขาด", Math.abs(report.difference ?? 0), { bold: true }));
    if (report.note) b.push({ kind: "text", text: `สาเหตุ: ${report.note}` });
  }
  if (report.topItems.length > 0) {
    b.push({ kind: "rule" });
    b.push({ kind: "text", text: "ขายดีในกะ", bold: true });
    for (const t of report.topItems.slice(0, 5)) b.push(row(`${t.name} x${formatNumber(t.quantity)}`, t.amount));
  }
  return b;
}
