export type Permission = string;

export interface User {
  id: number;
  orgId: number;
  branchId: number | null;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  mustChangePassword: boolean;
  roles: string[];
  permissions: Permission[];
}

export interface Branch {
  id: number;
  code: string;
  name: string;
  branchNo: string;
  isActive: boolean;
}

export interface Role {
  code: string;
  name: string;
  description: string | null;
  permissions: Permission[];
}

export interface UserRow {
  id: number;
  email: string;
  fullName: string;
  phone: string | null;
  status: "active" | "disabled";
  branchId: number | null;
  branchName: string | null;
  roles: string[];
  lastLoginAt: string | null;
  createdAt: string;
}

export interface DashboardSummary {
  today: { revenue: number; orders: number; grossProfit: number };
  yesterdaySamePeriod: { revenue: number; orders: number };
  monthToDate: {
    revenue: number;
    orders: number;
    grossProfit: number;
    otherIncome: number;
    expenses: number;
    netProfit: number;
    avgOrderValue: number;
  };
  previousMonthToDate: { revenue: number; orders: number; grossProfit: number };
  inbox: { open: number; needsHuman: number; unread: number };
  inventory: { lowStock: number };
  social: { scheduled: number; published7d: number; failed: number };
  video: { inProgress: number; ready: number };
}

export interface TrendPoint {
  date: string;
  revenue: number;
  orders: number;
  grossProfit: number;
}

export interface ChannelMix {
  channel: string;
  revenue: number;
  orders: number;
}

export interface TopProduct {
  id: number;
  sku: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
  revenue: number;
  profit: number;
}

export interface CashflowPoint {
  month: string;
  income: number;
  expense: number;
  net: number;
}

export interface LowStockItem {
  id: number;
  sku: string;
  name: string;
  unit: string;
  onHand: number;
  reorderPoint: number;
}

export interface InboxChannel {
  platform: string;
  open: number;
  unread: number;
}

export interface TrendingProduct {
  id: number;
  platform: string;
  title: string;
  url: string | null;
  imageUrl: string | null;
  price: number | null;
  soldCount: number | null;
  commissionRate: number | null;
  trendScore: number | null;
}

export interface ActivityItem {
  kind: "order" | "conversation" | "post" | "expense";
  refId: number;
  title: string;
  detail: string | null;
  amount: number | null;
  at: string;
}

export interface IntegrationStatus {
  id: string;
  name: string;
  category: string;
  usedBy: string[];
  phase: number;
  purpose: string;
  applyUrl: string;
  configured: boolean;
  env: { name: string; optional: boolean; set: boolean }[];
}

/* ------------------------------------------------------------- Phase 2 */

export type VatType = "vat7" | "exempt" | "zero";
export type ProductStatus = "active" | "draft" | "archived";

