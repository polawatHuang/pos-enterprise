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
