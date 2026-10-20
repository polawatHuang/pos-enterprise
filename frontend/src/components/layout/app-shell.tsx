"use client";

import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { AlertTriangle, Loader2, Menu, RefreshCw, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { SheetContent } from "@/components/ui/overlays";
import { Brand, SidebarNav } from "./sidebar-nav";
import { SearchTrigger } from "./command-palette";
import { NotificationBell } from "./notification-bell";
import { ThemeToggle, UserMenu } from "./user-menu";
import { findNavItem } from "@/config/nav";
import { cn } from "@/lib/utils";

const COLLAPSE_KEY = "pe.sidebar.collapsed";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, isLoading, isError, retry } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Lazy read is safe: the server render only ever shows the loading state below
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false; // storage unavailable (private mode)
    }
  });

  // Close the drawer if this shell is hidden by Activity
  useLayoutEffect(() => () => setMobileOpen(false), []);

  // Force first-login password change before using the app
  useEffect(() => {
    if (user?.mustChangePassword && pathname !== "/settings/account") router.replace("/settings/account?first=1");
  }, [user, pathname, router]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  if (!user && isError) {
    return (
      <div className="grid min-h-dvh place-items-center px-4">
        <div className="max-w-sm text-center">
          <AlertTriangle className="mx-auto size-8 text-warning" />
          <p className="mt-3 font-medium">เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ</p>
          <p className="mt-1 text-sm text-muted-foreground">เซิร์ฟเวอร์อาจกำลังเริ่มทำงาน หรืออินเทอร์เน็ตขัดข้อง</p>
          <button
            onClick={retry}
            className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <RefreshCw className="size-4" /> ลองใหม่
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !user) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Loader2 className="size-6 animate-spin text-primary" aria-label="กำลังโหลด" />
      </div>
    );
  }

  const current = findNavItem(pathname);

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col bg-sidebar transition-[width] duration-200 lg:flex",
          collapsed ? "w-[72px]" : "w-64",
        )}
      >
        <Brand collapsed={collapsed} />
        <SidebarNav permissions={user.permissions} collapsed={collapsed} />
        <button
          onClick={toggleCollapsed}
          className="m-3 flex h-9 items-center justify-center gap-2 rounded-lg text-xs text-sidebar-muted hover:bg-white/5 hover:text-white"
          aria-label={collapsed ? "ขยายเมนู" : "ย่อเมนู"}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed && "ย่อเมนู"}
        </button>
      </aside>

      {/* Mobile drawer */}
      <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent title="เมนูหลัก" className="bg-sidebar lg:hidden">
          <Brand />
          <SidebarNav permissions={user.permissions} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Dialog.Root>

      <div className={cn("flex min-h-dvh flex-col transition-[padding] duration-200", collapsed ? "lg:pl-[72px]" : "lg:pl-64")}>
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-accent lg:hidden"
            aria-label="เปิดเมนู"
          >
            <Menu className="size-5" />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground lg:hidden">{current?.label ?? "POS Enterprise"}</p>
            <SearchTrigger />
          </div>
          <NotificationBell />
          <ThemeToggle />
          <UserMenu />
        </header>

        {user.mustChangePassword && (
          <div className="flex items-center gap-2 border-b border-warning/30 bg-warning-soft px-4 py-2.5 text-sm text-warning sm:px-6">
            <AlertTriangle className="size-4 shrink-0" />
            กรุณาเปลี่ยนรหัสผ่านเริ่มต้นก่อนใช้งานระบบ
            <Link href="/settings/account" className="ml-auto font-medium underline underline-offset-2">
              เปลี่ยนเลย
            </Link>
          </div>
        )}

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
