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
