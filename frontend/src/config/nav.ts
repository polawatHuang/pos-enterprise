import {
  BarChart3,
  Boxes,
  Calculator,
  CalendarClock,
  Clapperboard,
  LayoutDashboard,
  MessagesSquare,
  Package,
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
  /** Delivery phase; items with phase > 1 show a "เร็วๆ นี้" badge */
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
      { href: "/pos", label: "ขายหน้าร้าน (POS)", icon: ShoppingCart, permission: "pos:sell", phase: 2 },
      { href: "/products", label: "สินค้า", icon: Package, permission: "products:read", phase: 2 },
      { href: "/inventory", label: "สต๊อกสินค้า", icon: Boxes, permission: "inventory:read", phase: 2 },
    ],
  },
  {
    label: "บัญชี",
    items: [{ href: "/accounting", label: "รายรับรายจ่ายและภาษี", icon: Calculator, permission: "accounting:read", phase: 3 }],
  },
  {
    label: "ลูกค้าและการตลาด",
    items: [
      { href: "/inbox", label: "Unified Inbox + AI", icon: MessagesSquare, permission: "inbox:read", phase: 4 },
      { href: "/trends", label: "สินค้าขายดี (Scraping)", icon: TrendingUp, permission: "scraping:read", phase: 5 },
      { href: "/videos", label: "AI Video", icon: Clapperboard, permission: "video:create", phase: 6 },
      { href: "/social", label: "ตั้งเวลาโพสต์ & Affiliate", icon: CalendarClock, permission: "social:read", phase: 7 },
    ],
  },
  {
    label: "ตั้งค่า",
    items: [
      { href: "/settings/users", label: "ผู้ใช้และสิทธิ์", icon: Users, permission: "users:read", phase: 1 },
      { href: "/settings/integrations", label: "การเชื่อมต่อ API", icon: PlugZap, permission: "integrations:manage", phase: 1 },
      { href: "/settings/reports", label: "รายงาน", icon: BarChart3, permission: "audit:read", phase: 3 },
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
