import {
  ArrowLeftRight,
  Banknote,
  CalendarCheck,
  ClipboardList,
  FileText,
  HeartHandshake,
  Landmark,
  PackageCheck,
  Receipt,
  ShoppingBag,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { DocCategory, HubDocument } from "@/lib/types";
import { DOC_STATUS, DOC_TYPE_LABEL } from "@/components/accounting/labels";

type Tone = "neutral" | "primary" | "success" | "danger" | "warning";

export const CATEGORY: Record<DocCategory, { label: string; hint: string; icon: LucideIcon; types: string[] }> = {
  sales: {
    label: "ขาย",
    hint: "ใบเสนอราคา ใบแจ้งหนี้ ใบกำกับภาษี ใบเสร็จ ใบลด/เพิ่มหนี้ ใบวางบิล บิลหน้าร้าน",
    icon: ShoppingBag,
    types: ["quotation", "invoice", "tax_invoice", "tax_invoice_receipt", "receipt", "credit_note", "debit_note", "billing_note", "pos_sale", "pos_return"],
  },
  purchase: {
    label: "ซื้อ",
    hint: "ใบขอซื้อ ใบสั่งซื้อ ใบรับสินค้า ตั้งหนี้/ใบลดหนี้ผู้ขาย",
    icon: Truck,
    types: ["purchase_request", "purchase_order", "goods_receipt", "supplier_bill", "supplier_credit"],
  },
  stock: { label: "สต๊อก", hint: "ใบโอน ใบตรวจนับ ใบปรับสต๊อก ใบตัดของเสีย", icon: Warehouse, types: ["stock_transfer", "stock_count", "adjustment", "waste"] },
  finance: {
    label: "การเงินและภาษี",
    hint: "ใบสำคัญจ่าย เงินสดย่อย รายรับ-รายจ่าย 50 ทวิ ใบรับรองแทนใบเสร็จ",
    icon: Landmark,
    types: ["payment_voucher", "petty_cash_topup", "income", "expense", "wht_certificate", "substitute_receipt"],
  },
  hr: { label: "บุคคล", hint: "รอบเงินเดือน ใบลา ใบเบิกสวัสดิการพนักงาน", icon: HeartHandshake, types: ["payroll_run", "leave_request", "welfare"] },
};
export const CATEGORY_ORDER: DocCategory[] = ["sales", "purchase", "stock", "finance", "hr"];

const TYPE_LABEL: Record<string, string> = {
  ...DOC_TYPE_LABEL,
  purchase_request: "ใบขอซื้อ",
  purchase_order: "ใบสั่งซื้อ",
  supplier_bill: "ตั้งหนี้ผู้ขาย",
  supplier_credit: "ใบลดหนี้จากผู้ขาย",
  payment_voucher: "ใบสำคัญจ่าย",
  petty_cash_topup: "เติมเงินสดย่อย",
  goods_receipt: "ใบรับสินค้า",
  adjustment: "ใบปรับสต๊อก",
  waste: "ใบตัดของเสีย",
  stock_transfer: "ใบโอนสินค้า",
  stock_count: "ใบตรวจนับสต๊อก",
  welfare: "ใบเบิกสวัสดิการ",
  payroll_run: "รอบเงินเดือน",
  leave_request: "ใบลา",
  income: "บันทึกรายรับ",
  expense: "บันทึกรายจ่าย",
  pos_sale: "ใบเสร็จหน้าร้าน",
  pos_return: "ใบคืนสินค้าหน้าร้าน",
};
export const typeLabel = (t: string) => TYPE_LABEL[t] ?? t;

const STATUS: Partial<Record<HubDocument["source"], Record<string, { label: string; tone: Tone }>>> = {
  document: DOC_STATUS,
  purchase_order: {
    draft: { label: "ฉบับร่าง", tone: "neutral" },
    ordered: { label: "รอของ", tone: "primary" },
    partial: { label: "รับบางส่วน", tone: "warning" },
    received: { label: "รับครบ", tone: "success" },
    cancelled: { label: "ยกเลิก", tone: "danger" },
  },
  purchase_request: {
    pending: { label: "รออนุมัติ", tone: "warning" },
    approved: { label: "อนุมัติแล้ว", tone: "success" },
    rejected: { label: "ไม่อนุมัติ", tone: "danger" },
    cancelled: { label: "ยกเลิก", tone: "neutral" },
  },
  supplier_bill: {
    unpaid: { label: "ค้างจ่าย", tone: "warning" },
    paid: { label: "จ่ายแล้ว", tone: "success" },
    void: { label: "ยกเลิก", tone: "danger" },
  },
  payment_voucher: { posted: { label: "จ่ายแล้ว", tone: "success" }, void: { label: "ยกเลิก", tone: "danger" } },
  stock_transfer: {
    in_transit: { label: "ระหว่างทาง", tone: "warning" },
    received: { label: "รับแล้ว", tone: "success" },
    cancelled: { label: "ยกเลิก", tone: "danger" },
  },
  stock_count: {
    counting: { label: "กำลังนับ", tone: "primary" },
    review: { label: "รอตรวจ", tone: "warning" },
    approved: { label: "อนุมัติแล้ว", tone: "success" },
    cancelled: { label: "ยกเลิก", tone: "danger" },
  },
  welfare: {
    pending: { label: "รออนุมัติ", tone: "warning" },
    approved: { label: "อนุมัติแล้ว", tone: "success" },
    rejected: { label: "ไม่อนุมัติ", tone: "danger" },
    cancelled: { label: "ยกเลิก", tone: "neutral" },
    reversed: { label: "กลับรายการ", tone: "neutral" },
  },
  payroll_run: {
    draft: { label: "ร่าง", tone: "neutral" },
    approved: { label: "อนุมัติแล้ว รอจ่าย", tone: "primary" },
    paid: { label: "จ่ายแล้ว", tone: "success" },
    void: { label: "ยกเลิก", tone: "danger" },
  },
  leave_request: {
    pending: { label: "รออนุมัติ", tone: "warning" },
    approved: { label: "อนุมัติแล้ว", tone: "success" },
    rejected: { label: "ไม่อนุมัติ", tone: "danger" },
    cancelled: { label: "ยกเลิก", tone: "neutral" },
  },
  pos_sale: {
    completed: { label: "สำเร็จ", tone: "success" },
    paid: { label: "ชำระแล้ว", tone: "success" },
    cancelled: { label: "ยกเลิก", tone: "danger" },
    refunded: { label: "คืนเงินแล้ว", tone: "danger" },
  },
};
const GENERIC: Record<string, { label: string; tone: Tone }> = {
  done: { label: "บันทึกแล้ว", tone: "success" },
  posted: { label: "บันทึกแล้ว", tone: "success" },
  void: { label: "ยกเลิก", tone: "danger" },
  voided: { label: "ยกเลิก", tone: "danger" },
  draft: { label: "ฉบับร่าง", tone: "neutral" },
};
export const statusOf = (d: HubDocument) => STATUS[d.source]?.[d.status] ?? GENERIC[d.status] ?? { label: d.status, tone: "neutral" as Tone };

/** Where a row opens (null = shown in a dialog on the hub itself). */
export function hrefOf(d: HubDocument): string | null {
  switch (d.source) {
    case "document":
      return `/accounting/documents/${d.id}`;
    case "purchase_order":
      return `/purchasing/orders/${d.id}`;
    case "purchase_request":
      return "/purchasing?tab=requests";
    case "supplier_bill":
      return "/accounting/payables?tab=bills";
    case "payment_voucher":
      return `/accounting/payables/vouchers/${d.id}`;
    case "petty_cash_topup":
      return "/accounting/petty-cash";
    case "stock_document":
      return `/inventory/documents/${d.id}`;
    case "stock_transfer":
      return "/purchasing?tab=transfers";
    case "stock_count":
      return `/inventory/counts/${d.id}`;
    case "welfare":
      return "/inventory/welfare";
    case "payroll_run":
      return `/hr/payroll/${d.id}`;
    case "leave_request":
      return "/hr/leave?tab=approve";
    case "transaction":
      return "/accounting/transactions";
    default:
      return null;
  }
}

/** "สร้างเอกสาร": every kind of document, grouped like the tabs, each opening where it is made. */
export interface CreateItem {
  label: string;
  href: string;
  permission: string | string[];
  icon: LucideIcon;
}
export const CREATE_MENU: { category: DocCategory; items: CreateItem[] }[] = [
  {
    category: "sales",
    items: [
      ...(["quotation", "invoice", "tax_invoice", "tax_invoice_receipt", "receipt", "credit_note", "debit_note"] as const).map((t) => ({
        label: DOC_TYPE_LABEL[t],
        href: `/accounting/documents/new?type=${t}`,
        permission: "accounting:write",
        icon: FileText,
      })),
      { label: "ใบวางบิล (รวมใบแจ้งหนี้ค้างชำระ)", href: "/accounting/documents/new?type=billing_note", permission: "accounting:write", icon: Receipt },
    ],
  },
  {
    category: "purchase",
    items: [
      { label: "ใบขอซื้อ", href: "/purchasing?tab=requests", permission: ["inventory:read", "inventory:write", "purchasing:write"], icon: ClipboardList },
      { label: "ใบสั่งซื้อ", href: "/purchasing", permission: "purchasing:write", icon: Truck },
      { label: "ใบรับสินค้า (ไม่มีใบสั่งซื้อ)", href: "/inventory?action=receive", permission: "inventory:write", icon: PackageCheck },
      { label: "ตั้งหนี้ / ใบลดหนี้จากผู้ขาย", href: "/accounting/payables?new=bill", permission: "accounting:write", icon: Receipt },
    ],
  },
  {
    category: "stock",
    items: [
      { label: "ใบโอนสินค้า", href: "/inventory?action=transfer", permission: "inventory:write", icon: ArrowLeftRight },
      { label: "ใบปรับสต๊อก", href: "/inventory?action=adjust", permission: "inventory:write", icon: Warehouse },
      { label: "ใบตรวจนับสต๊อก", href: "/inventory/counts", permission: "inventory:count", icon: ClipboardList },
      { label: "ใบตัดของเสีย / หมดอายุ", href: "/inventory/expiry", permission: "inventory:write", icon: PackageCheck },
    ],
  },
  {
    category: "finance",
    items: [
      { label: "ใบสำคัญจ่าย (จ่ายเงินผู้ขาย)", href: "/accounting/payables", permission: "accounting:write", icon: Banknote },
      { label: "เติมเงินสดย่อย", href: "/accounting/petty-cash", permission: "accounting:write", icon: Banknote },
      { label: "บันทึกรายรับ / รายจ่าย", href: "/accounting/transactions", permission: "accounting:write", icon: Banknote },
      { label: "ใบรับรองแทนใบเสร็จ (จากรายจ่าย)", href: "/accounting/transactions", permission: "accounting:write", icon: Landmark },
      { label: "หนังสือรับรองหัก ณ ที่จ่าย (จากรายจ่าย)", href: "/accounting/transactions", permission: "accounting:write", icon: Landmark },
    ],
  },
  {
    category: "hr",
    items: [
      { label: "รอบเงินเดือน", href: "/hr?tab=payroll", permission: "hr:manage", icon: Users },
      { label: "ใบลา", href: "/hr/leave", permission: ["leave:request", "leave:approve", "hr:manage"], icon: CalendarCheck },
      {
        label: "ใบเบิกสวัสดิการพนักงาน",
        href: "/inventory/welfare",
        permission: ["welfare:request", "inventory:write", "inventory:approve"],
        icon: HeartHandshake,
      },
    ],
  },
];

/** Reports that belong with each category, shown under the list. */
export const RELATED: Partial<Record<DocCategory, { label: string; href: string; permission: string }[]>> = {
  sales: [{ label: "ใบแจ้งหนี้ค้างรับชำระ", href: "/documents?category=sales&status=issued", permission: "accounting:read" }],
  stock: [{ label: "รายงานสินค้าและวัตถุดิบ (ม.87(3))", href: "/accounting/reports?tab=stock", permission: "accounting:read" }],
  purchase: [{ label: "ยอดค้างจ่ายผู้ขาย", href: "/accounting/payables", permission: "accounting:read" }],
  finance: [
    { label: "เงินสดย่อย", href: "/accounting/petty-cash", permission: "accounting:read" },
    { label: "ภ.พ.30 / ภ.ง.ด. / รายงานภาษีซื้อ-ขาย", href: "/accounting/tax", permission: "accounting:read" },
    { label: "รายงานการเงิน", href: "/accounting/reports", permission: "accounting:read" },
  ],
  hr: [{ label: "ภ.ง.ด.1 / ประกันสังคม / ภ.ง.ด.1ก", href: "/hr?tab=reports", permission: "hr:manage" }],
};
