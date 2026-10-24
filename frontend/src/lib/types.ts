export type Permission = string;

export interface User {
  id: number;
  orgId: number;
  branchId: number | null;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  mustChangePassword: boolean;
  /** a manager has set the PIN used to approve refunds/voids on a cashier's till */
  hasPosPin?: boolean;
  roles: string[];
  permissions: Permission[];
}

export interface Branch {
  id: number;
  code: string;
  name: string;
  branchNo: string;
  address: string | null;
  isActive: boolean;
  /** Stock location the POS sells from at this branch */
  warehouseId: number | null;
  warehouseName: string | null;
  /** This branch's own payment accounts; null = the shop-wide ones in POS settings */
  promptpayId: string | null;
  bankAccount: BankAccount | null;
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

export interface AuditUser {
  id: number;
  name: string;
  email: string | null;
}

export interface AuditLogEntry {
  id: number;
  action: string;
  /** First segment of the action, e.g. "pos" for "pos.void" */
  module: string;
  entityType: string | null;
  entityId: string | null;
  /** Free-form; credential-like keys are masked by the server */
  metadata: unknown;
  ip: string | null;
  createdAt: string;
  /** null = system / webhook */
  user: AuditUser | null;
}

export interface AuditFacets {
  /** id null = actions without a signed-in user (system, webhooks) */
  users: { id: number | null; name: string; email: string | null; count: number; lastAt: string }[];
  modules: { module: string; count: number }[];
  entityTypes: { entityType: string; count: number }[];
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
  /** The settings page can check the keys with a live request */
  testable?: boolean;
  /** false = the platform API is not built yet (partner access pending) */
  available?: boolean;
  env: IntegrationEnv[];
}

export interface IntegrationEnv {
  name: string;
  optional: boolean;
  /** Adapter's built-in value when nothing is set */
  default: string | null;
  set: boolean;
  /** "db" = saved from the web UI (wins), "env" = server environment */
  source: "db" | "env" | null;
  secret: boolean;
  /** Secrets: last 4 characters only */
  hint: string | null;
  /** A value exists in the server environment to fall back to */
  envDefault: boolean;
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
  supplierId: number | null;
  supplierName: string | null;
  packSize: number;
  trackExpiry: boolean;
  /** price typed at the sale, no stock kept */
  openPrice: boolean;
  shelfLifeDays: number | null;
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
  ageRestricted: boolean;
  saleBlock: SaleBlock | null;
}

/** Local-time window when a category may not be sold (e.g. alcohol 00:00–11:00). */
export interface SaleBlock {
  from: string;
  to: string;
  label?: string;
}

export interface ProductUnit {
  id: number;
  name: string;
  factor: number;
  barcode: string | null;
  price: number | null;
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
  reorderOverride: boolean;
  maxQty: number | null;
  quantity: number;
  value: number;
  avgDaily: number;
  sold7: number;
  daysCover: number | null;
  lastSoldAt: string | null;
  /** units sold per day, oldest first (14 days) */
  spark: number[];
  status: StockStatus;
}

export type StockStatus = "out" | "low" | "slow" | "ok";

export type MovementType = "purchase" | "sale" | "return" | "adjustment" | "transfer_in" | "transfer_out" | "opening" | "count" | "waste" | "welfare";

export type StockCountStatus = "counting" | "review" | "approved" | "cancelled";

export interface StockCount {
  id: number;
  countNo: string;
  warehouseId: number;
  warehouseName: string;
  scope: "full" | "category";
  categoryId: number | null;
  categoryName: string | null;
  blind: boolean;
  status: StockCountStatus;
  note: string | null;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  totalItems?: number;
  countedItems?: number;
}

export interface StockCountItem {
  productId: number;
  sku: string;
  barcode: string | null;
  name: string;
  unit: string;
  /** null for counters on a blind count */
  snapshot: number | null;
  movedDuringCount: number | null;
  expected: number | null;
  counted: number | null;
  variance: number | null;
  value: number | null;
  unitCost: number;
  reason: string | null;
  countedBy: string | null;
  countedAt: string | null;
  needsReason: boolean;
}

export interface StockCountDetail extends StockCount {
  canApprove: boolean;
  total: number;
  counted: number;
  diffItems: number | null;
  gainValue: number | null;
  lossValue: number | null;
  items: StockCountItem[];
}

export interface Supplier {
  id: number;
  name: string;
  taxId: string | null;
  contact: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  leadTimeDays: number;
  note: string | null;
  isActive: boolean;
  productCount: number;
  openOrders: number;
}

export interface OrderSuggestion {
  productId: number;
  sku: string;
  name: string;
  unit: string;
  categoryName: string | null;
  supplierId: number | null;
  supplierName: string | null;
  cost: number;
  price: number;
  packSize: number;
  leadTime: number;
  onHand: number;
  onOrder: number;
  /** Stock in the org's other warehouses */
  otherStock: number;
  reorderPoint: number;
  avgDaily: number;
  sold7: number;
  spark: number[];
  daysCover: number | null;
  suggested: number;
  reason: string;
}

export type PoStatus = "draft" | "ordered" | "partial" | "received" | "cancelled";

export interface PurchaseOrder {
  id: number;
  poNo: string;
  status: PoStatus;
  source: "manual" | "suggestion";
  supplierId: number | null;
  supplierName: string | null;
  supplierPhone: string | null;
  warehouseId: number;
  warehouseName: string;
  orderDate: string;
  expectedDate: string | null;
  total: number;
  note: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  itemCount?: number;
  receivedPct?: number;
  items?: {
    productId: number;
    sku: string;
    barcode: string | null;
    name: string;
    unit: string;
    quantity: number;
    receivedQty: number;
    unitCost: number;
    lineTotal: number;
    trackExpiry: boolean;
    shelfLifeDays: number | null;
  }[];
  /** goods receipts (GR) made against this PO */
  receipts?: { id: number; docNo: string; docDate: string; totalCost: number }[];
}

export interface StockTransfer {
  id: number;
  transferNo: string;
  status: "in_transit" | "received" | "cancelled";
  fromWarehouseId: number;
  fromName: string;
  toWarehouseId: number;
  toName: string;
  note: string | null;
  createdBy: string;
  receivedBy: string | null;
  shippedAt: string;
  receivedAt: string | null;
  itemCount?: number;
  shortage?: number;
  items?: { productId: number; sku: string; barcode: string | null; name: string; unit: string; qtySent: number; qtyReceived: number | null }[];
}

export interface ExpiryLot {
  lotId: number;
  lotNo: string | null;
  expiryDate: string;
  daysLeft: number;
  quantity: number;
  unitCost: number;
  value: number;
  markdownPct: number;
  receivedAt: string;
  warehouseId: number;
  warehouseName: string;
  productId: number;
  sku: string;
  name: string;
  unit: string;
  price: number;
}

export type WasteReason = "expired" | "damaged" | "lost" | "other";

export interface WasteReport {
  month: string;
  total: number;
  items: { productId: number; name: string; unit: string; reason: WasteReason; reasonLabel: string; qty: number; value: number }[];
}

export interface AppNotification {
  id: number;
  type: string;
  severity: "info" | "warning" | "danger";
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  read: boolean;
}

export interface NotifySettings {
  line: { enabled: boolean; to: string[]; digestTime: string };
  lineTargets: { id: string; name: string; lastMessageAt: string | null }[];
}

export interface StockMovement {
  id: number;
  type: MovementType;
  quantity: number;
  unitCost: number | null;
  refType: string | null;
  refId: number | null;
  /** the GR / AJ / WS this movement belongs to */
  documentId: number | null;
  documentNo: string | null;
  note: string | null;
  createdAt: string;
  productId: number;
  sku: string;
  productName: string;
  warehouseName: string;
  userName: string | null;
  /** A quick adjustment that has already been undone */
  reversed: boolean;
  /** A quick adjustment ("ปรับยอด") that can still be undone */
  reversible: boolean;
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
  ageRestricted: boolean;
  saleBlock: SaleBlock | null;
  /** Pack/carton units; price already resolved (factor x base price when unset). */
  units: (ProductUnit & { price: number })[];
  /** Set by /pos/lookup when a pack/carton barcode was scanned. */
  matchedUnitId?: number | null;
  trackExpiry: boolean;
  /** price typed at the sale, no stock kept (photocopies, fees, items without a barcode) */
  openPrice?: boolean;
  /** Next lot to sell is marked down (near expiry): pct off for its qty base units */
  markdown: { pct: number; qty: number; expiry: string | null } | null;
  /** promotions running now at this branch that include the item */
  promos?: PromoTag[];
  /** price after the best time discount running now, if any */
  promoPrice?: number | null;
}

export type PromotionKind = "time_discount" | "bundle" | "multi_buy";
export type PromotionDiscountType = "percent" | "amount_off" | "set_price";

export interface PromoTag {
  id: number;
  kind: PromotionKind;
  label: string;
}

export interface PromotionSlot {
  qty: number;
  productIds: number[];
  categoryIds: number[];
  products: { id: number; name: string; price: number; cost?: number }[];
  categories: { id: number; name: string }[];
}

export interface Promotion {
  id: number;
  name: string;
  kind: PromotionKind;
  discountType: PromotionDiscountType;
  value: number;
  startsOn: string | null;
  endsOn: string | null;
  /** bit 0 = Sunday ... bit 6 = Saturday */
  daysMask: number;
  timeFrom: string | null;
  timeTo: string | null;
  isActive: boolean;
  /** empty = every branch */
  branches: number[];
  branchNames: string[];
  slots: PromotionSlot[];
  label: string;
  status: "running" | "scheduled" | "ended" | "off";
  editable: boolean;
  orders: number;
  discountTotal: number;
}

export interface PromoSuggestion {
  promotionId: number;
  name: string;
  label: string;
  need: number;
  saving: number;
  message: string;
  /** each with the baht it saves when added */
  items: (CatalogItem & { saving?: number })[];
}

export interface CartQuote {
  lines: { promoDiscount: number; markdownKept: number; promotionId: number | null; promotionName: string | null }[];
  applied: { promotionId: number; name: string; discount: number }[];
  total: number;
  suggestions: PromoSuggestion[];
}

export type PaymentMethod = "cash" | "promptpay" | "card" | "transfer" | "ewallet";

export interface Shift {
  id: number;
  branchId: number;
  branchName: string;
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  closingCash: number | null;
  expectedCash: number;
  difference?: number | null;
  denominations: Record<string, number> | null;
  note: string | null;
  stats: {
    orders: number;
    sales: number;
    voided: number;
    byMethod: Record<string, number>;
    cash: { pay_in: number; pay_out: number; pickup: number };
  };
}

export type CashMoveType = "pay_in" | "pay_out" | "pickup";

/** A pay-in / pay-out / safe drop of a shift; `auto` rows were written by a return (void the return to undo them). */
export interface CashMovement {
  id: number;
  type: CashMoveType;
  amount: number;
  reason: string;
  createdAt: string;
  userName: string | null;
  auto: boolean;
}

/** X report (open shift) / Z report (closed shift). */
export interface ShiftReport extends Shift {
  kind: "X" | "Z";
  cashierName: string;
  discount: number;
  promoDiscount: number;
  vat: number;
  pointsUsed: number;
  cashMovements: CashMovement[];
  topItems: { name: string; quantity: number; amount: number }[];
}

export interface PosMember {
  id: number;
  name: string;
  memberNo: string | null;
  phone: string | null;
  points: number;
  totalSpent: number;
}

export interface HeldCartItem {
  productId: number;
  unitId?: number | null;
  quantity: number;
  discount?: number;
  /** an open-price line keeps what the cashier typed */
  unitPrice?: number;
  name?: string;
}

export interface HeldBill {
  id: number;
  label: string | null;
  cart: { items: HeldCartItem[]; discount?: number };
  customerId: number | null;
  customerName: string | null;
  total: number;
  userName: string;
  createdAt: string;
}

export interface SlipCheck {
  ok: boolean;
  checks: { isSlip: boolean; amount: boolean; reference: boolean; unused: boolean; receiver: boolean | null };
  transRef: string | null;
  amount: number | null;
  paidAt: string | null;
  bank: string | null;
  receiverName: string | null;
  confidence: "high" | "medium" | "low";
}

export interface PosOrder {
  id: number;
  orderNo: string;
  /** a temporary receipt for a cash bill sold offline (not sent to the server yet) */
  offline?: boolean;
  /** id of the public receipt link /r/<token> (null on bills made before it existed) */
  receiptToken?: string | null;
  taxInvoice?: { status: "pending" | "issued"; name: string; taxId: string; branchNo: string; address: string; email: string | null; documentId: number | null; docNo: string | null } | null;
  channel: string;
  status: string;
  shiftId: number | null;
  branchName: string | null;
  branchNo: string | null;
  cashierName: string | null;
  customerName: string | null;
  customerId: number | null;
  pointsEarned: number;
  pointsUsed: number;
  customerPoints: number | null;
  subtotal: number;
  discount: number;
  vatAmount: number;
  total: number;
  orderedAt: string;
  change?: number;
  items: {
    id: number;
    productId: number;
    name: string;
    unitName: string | null;
    quantity: number;
    returnedQty: number;
    unitPrice: number;
    discount: number;
    promoDiscount: number;
    promotionName: string | null;
    lineTotal: number;
  }[];
  payments: { method: string; amount: number; reference: string | null; paidAt: string }[];
  codeDiscount: number;
  promoDiscount: number;
  discountCode: string | null;
  refundedAmount: number;
  returns: SalesReturn[];
}

export interface SalesReturn {
  id: number;
  returnNo: string;
  reason: string;
  refundMethod: string;
  refundAmount: number;
  restocked: boolean;
  userName: string | null;
  createdAt: string;
  voided: boolean;
  voidedAt: string | null;
  voidReason: string | null;
  items: { name: string; unitName: string | null; quantity: number; amount: number }[];
}

export interface DiscountCode {
  id: number;
  code: string;
  description: string | null;
  type: "percent" | "fixed";
  value: number;
  minSpend: number;
  maxUses: number | null;
  usedCount: number;
  remaining: number | null;
  customerId: number | null;
  customerName: string | null;
  issuedBy: string;
  expiresAt: string | null;
  isActive: boolean;
}

export interface DiscountCheck {
  valid: boolean;
  reason: string | null;
  amount: number;
  code: DiscountCode | null;
}

export interface PosOrderRow {
  id: number;
  orderNo: string;
  status: string;
  total: number;
  refundedAmount: number;
  orderedAt: string;
  cashierName: string | null;
  customerName?: string | null;
  /** the customer asked for a full tax invoice (pending) or it was issued */
  taxRequest?: "pending" | "issued" | null;
  method: string | null;
  items: number;
}

export interface BankAccount {
  bank: string;
  type: string;
  number: string;
  name: string;
  /** XXX-X-XXXXX-X */
  display?: string;
}

export interface PosSettings {
  promptpayId: string;
  receiptFooter: string;
  maxDiscountPct: number;
  pointsEarnBaht: number;
  pointValue: number;
  cashLimit: number;
  /** LINE Official Account (@shop) shown on the customer's receipt page */
  lineOaId: string;
  /** issue the full tax invoice by itself when the customer fills in the form */
  taxInvoiceAuto: boolean;
  /** PromptPay that closes the bill by itself (a payment provider is connected and on) */
  paymentGateway?: { enabled: boolean; provider: string | null };
  /** What this till charges into: the branch's own account when it has one */
  bankAccount: BankAccount;
  promptpayEnabled: boolean;
  paymentBranch: { id: number; name: string; ownPromptpay: boolean; ownBank: boolean } | null;
  /** Shop-wide accounts (edited in POS settings) */
  defaults: { promptpayId: string; bankAccount: BankAccount };
  org: { name: string; legalName: string | null; taxId: string | null; address: string | null; phone: string | null; vatRegistered: boolean };
}

/* ------------------------------------------------------------- Phase 3 */

export type TxnType = "income" | "expense";
export type VatMode = "none" | "exclusive" | "inclusive";

export interface Transaction {
  id: number;
  /** "txn" = entered in รายรับ-รายจ่าย; "sale" = a POS/online order shown here (id is the order id) */
  source: "txn" | "sale";
  orderNo: string | null;
  channel: string | null;
  itemCount: number | null;
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
  /** ใบรับรองแทนใบเสร็จ made for this expense */
  substituteReceiptId?: number | null;
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
  | "debit_note"
  | "billing_note"
  | "substitute_receipt"
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
    bankAccount: BankAccount | null;
  };
  /** a billing note: the documents it collects (credit notes are negative) */
  billedDocuments?: { id: number; docType: DocType; docNo: string; status: AccDocument["status"]; docDate: string; dueDate: string | null; amount: number }[];
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
    source?: "transaction" | "payment_voucher";
    transactionId: number | null;
    voucherId?: number | null;
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

/** One balance-sheet row; `previous` is null unless a comparison date was requested. Synthetic rows (retained earnings) have no code. */
export interface BalanceSheetLine {
  code: string | null;
  name: string;
  amount: number;
  previous: number | null;
}

export interface BalanceSheetSection {
  lines: BalanceSheetLine[];
  total: number;
  previousTotal: number | null;
}

export interface BalanceSheetGroup {
  current: BalanceSheetSection;
  nonCurrent: BalanceSheetSection;
  total: number;
  previousTotal: number | null;
}

export interface BalanceSheet {
  asOf: string;
  compareTo: string | null;
  fiscalYearStart: string;
  assets: BalanceSheetGroup;
  liabilities: BalanceSheetGroup;
  equity: { lines: BalanceSheetLine[]; retainedEarnings: BalanceSheetLine; currentProfit: BalanceSheetLine; total: number; previousTotal: number | null };
  totals: { assets: number; liabilities: number; equity: number; liabilitiesAndEquity: number };
  difference: number;
  balanced: boolean;
  comparison: { asOf: string; difference: number; balanced: boolean } | null;
}

export interface JournalEntry {
  id: number;
  entryNo: string;
  date: string;
  description: string;
  refType: string | null;
  refId: number | null;
  status?: "draft" | "posted" | "void";
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

/* ------------------------------------------------------------------ inbox */

export type Platform = "facebook" | "instagram" | "line" | "tiktok" | "shopee" | "website" | "email";
export type ConvStatus = "open" | "pending" | "resolved" | "closed";
export type ConvMode = "ai" | "human";

export interface Conversation {
  id: number;
  channelId: number;
  platform: Platform;
  channelName: string;
  customerId: number | null;
  customerName: string | null;
  status: ConvStatus;
  mode: ConvMode;
  handoffReason: string | null;
  intent: string | null;
  sentiment: string | null;
  unread: number;
  assignedTo: number | null;
  assignedName: string | null;
  lastMessage: string | null;
  lastSender: string | null;
  lastMessageAt: string | null;
  lastCustomerMessageAt: string | null;
}

export interface InboxMessage {
  id: number;
  direction: "in" | "out";
  senderType: "customer" | "ai" | "agent" | "system";
  senderName: string | null;
  content: string | null;
  deliveryStatus: "pending" | "sent" | "delivered" | "read" | "failed" | null;
  aiMeta: { provider?: string; model?: string; tools?: string[] } | null;
  createdAt: string;
}

export interface ConversationDetail extends Conversation {
  messages: InboxMessage[];
  customer: { id: number; name: string; phone: string | null; email: string | null; totalSpent: number; orderCount: number; tags: string | null } | null;
  orders: { id: number; orderNo: string; channel: string; status: string; total: number; orderedAt: string }[];
  returns: { id: number; reason: string; detail: string | null; resolution: string; status: string; amount: number; created_at: string }[];
  offers: { id: number; type: string; value: number; status: string; rationale: string | null; code: string | null; createdAt: string }[];
}

export interface InboxSummary {
  open: number;
  needsHuman: number;
  unread: number;
  pendingApprovals: number;
  newReturns: number;
  aiProvider: string;
  aiConfigured: boolean;
  /** Connected (active) channels and open chats per platform */
  platforms?: { platform: Platform; channels: number; open: number }[];
}

export interface InboxChannelsMeta {
  publicApiUrlConfigured: boolean;
  metaLogin?: { configured: boolean; missing: string[] };
  metaWebhook?: { configured: boolean; missing: string[]; callbackUrl: string };
}

export interface InboxChannelConfig {
  id: number;
  platform: Platform;
  name: string;
  externalId: string | null;
  aiEnabled: boolean;
  isActive: boolean;
  openCount: number;
  hasToken: boolean;
  webhookUrl: string | null;
  supported: boolean;
}

export interface AgentProfile {
  name: string;
  persona: string;
  salesRules: string;
  maxDiscountPct: number;
  handoffKeywords: string;
  provider: string;
  configured: boolean;
}

export interface KnowledgeItem {
  id: number;
  kind: string;
  question: string | null;
  answer: string;
}

export interface ReturnCase {
  id: number;
  orderId: number | null;
  orderNo: string | null;
  orderTotal: number | null;
  conversationId: number | null;
  customerName: string | null;
  platform: Platform | null;
  reason: string;
  detail: string | null;
  resolution: string;
  resolutionNote: string | null;
  amount: number;
  status: "requested" | "approved" | "received" | "completed" | "rejected";
  createdAt: string;
}

export interface DisputeCase {
  id: number;
  orderNo: string | null;
  platform: string | null;
  category: string;
  summary: string | null;
  severity: "low" | "medium" | "high";
  status: "open" | "negotiating" | "resolved" | "escalated" | "lost";
  resolutionNote: string | null;
  conversationId: number | null;
  createdAt: string;
}

export interface AiOffer {
  id: number;
  conversationId: number;
  customerName: string | null;
  platform: Platform;
  type: string;
  value: number;
  rationale: string | null;
  status: "proposed" | "accepted" | "declined" | "expired" | "needs_approval";
  code: string | null;
  createdAt: string;
}

/* ----------------------------------------------------------------- trends */

export type TrendStatus = "new" | "watching" | "imported" | "ignored";

export interface TrendItem {
  id: number;
  sourceId: number | null;
  sourceName: string | null;
  platform: string;
  externalId: string;
  title: string;
  url: string | null;
  shopName: string | null;
  imageUrl: string | null;
  price: number | null;
  soldCount: number | null;
  soldVelocity: number | null;
  rating: number | null;
  commissionRate: number | null;
  category: string | null;
  categoryRank: number | null;
  monthlySold: number | null;
  prevMonthlySold: number | null;
  reviewCount: number | null;
  mediaReviewCount: number | null;
  positiveReviewPct: number | null;
  shopRating: number | null;
  shopResponseRate: number | null;
  shopShip48Rate: number | null;
  hasFlashSale: boolean | null;
  trendScore: number | null;
  /** Lifecycle phase: "1"–"5" rising, "A" peak, "B"–"E" declining */
  phase: LifecyclePhase | null;
  phaseRatio: number | null;
  checklistPassed: number | null;
  pickScore: number | null;
  status: TrendStatus;
  importedProductId: number | null;
  affiliateLinkId: number | null;
  affiliateUrl: string | null;
  hasAnalysis: boolean;
  aiAnalyzedAt: string | null;
  sourcePlatform: string | null;
  aiSearch: TrendAiSearch | null;
  /** Kalodata (TikTok Shop TH) fields — null for other sources */
  kaloCategoryId: string | null;
  kaloLeafId: string | null;
  revenue: number | null;
  revenueGrowth: number | null;
  creatorCount: number | null;
  videoCount: number | null;
  liveCount: number | null;
  launchDate: string | null;
  channelSplit: { video?: number | null; live?: number | null; showcase?: number | null; mall?: number | null } | null;
  commissionPerUnit: number | null;
  selectScore: number | null;
  selectVerdict: SelectVerdict | null;
  selectProjected: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export type SelectVerdict = "test" | "watch" | "skip" | "insufficient";
export type SelectKey = "demand" | "trend" | "commission" | "competition" | "content" | "trust";

/** The guide's 30-point selection score: six criteria 1–5, unknown = null. */
export interface SelectDetail {
  items: { key: SelectKey; label: string; score: number | null; reason: string }[];
  total: number;
  known: number;
  projected: number | null;
  verdict: SelectVerdict;
  stops: string[];
}

export type KaloExtraKind = "detail" | "analysis" | "comments" | "videos" | "creators";

export interface KaloExtra<T = unknown> {
  data: T;
  credits: number;
  fetchedAt: string;
}

export interface KaloCategory {
  id: string;
  parentId: string | null;
  level: 1 | 2 | 3;
  name: string;
  rank: number | null;
  revenue: number | null;
  sale: number | null;
  growth: number | null;
  top3: number | null;
  avgShopRevenue: number | null;
  shopNumber: number | null;
  activeProducts: number | null;
  avgPrice: number | null;
  opportunity: boolean;
  signal: "opportunity" | "growing" | "concentrated" | "steady" | "shrinking" | null;
  signalReasons: string[];
  trend?: { period: string; revenue: number | null }[];
  childCount?: number;
  productCount?: number;
}

export interface KaloStatus {
  enabled: boolean;
  dayOfMonth: number;
  configured: boolean;
  lastPeriod: string | null;
  nextPeriod: string;
  /** last month that has ended — the newest one Kalodata can be asked for */
  latestFull: string;
  estimateCredits: number;
  running: boolean;
}

export interface KaloRun {
  id: number;
  status: "running" | "succeeded" | "failed";
  stage: string | null;
  period: string | null;
  credits: number | null;
  balanceUsed: number | null;
  counts: { categories: number; products: number; details: number } | null;
  tasksLeft: number;
  warnings: string[];
  itemsFound: number;
  itemsNew: number;
  error: string | null;
  triggeredBy: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface KaloSettings extends KaloStatus {
  runs: KaloRun[];
}

export interface CategoryReport {
  period: string | null;
  periods: string[];
  breadcrumb: { id: string; name: string; level: number }[];
  items: KaloCategory[];
  summary: {
    revenue: number;
    prevRevenue: number | null;
    growth: number | null;
    categories: number;
    fastest: { id: string; name: string; growth: number; level: number } | null;
    opportunity: { id: string; name: string; growth: number | null; top3: number | null; level: number } | null;
    tracked: number;
    products: number;
  } | null;
  kalodata: KaloStatus;
}

export interface CategoryPage extends KaloCategory {
  period: string;
  periods: string[];
  breadcrumb: { id: string; name: string; level: number }[];
  history: { period: string; revenue: number | null; sale: number | null; growth: number | null }[];
  dailyTrend: (number | null)[];
  channels: { video: number | null; live: number | null; mall: number | null; affiliate: number | null; self: number | null };
  channelAdvice: { share: { video: number; live: number; mall: number }; top: "video" | "live" | "mall"; advice: string } | null;
  children: KaloCategory[];
}

export interface TrendAnalysis {
  fitScore: number;
  verdict: string;
  targetAudience: string;
  sellingPoints: string[];
  videoHooks: string[];
  contentAngle: string;
  risks: string[];
  suggestedPrice: number | null;
  phaseComment?: string;
  channelFit?: string | null;
  channelProfile?: { id: number; name: string } | null;
  provider?: string;
  model?: string;
}

export type LifecyclePhase = "1" | "2" | "3" | "4" | "5" | "A" | "B" | "C" | "D" | "E";
export type ChecklistKey = "phase" | "rating" | "positiveReviews" | "mediaReviews" | "shopRating" | "responseRate" | "ship48" | "commission" | "flashSale";
export type ChecklistStatus = "pass" | "partial" | "fail" | "unknown";

export interface ChecklistItem {
  key: ChecklistKey;
  label: string;
  status: ChecklistStatus;
  manual: boolean;
}

export interface TrendBenchmark {
  peak: number;
  source: "auto" | "manual";
}

export interface TrendDetail extends TrendItem {
  phaseNotes: { confidence: "high" | "medium" | "low" | null; declining: boolean; reasons: string[]; peak: number | null; peakSource: "auto" | "manual" | null } | null;
  checklist: ChecklistItem[];
  manualChecks: Partial<Record<ChecklistKey, boolean>>;
  benchmark: TrendBenchmark | null;
  aiAnalysis: TrendAnalysis | null;
  snapshots: { capturedAt: string; price: number | null; soldCount: number | null; rating: number | null; commissionRate: number | null }[];
  selectDetail: SelectDetail | null;
  months: { period: string; revenue: number | null; sales: number | null; growth: number | null; price: number | null; commissionRate: number | null; rank: number | null }[];
  extras: Partial<Record<KaloExtraKind, KaloExtra>>;
  extraCost: Record<KaloExtraKind, number>;
  categoryPath: { id: string; name: string; level: number }[];
}

export interface TrendListMeta {
  page: number;
  pageSize: number;
  total: number;
  platforms: { platform: string; count: number }[];
}

export interface CsvTemplateColumn {
  field: string;
  header: string;
  description: string;
  required: boolean;
  example: string | number | null;
}

export interface CsvTemplate {
  filename: string;
  csv: string;
  columns: CsvTemplateColumn[];
}

export interface CategoryBenchmark {
  platform: string;
  category: string;
  items: number;
  topSold: number | null;
  peakSold: number | null;
  source: "auto" | "manual" | null;
  updatedAt: string | null;
}

export interface ChannelPlan {
  concept: string;
  channelNames: string[];
  contentFormats: string[];
  identity: string;
  promotionPlan: string[];
  contentExamples: string[];
  productCategories: { category: string; why: string; keywords: string[] }[];
  provider?: string;
  model?: string;
}

export interface ChannelProfile {
  id: number;
  name: string;
  persona: string;
  interests: string[];
  audience: string | null;
  onCamera: boolean;
  isDefault: boolean;
  aiPlan: ChannelPlan | null;
  aiPlannedAt: string | null;
  updatedAt: string;
}

export type SourcePlatform = "shopee_affiliate" | "apify" | "custom_url" | "tiktok_shop" | "shopee" | "ai_search" | "kalodata";

export type TrendStage = "emerging" | "rising" | "peak" | "declining";

export interface AiEvidence {
  url: string;
  title: string | null;
  quote: string | null;
}

/** Why AI search suggested a trend item (only for items it found). */
export interface TrendAiSearch {
  verified: boolean;
  whyTrending: string | null;
  trendStage: TrendStage | null;
  keywords: string[];
  evidence: AiEvidence[];
  soldHint: string | null;
  priceHint: string | null;
  risks: string[];
  foundAt: string | null;
  runId: number | null;
}

export interface AiSearchSummary {
  products: { title: string; category: string | null; whyTrending: string | null; trendStage: TrendStage | null; evidence: AiEvidence[] }[];
  dropped: { title: string; reason: string }[];
  searches: number;
  sources: number;
  enriched: number;
  imported: number;
  created: number;
  profile: { id: number; name: string } | null;
  provider: string;
  model: string | null;
}

export interface AiSearchConfig {
  focus?: string;
  platformFocus: "any" | "shopee" | "tiktok_shop" | "lazada";
  count: number;
  channelProfileId?: number | null;
  enrich: boolean;
}

export interface AiSearchSettings {
  sourceId: number | null;
  config: AiSearchConfig;
  lastRunAt: string | null;
  configured: boolean;
  provider: string;
  shopeeEnrich: boolean;
}

export interface ScrapeSource {
  id: number;
  platform: SourcePlatform;
  method: string;
  name: string;
  config: Record<string, unknown>;
  intervalHours: number | null;
  isActive: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  runnable: boolean;
  notRunnableReason: string | null;
  configured: boolean;
  missingEnv: string[];
  itemCount: number;
}

export interface ScrapeRun {
  id: number;
  sourceId: number;
  sourceName: string;
  platform: string;
  status: "running" | "succeeded" | "failed";
  /** AI search progress: searching → summarizing → importing → done */
  stage: "searching" | "summarizing" | "importing" | "done" | null;
  summary: AiSearchSummary | null;
  itemsFound: number;
  itemsNew: number;
  error: string | null;
  triggeredBy: string;
  startedAt: string;
  finishedAt: string | null;
}

/* ------------------------------------------------------------------ video */

export type VideoStatus =
  | "draft"
  | "scripting"
  | "script_ready"
  | "voicing"
  | "generating_clips"
  | "rendering_avatar"
  | "compositing"
  | "parts_ready"
  | "ready"
  | "failed";

export interface VideoScene {
  voiceover: string;
  caption: string;
  visual: string;
  showProduct: boolean;
  durationSec: number;
  /** 1-based number of the user's footage used for this scene */
  media?: number | null;
}

export type VideoVisualMode = "ai_clips" | "product_images" | "my_footage";
export type CaptionStyle = "pop" | "clean" | "none";

export interface VideoHook {
  angle: string;
  voiceover: string;
  caption: string;
}

export interface VideoMedia {
  id: number;
  kind: "video" | "image";
  mime: string;
  sizeBytes: number;
  durationMs: number | null;
  label: string | null;
  sortOrder: number;
  url: string;
}

export interface VideoProject {
  id: number;
  title: string;
  productId: number | null;
  productName: string | null;
  trendId: number | null;
  imageUrl: string | null;
  brief: { tone?: string; angle?: string; lengthSec?: number; audience?: string; notes?: string };
  scenes: VideoScene[];
  postCaption: string | null;
  hashtags: string | null;
  voiceProvider: "minimax" | "elevenlabs";
  voiceId: string | null;
  visualMode: VideoVisualMode;
  captionStyle: CaptionStyle;
  coverId: number | null;
  hooks: VideoHook[];
  status: VideoStatus;
  stageDetail: string | null;
  error: string | null;
  outputUrl: string | null;
  durationSec: number | null;
  hasSubtitles: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VideoAsset {
  id: number;
  kind: "voice" | "broll" | "final" | "avatar" | "music" | "subtitle" | "thumbnail";
  sceneIndex: number | null;
  provider: string | null;
  status: "pending" | "processing" | "ready" | "failed";
  durationMs: number | null;
  url: string | null;
  error: string | null;
}

export interface VideoDetail extends VideoProject {
  media: VideoMedia[];
  assets: VideoAsset[];
  /** While in progress: whether the background worker is picking jobs up */
  queue: { due: number; waitingSec: number; stalled: boolean } | null;
}

interface Capability {
  configured: boolean;
  missing: string[];
}

export interface VideoMeta {
  capabilities: {
    script: { configured: boolean; provider: string };
    voice: { minimax: Capability & { defaultVoiceId: string | null }; elevenlabs: Capability & { defaultVoiceId: string | null } };
    clips: Capability & { model: string };
    sceneClips?: Capability & { provider: "shotstack" | "minimax" };
    compose: Capability & { env: string };
    storage: Capability;
    publicMedia: Capability;
  };
  tones: Record<string, string>;
  angles: Record<string, string>;
}

export interface VoiceOption {
  id: string;
  name: string;
  group: "system" | "cloned" | "generated";
  description: string;
}

/* ----------------------------------------------------------------- social */

export type SocialPlatform = "tiktok" | "facebook" | "instagram";
export type PostStatus = "draft" | "scheduled" | "publishing" | "published" | "failed" | "cancelled";
export type TikTokPrivacy = "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";

export interface SocialAccount {
  id: number;
  platform: SocialPlatform;
  externalId: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: "connected" | "expired" | "error";
  lastError: string | null;
  tokenExpiresAt: string | null;
  isActive: boolean;
  scheduledCount: number;
  meta: { pageId?: string; pageName?: string } | null;
}

export interface SocialAccountsMeta {
  tiktok: { configured: boolean; missing: string[] };
  meta: { configured: boolean; missing: string[] };
  encryption: boolean;
  callbackUrls: { tiktok: string; meta: string };
}

export interface TikTokOptions {
  privacyLevel: TikTokPrivacy;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  brandContent: boolean;
  brandOrganic: boolean;
}

export interface CreatorInfo {
  nickname: string;
  username: string;
  avatarUrl: string | null;
  privacyOptions: TikTokPrivacy[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxDurationSec: number | null;
}

export interface ScheduledPost {
  id: number;
  accountId: number;
  platform: SocialPlatform;
  accountName: string | null;
  accountStatus: SocialAccount["status"];
  videoProjectId: number | null;
  videoTitle: string | null;
  videoStatus: string | null;
  mediaUrl: string | null;
  caption: string | null;
  hashtags: string | null;
  affiliateLinkId: number | null;
  affiliateUrl: string | null;
  linkPlacement: "caption" | "bio" | "none";
  scheduledAt: string;
  privacy: string;
  platformOptions: TikTokOptions | null;
  isAiGenerated: boolean;
  status: PostStatus;
  error: string | null;
  publishedAt: string | null;
  permalink: string | null;
  finalCaption: string;
}

export interface AffiliateLink {
  id: number;
  label: string | null;
  productId: number | null;
  productName: string | null;
  platform: string;
  originalUrl: string;
  shortUrl: string | null;
  subId: string | null;
  clicks: number;
  conversions: number;
  commission: number;
  postCount: number;
  createdAt: string;
}

/* ------------------------------------------------------------------ covers */

export type CoverOrientation = "portrait" | "landscape";
export type CoverLayout = "top-title" | "bottom-band" | "split-left" | "center-burst";
export type CoverFont = "kanit" | "prompt" | "mitr" | "chakra";

export interface CoverUserDesign {
  font?: CoverFont;
  layout?: CoverLayout;
  textColor?: string;
  accentColor?: string;
  titleScale?: number;
  emphasisWord?: string | null;
  imageX?: number;
  imageY?: number;
  imageScale?: number;
}

export interface CoverDesign {
  layout: CoverLayout;
  font: CoverFont;
  palette: { primary: string; accent: string; text: string; stroke: string };
  emphasisWord: string | null;
  mood: string | null;
  imagePrompt: string;
  user?: CoverUserDesign;
}

export interface CoverProject {
  id: number;
  orientation: CoverOrientation;
  style: string;
  headline: string;
  subtext: string | null;
  badge: string | null;
  uploadKind: "product" | "person" | null;
  design: CoverDesign | null;
  status: "generating" | "ready" | "failed";
  error: string | null;
  provider: string | null;
  model: string | null;
  uploadUrl: string | null;
  backgroundUrl: string | null;
  finalUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/** GET /org/organization — the seller's details for document headers */
export interface Organization {
  id: number;
  name: string;
  legalName: string | null;
  taxId: string | null;
  address: string | null;
  phone: string | null;
  vatRegistered: boolean;
  currency: string;
  timezone: string;
}

/* --------------------------------------------------------------- customers (CRM) */

export type CustomerSort = "recent" | "top" | "orders" | "name" | "newest";

export interface CustomerListItem {
  id: number;
  name: string;
  memberNo: string | null;
  phone: string | null;
  email: string | null;
  tags: string[];
  points: number;
  consentMarketing: boolean;
  totalSpent: number;
  orderCount: number;
  avgBasket: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  openChats: number;
  chatCount: number;
  /** Sales channels the customer bought through (pos, shopee, ...) */
  salesChannels: string[];
  /** Chat platforms the customer talked to us on */
  chatPlatforms: Platform[];
  createdAt: string;
}

export interface CustomerList {
  data: CustomerListItem[];
  meta: { total: number; limit: number; offset: number };
}

export interface CustomerSummary {
  totalCustomers: number;
  newThisMonth: number;
  consentCount: number;
  buyers: number;
  repeatBuyers: number;
  /** % of buying customers with 2+ bills */
  repeatRate: number;
  /** Lifetime spend per buying customer */
  avgSpend: number;
  avgBasket: number;
  tags: { tag: string; count: number }[];
}

export interface CustomerProfile {
  id: number;
  name: string;
  memberNo: string | null;
  phone: string | null;
  email: string | null;
  taxId: string | null;
  branchNo: string | null;
  address: string | null;
  tags: string[];
  points: number;
  consentMarketing: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerOrderRow {
  id: number;
  orderNo: string;
  channel: string;
  status: string;
  total: number;
  /** Total quantity of items on the bill */
  itemCount: number;
  lineCount: number;
  branchName: string | null;
  orderedAt: string;
}

export interface CustomerConversationRow {
  id: number;
  platform: Platform;
  channelName: string;
  customerName: string | null;
  status: "open" | "pending" | "resolved" | "closed";
  mode: "ai" | "human" | "hybrid";
  intent: string | null;
  sentiment: "positive" | "neutral" | "negative" | null;
  unreadCount: number;
  lastMessage: string | null;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface CustomerDetail extends CustomerProfile {
  stats: {
    totalSpent: number;
    orderCount: number;
    avgBasket: number;
    firstOrderAt: string | null;
    lastOrderAt: string | null;
    itemsBought: number;
    totalDiscount: number;
    pointsEarned: number;
    pointsUsed: number;
    points: number;
    cancelledCount: number;
    openChats: number;
  };
  channels: { channel: string; orderCount: number; totalSpent: number }[];
  topProducts: { productId: number; name: string; quantity: number; total: number; orderCount: number }[];
  recentOrders: CustomerOrderRow[];
  conversations: CustomerConversationRow[];
}

export interface CustomerInput {
  name: string;
  phone: string | null;
  email: string | null;
  taxId: string | null;
  branchNo: string | null;
  address: string | null;
  tags: string[];
  consentMarketing: boolean;
}

/* ------------------------------------------------- employee welfare withdrawal */
export type WelfareStatus = "pending" | "approved" | "rejected" | "cancelled" | "reversed";

export interface WelfareEmployee {
  id: number;
  name: string;
  branchName: string | null;
  /** Effective monthly limit at cost; 0 = unlimited */
  limit: number;
  limitOverride: number | null;
  usedThisMonth: number;
  /** null when unlimited */
  remaining: number | null;
}

export interface WelfareWarehouse {
  id: number;
  name: string;
  branchId: number | null;
  branchName: string | null;
}

export interface WelfareItem {
  id: number;
  productId: number;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  unitCost: number;
  lineCost: number;
  lots: { lotId: number; qty: number; expiry: string | null }[];
}

export interface WelfareRequest {
  id: number;
  requestNo: string;
  status: WelfareStatus;
  warehouseId: number;
  warehouseName: string;
  employeeId: number;
  employeeName: string;
  note: string | null;
  totalCost: number;
  requestedBy: number | null;
  requestedByName: string | null;
  requestedAt: string;
  approvedBy: number | null;
  approvedByName: string | null;
  approvedAt: string | null;
  rejectReason: string | null;
  reversedBy: number | null;
  reversedByName: string | null;
  reversedAt: string | null;
  reverseReason: string | null;
  items: WelfareItem[];
}

export interface WelfareSummary {
  month: string;
  defaultLimit: number;
  totalApproved: number;
  totalPending: number;
  employees: {
    employeeId: number;
    name: string;
    branchName: string | null;
    limit: number;
    approved: number;
    pending: number;
    used: number;
    requests: number;
    remaining: number | null;
    overLimit: boolean;
  }[];
}

export interface WelfareSettings {
  defaultLimit: number;
  users: { userId: number; name: string; email: string; branchName: string | null; limit: number | null }[];
}

/* ------------------------------------------------- daily sales summary (LINE OA) */

export interface SalesReportSettings {
  enabled: boolean;
  /** HH:MM, local time */
  time: string;
  to: string[];
  /** null = every branch */
  branchId: number | null;
}

export interface SalesReport {
  shopName: string;
  branchName: string | null;
  date: string;
  /** "HH:MM" when the report covers today up to now */
  until: string | null;
  net: number;
  bills: number;
  avgBill: number;
  profit: number;
  promoDiscount: number;
  vsYesterday: { net: number; pct: number | null };
  vsLastWeek: { net: number; pct: number | null };
  cancelled: { count: number; amount: number };
  refunds: { count: number; amount: number };
  methods: { method: string; label: string; color: string; amount: number; share: number }[];
  hours: { hour: number; amount: number }[];
  branches: { id: number; name: string; net: number; bills: number }[];
  topProducts: { name: string; qty: number; amount: number }[];
  income: number;
  expense: number;
  balance: number;
}

/** What the customer sees at /r/<token> (public, no login). */
export interface PublicReceipt {
  orderNo: string;
  orderedAt: string;
  status: string;
  seller: { name: string; taxId: string | null; address: string | null; phone: string | null; branchName: string | null; branchNo: string | null; vatRegistered: boolean };
  items: { name: string; unitName: string | null; quantity: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  payments: { method: string; amount: number }[];
  lineOaId: string | null;
  points: { isMember: boolean; earned: number; canClaim: boolean; wouldEarn: number };
  taxInvoice: {
    status: "none" | "pending" | "issued";
    canRequest: boolean;
    windowDays: number;
    invoice: {
      docNo: string;
      docDate: string;
      buyer: { name: string; taxId: string; branchNo: string; address: string };
      lines: { description: string; quantity: number; unitPrice: number; lineTotal: number }[];
      subtotal: number;
      vat: number;
      total: number;
    } | null;
  };
}

/** A PromptPay QR made by the shop's payment provider; `paid` once the money arrived. */
export interface PaymentIntent {
  id: number;
  status: "pending" | "paid" | "expired" | "failed" | "cancelled" | "used";
  amount: number;
  qrPayload: string | null;
  qrImage: string | null;
  expiresAt: string | null;
  paidAt: string | null;
}

/** Settings > automatic PromptPay (manager). Keys are never sent back. */
export interface PaymentGatewayAdmin {
  provider: string | null;
  enabled: boolean;
  providers: { id: string; label: string; fields: { key: string; label: string; secret: boolean; type?: "boolean" }[]; devOnly: boolean; webhookHint: string | null }[];
  hasKey: boolean;
  mode: "live" | "test" | null;
  /** saved on/off switches (e.g. sandbox) — not secret */
  flags: Record<string, boolean>;
  webhookKey: string | null;
}

/* ------------------------------------------------------------ ศูนย์รวมเอกสาร */

export type DocCategory = "sales" | "purchase" | "stock" | "finance" | "hr";

/** One row of the documents hub: any document, wherever it is kept. */
export interface HubDocument {
  source:
    | "document"
    | "purchase_request"
    | "purchase_order"
    | "stock_document"
    | "supplier_bill"
    | "payment_voucher"
    | "petty_cash_topup"
    | "stock_transfer"
    | "stock_count"
    | "welfare"
    | "payroll_run"
    | "leave_request"
    | "transaction"
    | "pos_return"
    | "pos_sale";
  id: number;
  type: string;
  category: DocCategory;
  docNo: string;
  docDate: string;
  party: string | null;
  amount: number | null;
  status: string;
}

export interface HubPage {
  data: HubDocument[];
  meta: { page: number; pageSize: number; total: number; counts: Partial<Record<DocCategory, number>>; sources: string[] };
}

/** ใบรับสินค้า / ใบปรับสต๊อก / ใบตัดของเสีย */
export interface StockDocument {
  org: { name: string; legalName: string | null; taxId: string | null; address: string | null };
  id: number;
  docType: "goods_receipt" | "adjustment" | "waste";
  docNo: string;
  docDate: string;
  warehouseName: string;
  supplierId: number | null;
  supplierName: string | null;
  supplierTaxId: string | null;
  purchaseOrderId: number | null;
  poNo: string | null;
  reference: string | null;
  reason: string | null;
  note: string | null;
  totalCost: number;
  createdBy: string | null;
  createdAt: string;
  lines: { productId: number; sku: string; name: string; unit: string; quantity: number; unitCost: number | null; value: number; note: string | null }[];
}

/** รายงานสินค้าและวัตถุดิบ (ม.87(3)) */
export interface StockLedger {
  month: string;
  warehouse: { id: number; name: string; branchName: string | null; branchNo: string | null };
  products: {
    productId: number;
    sku: string;
    name: string;
    unit: string;
    opening: number;
    totalIn: number;
    totalOut: number;
    closing: number;
    lines: { date: string; docNo: string; type: string; description: string; qtyIn: number; qtyOut: number; unitCost: number | null; balance: number }[];
  }[];
}

/* ------------------------------------------------------- ซื้อ / เจ้าหนี้ */

export interface PurchaseRequest {
  id: number;
  prNo: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  warehouseId: number;
  warehouseName: string;
  supplierId: number | null;
  supplierName: string | null;
  neededBy: string | null;
  reason: string | null;
  requestedBy: string | null;
  requestedById: number | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  rejectReason: string | null;
  purchaseOrderId: number | null;
  poNo: string | null;
  estTotal: number;
  itemCount: number;
  items?: { productId: number; sku: string; name: string; unit: string; quantity: number; estUnitCost: number; onHand: number }[];
}

export interface SupplierBill {
  id: number;
  kind: "bill" | "credit_note";
  billNo: string;
  supplierId: number;
  supplierName: string;
  supplierTaxId: string | null;
  supplierDocNo: string | null;
  billDate: string;
  dueDate: string | null;
  accountCode: string;
  amount: number;
  vatAmount: number;
  vatClaimable: boolean;
  total: number;
  signedTotal: number;
  purchaseOrderId: number | null;
  poNo: string | null;
  stockDocumentId: number | null;
  grNo: string | null;
  status: "unpaid" | "paid" | "void";
  voucherId: number | null;
  voucherNo: string | null;
  note: string | null;
  createdAt: string;
}

export interface PaymentVoucher {
  id: number;
  pvNo: string;
  supplierId: number;
  supplierName: string;
  supplierTaxId: string | null;
  supplierAddress: string | null;
  payDate: string;
  paymentMethod: string;
  payeeType: "company" | "individual";
  gross: number;
  whtBase: number;
  whtRate: number | null;
  whtIncomeType: string | null;
  whtAmount: number;
  netPaid: number;
  amountText: string;
  reference: string | null;
  status: "posted" | "void";
  note: string | null;
  certificateId: number | null;
  createdBy: string | null;
  createdAt: string;
  bills?: SupplierBill[];
  org?: { name: string; legalName: string | null; taxId: string | null; address: string | null; phone: string | null };
}

export interface PettyCash {
  balance: number;
  topups: { id: number; topupNo: string; date: string; amount: number; fromMethod: string; note: string | null; status: "posted" | "void"; by: string | null }[];
  expenses: { id: number; date: string; category: string; description: string | null; counterparty: string | null; paid: number; status: "posted" | "void" }[];
}

/* -------------------------------------------------------------- บุคคล / HR */

export interface Employee {
  id: number;
  userId: number | null;
  userEmail: string | null;
  empCode: string;
  title: string | null;
  fullName: string;
  displayName: string;
  nationalId: string | null;
  birthDate: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  branchId: number | null;
  branchName: string | null;
  position: string | null;
  department: string | null;
  payType: "monthly" | "daily";
  baseSalary: number;
  startDate: string;
  endDate: string | null;
  status: "active" | "resigned";
  ssoEnrolled: boolean;
  ssoNumber: string | null;
  taxExtraDeductions: number;
  bankName: string | null;
  bankAccount: string | null;
  annualLeaveDays: number;
  note: string | null;
}

export interface PayrollItem {
  id: number;
  employeeId: number;
  empCode: string;
  name: string;
  position: string | null;
  payType: "monthly" | "daily";
  rate: number;
  nationalId: string | null;
  bankName: string | null;
  bankAccount: string | null;
  daysWorked: number | null;
  basePay: number;
  overtime: number;
  allowance: number;
  bonus: number;
  otherIncome: number;
  deduction: number;
  gross: number;
  ssoBase: number;
  ssoEmployee: number;
  ssoEmployer: number;
  wht: number;
  whtManual: boolean;
  net: number;
  note: string | null;
}

export interface PayrollRun {
  id: number;
  runNo: string;
  period: string;
  payDate: string;
  status: "draft" | "approved" | "paid" | "void";
  headcount: number;
  totalGross: number;
  totalSsoEmployee: number;
  totalSsoEmployer: number;
  totalWht: number;
  totalDeductions: number;
  totalNet: number;
  paymentMethod: string | null;
  note: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  items?: PayrollItem[];
}

export interface Payslip extends PayrollItem {
  period: string;
  runNo: string;
  runStatus: PayrollRun["status"];
  payDate: string;
  netText: string;
  ytd: { gross: number; wht: number; sso: number };
  org: { name: string; legalName: string | null; taxId: string | null; address: string | null };
}

export type LeaveType = "sick" | "personal" | "vacation" | "maternity" | "other";

export interface LeaveRequest {
  id: number;
  leaveNo: string;
  employeeId: number;
  empCode: string;
  employeeName: string;
  position: string | null;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  rejectReason: string | null;
}

export interface HrOrg {
  name: string;
  legalName: string | null;
  taxId: string | null;
  address: string | null;
  phone?: string | null;
  branchNo?: string;
}
