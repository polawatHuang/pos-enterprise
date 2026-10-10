import {
  BarChart3,
  Bot,
  Boxes,
  Calculator,
  CalendarClock,
  FileText,
  Landmark,
  Wallet,
  Clapperboard,
  DatabaseZap,
  LayoutDashboard,
  MessagesSquare,
  Package,
  PackageX,
  PlugZap,
  ShoppingCart,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** User needs this permission to see the item */
  permission: string;
  /** Delivery phase of a module not yet built; 1 = available now (no badge) */
  phase: number;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
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
      { href: "/products", label: "สินค้า", icon: Package, permission: "products:read", phase: 1 },
      { href: "/inventory", label: "สต๊อกสินค้า", icon: Boxes, permission: "inventory:read", phase: 1 },
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
      { href: "/inbox", label: "แชตลูกค้า + AI", icon: MessagesSquare, permission: "inbox:read", phase: 1 },
      { href: "/inbox/aftersales", label: "คืนสินค้า & ข้อเสนอ", icon: PackageX, permission: "inbox:read", phase: 1 },
      { href: "/inbox/settings", label: "ตั้งค่า AI แชต", icon: Bot, permission: "inbox:read", phase: 1 },
      { href: "/trends", label: "สินค้าเทรนด์", icon: TrendingUp, permission: "scraping:read", phase: 1 },
      { href: "/trends/sources", label: "แหล่งข้อมูลเทรนด์", icon: DatabaseZap, permission: "scraping:read", phase: 1 },
      { href: "/videos", label: "AI Video", icon: Clapperboard, permission: "video:create", phase: 6 },
      { href: "/social", label: "ตั้งเวลาโพสต์ & Affiliate", icon: CalendarClock, permission: "social:read", phase: 7 },
    ],
  },
  {
    label: "ตั้งค่า",
    items: [
      { href: "/settings/users", label: "ผู้ใช้และสิทธิ์", icon: Users, permission: "users:read", phase: 1 },
      { href: "/settings/integrations", label: "การเชื่อมต่อ API", icon: PlugZap, permission: "integrations:manage", phase: 1 },
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
  return allNavItems.find((i) => permissions.includes(i.permission))?.href ?? "/settings/account";
}