export interface Product {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  categoryId: number | null;
  categoryName: string | null;
  description: string | null;
  sellingPoints: string | null;
  unit: string;
  price: number;
  cost: number;
  vatType: VatType;
  reorderPoint: number;
  imageUrl: string | null;
  status: ProductStatus;
  onHand: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductDetail extends Product {
  stock: { warehouseId: number; code: string; name: string; quantity: number }[];
}

export interface Category {
  id: number;
  name: string;
  parentId: number | null;
  sortOrder: number;
  productCount: number;
}

export interface KnowledgeEntry {
  id: number;
  kind: "faq" | "policy" | "objection" | "usage" | "other";
  question: string | null;
  answer: string;
  createdAt: string;
}

export interface Warehouse {
  id: number;
  code: string;
  name: string;
  branchId: number | null;
  branchName: string | null;
  totalUnits: number;
  stockValue: number;
}

export interface StockLevel {
  productId: number;
  sku: string;
  name: string;
  unit: string;
  cost: number;
  price: number;
  reorderPoint: number;
  quantity: number;
  value: number;
}

export type MovementType = "purchase" | "sale" | "return" | "adjustment" | "transfer_in" | "transfer_out" | "opening";

export interface StockMovement {
  id: number;
  type: MovementType;
  quantity: number;
  unitCost: number | null;
  refType: string | null;
  refId: number | null;
  note: string | null;
  createdAt: string;
  productId: number;
  sku: string;
  productName: string;
  warehouseName: string;
  userName: string | null;
}

export interface Paged<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

export interface CatalogItem {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  price: number;
  unit: string;
  imageUrl: string | null;
  categoryId: number | null;
  vatType: VatType;
  stock: number;
}

export type PaymentMethod = "cash" | "promptpay" | "card" | "transfer";

export interface Shift {
  id: number;
  branchId: number;
  branchName: string;
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  closingCash: number | null;
  expectedCash: number;
  difference?: number;
  stats: { orders: number; sales: number; voided: number; byMethod: Record<string, number> };
}

export interface PosOrder {
  id: number;
  orderNo: string;
  channel: string;
  status: string;
  shiftId: number | null;
  branchName: string | null;
  branchNo: string | null;
  cashierName: string | null;
  customerName: string | null;
  subtotal: number;
  discount: number;
  vatAmount: number;
  total: number;
  orderedAt: string;
  change?: number;
  items: { productId: number; name: string; quantity: number; unitPrice: number; discount: number; lineTotal: number }[];
  payments: { method: string; amount: number; reference: string | null; paidAt: string }[];
}

export interface PosOrderRow {
  id: number;
  orderNo: string;
  status: string;
  total: number;
  orderedAt: string;
  cashierName: string | null;
  method: string | null;
  items: number;
}

export interface PosSettings {
  promptpayId: string;
  receiptFooter: string;
  maxDiscountPct: number;
  promptpayEnabled: boolean;
  org: { name: string; legalName: string | null; taxId: string | null; address: string | null; phone: string | null; vatRegistered: boolean };
}

/* ------------------------------------------------------------- Phase 3 */

export type TxnType = "income" | "expense";
export type VatMode = "none" | "exclusive" | "inclusive";

export interface Transaction {
  id: number;
  type: TxnType;
  category: string;
  amount: number;
  vatAmount: number;
  vatClaimable: boolean;
  whtAmount: number;
  whtRate: number | null;
  whtIncomeType: string | null;
  netAmount: number;
  txnDate: string;
  description: string;
  counterparty: string | null;
  counterpartyTaxId: string | null;
  counterpartyType: "individual" | "company" | null;
  paymentMethod: string | null;
  status: "posted" | "void";
  aiExtracted: boolean;
  whtCertificateId: number | null;
  createdBy: string | null;
  createdAt: string;
}

export interface TxnMeta {
  categories: Record<TxnType, { name: string; account: string }[]>;
  whtTypes: { code: string; label: string; rate: number }[];
}

export type DocType =
  | "quotation"
  | "invoice"
  | "tax_invoice"
  | "receipt"
  | "tax_invoice_receipt"
  | "credit_note"
  | "wht_certificate";

export interface DocItem {
  id?: number;
  productId: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  vatType: VatType;
  lineTotal?: number;
}

export interface AccDocument {
  id: number;
  docType: DocType;
  docNo: string;
  isDraft: boolean;
  docDate: string;
  dueDate: string | null;
  customerId: number | null;
  partyName: string | null;
  partyTaxId: string | null;
  partyAddress: string | null;
  subtotal: number;
  discount: number;
  vatAmount: number;
  whtAmount: number;
  total: number;
  amountText: string;
  status: "draft" | "issued" | "paid" | "void";
  paidAt: string | null;
  paymentMethod: string | null;
  refDocId: number | null;
  refDocNo: string | null;
  refDocType: DocType | null;
  transactionId: number | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  items: DocItem[];
  org?: {
    name: string;
    legalName: string | null;
    taxId: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    vatRegistered: boolean;
    branchNo: string;
  };
  whtSource?: {
    rate: number | null;
    incomeType: string | null;
    counterpartyType: "individual" | "company" | null;
    paidDate: string;
    amount: number;
    whtAmount: number;
  } | null;
}

export interface PP30 {
  period: { year: number; month: number };
  sales: {
    base: number;
    vat: number;
    breakdown: Record<"orders" | "taxInvoices" | "otherIncome" | "creditNotes", { count: number; base: number; vat: number }>;
  };
  purchases: { base: number; vat: number; unclaimableVat: number; count: number };
  vatPayable: number;
  vatCredit: number;
  dueNote: string;
  saved: { status: "draft" | "ready" | "filed"; filed_at: string | null } | null;
}

export interface WhtReport {
  form: "PND3" | "PND53";
  items: {
    seq: number;
    transactionId: number;
    date: string;
    payee: string | null;
    taxId: string | null;
    incomeType: string | null;
    rate: number | null;
    amount: number;
    wht: number;
    description: string;
    certificateId: number | null;
  }[];
  totals: { count: number; amount: number; wht: number };
  warnings: string[];
  dueNote: string;
  saved: PP30["saved"];
}

export interface PnlLine {
  code: string;
  name: string;
  type: string;
  amount: number;
}

export interface Pnl {
  from: string;
  to: string;
  revenue: PnlLine[];
  cogs: PnlLine[];
  expenses: PnlLine[];
  totals: { revenue: number; cogs: number; grossProfit: number; expenses: number; netProfit: number };
}

export interface TrialBalance {
  asOf: string;
  accounts: { code: string; name: string; type: string; debit: number; credit: number }[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

export interface JournalEntry {
  id: number;
  entryNo: string;
  date: string;
  description: string;
  refType: string | null;
  refId: number | null;
  lines: { code: string; name: string; debit: number; credit: number }[];
}

export interface AccountingOverview {
  month: { revenue: number; expense: number; netProfit: number };
  vat: { output: number; input: number; estimatedPayable: number };
  receivables: { count: number; amount: number; overdue: number };
  whtToRemit: number;
}

export interface ReceiptExtraction {
  vendorName: string | null;
  vendorTaxId: string | null;
  isFullTaxInvoice: boolean;
  documentNo: string | null;
  date: string | null;
  subtotal: number | null;
  vatAmount: number | null;
  whtAmount: number | null;
  total: number | null;
  category: string;
  description: string;
  confidence: "high" | "medium" | "low";
  suggestedWhtType: { code: string; label: string; rate: number } | null;
}
