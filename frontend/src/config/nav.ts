import {
  BadgePercent,
  BellRing,
  BarChart3,
  Bot,
  Boxes,
  Calculator,
  CalendarClock,
  ClipboardList,
  FileText,
  Landmark,
  Wallet,
  Clapperboard,
  ImagePlay,
  DatabaseZap,
  Factory,
  Percent,
  Tags,
  Store,
  UserRound,
  LayoutDashboard,
  Link2,
  MessagesSquare,
  Package,
  PackageX,
  PlugZap,
  Share2,
  ShoppingCart,
  TrendingUp,
  Truck,
  Hourglass,
  HeartHandshake,
  Users,
  ScrollText,
  Contact,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** User needs this permission to see the item (an array = any one of them) */
  permission: string | string[];
  /** Delivery phase of a module not yet built; 1 = available now (no badge) */
  phase: number;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Customers (CRM) open for anyone who sells, chats with customers or does the books. */
export const CUSTOMERS_READ = ["pos:sell", "inbox:read", "accounting:read"];
/** Who may add or edit a customer. */
export const CUSTOMERS_WRITE = ["pos:sell", "inbox:reply"];

/** Welfare withdrawals: staff who request them, and managers who approve them. */
export const WELFARE_ACCESS = ["welfare:request", "inventory:approve", "inventory:write"];

/** True when `permissions` satisfies a nav permission (a string, or any one of an array). */
export function hasPermission(permissions: readonly string[], required: string | readonly string[]) {
  return typeof required === "string" ? permissions.includes(required) : required.some((p) => permissions.includes(p));
}

export const navGroups: NavGroup[] = [
  {
    label: "ภาพรวม",
    items: [{ href: "/dashboard", label: "Smart Dashboard", icon: LayoutDashboard, permission: "dashboard:view", phase: 1 }],
  },
  {
    label: "ขายและสต๊อก",
    items: [
      { href: "/pos", label: "ขายหน้าร้าน (POS)", icon: ShoppingCart, permission: "pos:sell", phase: 1 },
      { href: "/promotions", label: "โปรโมชั่น", icon: BadgePercent, permission: "pos:sell", phase: 1 },
      { href: "/products", label: "สินค้า", icon: Package, permission: "products:read", phase: 1 },
      { href: "/products/categories", label: "หมวดหมู่สินค้า", icon: Tags, permission: "products:read", phase: 1 },
      { href: "/inventory", label: "สต๊อกสินค้า", icon: Boxes, permission: "inventory:read", phase: 1 },
      { href: "/inventory/counts", label: "ตรวจนับสต๊อก", icon: ClipboardList, permission: "inventory:count", phase: 1 },
      { href: "/purchasing", label: "สั่งซื้อ & รับของ", icon: Truck, permission: "inventory:read", phase: 1 },
      { href: "/purchasing/suppliers", label: "ผู้ขาย", icon: Factory, permission: "inventory:read", phase: 1 },
      { href: "/inventory/expiry", label: "ใกล้หมดอายุ", icon: Hourglass, permission: "inventory:read", phase: 1 },
      { href: "/inventory/welfare", label: "เบิกสวัสดิการพนักงาน", icon: HeartHandshake, permission: WELFARE_ACCESS, phase: 1 },
    ],
  },
  {
    label: "บัญชี",
    items: [
      { href: "/accounting", label: "ภาพรวมบัญชี", icon: Calculator, permission: "accounting:read", phase: 1 },
      { href: "/accounting/transactions", label: "รายรับ-รายจ่าย", icon: Wallet, permission: "accounting:read", phase: 1 },
      { href: "/accounting/documents", label: "เอกสาร", icon: FileText, permission: "accounting:read", phase: 1 },
      { href: "/accounting/tax", label: "ภาษี", icon: Landmark, permission: "accounting:read", phase: 1 },
      { href: "/accounting/reports", label: "รายงานการเงิน", icon: BarChart3, permission: "accounting:read", phase: 1 },
    ],
  },
  {
    label: "ลูกค้าและการตลาด",
    items: [
      { href: "/customers", label: "ลูกค้า", icon: Contact, permission: CUSTOMERS_READ, phase: 1 },
      { href: "/inbox", label: "แชตลูกค้า + AI", icon: MessagesSquare, permission: "inbox:read", phase: 1 },
      { href: "/inbox/aftersales", label: "คืนสินค้า & ข้อเสนอ", icon: PackageX, permission: "inbox:read", phase: 1 },
      { href: "/inbox/settings", label: "ตั้งค่า AI แชต", icon: Bot, permission: "inbox:read", phase: 1 },
      { href: "/trends", label: "สินค้าเทรนด์", icon: TrendingUp, permission: "scraping:read", phase: 1 },
      { href: "/trends/sources", label: "แหล่งข้อมูลเทรนด์", icon: DatabaseZap, permission: "scraping:read", phase: 1 },
      { href: "/trends/channel", label: "โปรไฟล์ช่อง", icon: UserRound, permission: "scraping:read", phase: 1 },
      { href: "/videos", label: "AI Video", icon: Clapperboard, permission: "video:create", phase: 1 },
      { href: "/covers", label: "AI ปกคลิป", icon: ImagePlay, permission: "video:create", phase: 1 },
      { href: "/social", label: "ตั้งเวลาโพสต์", icon: CalendarClock, permission: "social:read", phase: 1 },
      { href: "/social/accounts", label: "บัญชีโซเชียล", icon: Share2, permission: "social:read", phase: 1 },
      { href: "/social/links", label: "ลิงก์ Affiliate", icon: Link2, permission: "social:read", phase: 1 },
    ],
  },
  {
    label: "ตั้งค่า",
    items: [
      { href: "/settings/users", label: "ผู้ใช้และสิทธิ์", icon: Users, permission: "users:read", phase: 1 },
      { href: "/settings/tax", label: "ภาษีมูลค่าเพิ่ม", icon: Percent, permission: "settings:manage", phase: 1 },
      { href: "/settings/branches", label: "สาขาและคลังสินค้า", icon: Store, permission: "settings:manage", phase: 1 },
      { href: "/settings/integrations", label: "การเชื่อมต่อ API", icon: PlugZap, permission: "integrations:manage", phase: 1 },
      { href: "/settings/notifications", label: "แจ้งเตือน LINE", icon: BellRing, permission: "settings:manage", phase: 1 },
      { href: "/settings/audit", label: "บันทึกการใช้งาน", icon: ScrollText, permission: "audit:read", phase: 1 },
      { href: "/settings/data", label: "จัดการข้อมูล", icon: DatabaseZap, permission: "settings:manage", phase: 1 },
    ],
  },
];

export const allNavItems = navGroups.flatMap((g) => g.items);

export function findNavItem(pathname: string) {
  return allNavItems
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/** First page the user may open — used as the post-login landing page. */
export function homeFor(permissions: string[]) {
  return allNavItems.find((i) => hasPermission(permissions, i.permission))?.href ?? "/settings/account";
}
