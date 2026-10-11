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
  firstSeenAt: string;
  lastSeenAt: string;
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

export type SourcePlatform = "shopee_affiliate" | "apify" | "custom_url" | "tiktok_shop" | "shopee";

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
}

export interface VideoProject {
  id: number;
  title: string;
  productId: number | null;
  productName: string | null;
  trendId: number | null;
  imageUrl: string | null;
  brief: { tone?: string; lengthSec?: number; audience?: string; notes?: string };
  scenes: VideoScene[];
  postCaption: string | null;
  hashtags: string | null;
  voiceProvider: "minimax" | "elevenlabs";
  voiceId: string | null;
  visualMode: "ai_clips" | "product_images";
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
  assets: VideoAsset[];
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
    compose: Capability & { env: string };
    storage: Capability;
  };
  tones: Record<string, string>;
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
