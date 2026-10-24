import type { DocType } from "@/lib/types";

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  quotation: "ใบเสนอราคา",
  invoice: "ใบแจ้งหนี้",
  tax_invoice: "ใบกำกับภาษี/ใบแจ้งหนี้",
  receipt: "ใบเสร็จรับเงิน",
  tax_invoice_receipt: "ใบกำกับภาษี/ใบเสร็จรับเงิน",
  credit_note: "ใบลดหนี้",
  debit_note: "ใบเพิ่มหนี้",
  billing_note: "ใบวางบิล",
  wht_certificate: "หนังสือรับรองการหักภาษี ณ ที่จ่าย",
};

/** Types that can be created from the documents page (WHT certificates come from expenses). */
export const CREATABLE_DOC_TYPES: DocType[] = ["quotation", "invoice", "tax_invoice", "tax_invoice_receipt", "receipt", "credit_note", "debit_note", "billing_note"];

export const DOC_STATUS: Record<string, { label: string; tone: "neutral" | "primary" | "success" | "danger" | "warning" }> = {
  draft: { label: "ฉบับร่าง", tone: "neutral" },
  issued: { label: "ออกแล้ว", tone: "primary" },
  paid: { label: "ชำระแล้ว", tone: "success" },
  void: { label: "ยกเลิก", tone: "danger" },
};

export const PAYMENT_LABEL: Record<string, string> = {
  cash: "เงินสด",
  transfer: "โอนเงิน",
  card: "บัตร",
  promptpay: "PromptPay",
  cheque: "เช็ค",
  platform: "แพลตฟอร์ม",
};

export const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];
