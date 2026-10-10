"use client";

import { useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { KeyRound, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlays";
import { initials } from "@/lib/utils";

export const ROLE_LABELS: Record<string, string> = {
  owner: "เจ้าของกิจการ",
  admin: "ผู้ดูแลระบบ",
  manager: "ผู้จัดการ",
  accountant: "นักบัญชี",
  cashier: "แคชเชียร์",
  marketer: "การตลาด",
  support: "แอดมินแชต",
  viewer: "ผู้ดูรายงาน",
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const label = { light: "ธีมสว่าง", dark: "ธีมมืด", system: "ตามระบบ" }[theme ?? "system"] ?? "ตามระบบ";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
      aria-label={`เปลี่ยนธีม (ตอนนี้: ${label})`}
      title={label}
    >
      <Icon className="size-[18px]" suppressHydrationWarning />
    </button>
  );
}

export function UserMenu() {
  const { user, logout } = useAuth();
  // Controlled so the menu closes when Activity hides this route (see Next.js "Preserving UI state")
  const [open, setOpen] = useState(false);
  if (!user) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger className="flex items-center gap-2.5 rounded-lg p-1 pr-2 hover:bg-accent" aria-label="เมนูผู้ใช้">
        <span className="grid size-8 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
          {initials(user.fullName)}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block max-w-36 truncate text-sm font-medium">{user.fullName}</span>
          <span className="block text-[11px] text-muted-foreground">{user.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <span className="block truncate font-medium text-foreground">{user.fullName}</span>
          <span className="block truncate">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/account">
            <KeyRound /> บัญชีและรหัสผ่าน
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()} className="text-danger [&_svg]:text-danger">
          <LogOut /> ออกจากระบบ
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
