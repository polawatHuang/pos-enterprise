"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { hasPermission, navGroups } from "@/config/nav";
import { cn } from "@/lib/utils";

export function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className={cn("flex h-16 shrink-0 items-center gap-3 px-5", collapsed && "justify-center px-0")}>
      <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-base font-bold text-primary-foreground shadow-lg shadow-primary/30">
        P
      </div>
      {!collapsed && (
        <div className="leading-tight">
          <p className="text-sm font-semibold text-white">POS Enterprise</p>
          <p className="text-[11px] text-sidebar-muted">Commerce OS</p>
        </div>
      )}
    </div>
  );
}

export function SidebarNav({
  permissions,
  collapsed = false,
  onNavigate,
}: {
  permissions: string[];
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  // The most specific matching item wins (/inventory/counts must not also light up /inventory)
  const matches = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const best = navGroups
    .flatMap((g) => g.items.map((i) => i.href))
    .filter(matches)
    .sort((a, b) => b.length - a.length)[0];
  const groups = navGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => hasPermission(permissions, i.permission)) }))
    .filter((g) => g.items.length > 0);

  return (
    <nav aria-label="เมนูหลัก" className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-6">
      {groups.map((group) => (
        <div key={group.label} className="mt-5 first:mt-2">
          {!collapsed && (
            <p className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wider text-sidebar-muted">{group.label}</p>
          )}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = item.href === best;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
                      collapsed && "justify-center px-0",
                      active
                        ? "bg-sidebar-active font-medium text-white"
                        : "text-sidebar-foreground/80 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <Icon className={cn("size-[18px] shrink-0", active ? "text-white" : "text-sidebar-muted group-hover:text-white")} />
                    {!collapsed && (
                      <>
                        <span className="min-w-0 truncate">{item.label}</span>
                        {item.phase > 1 && (
                          <span className="ml-auto shrink-0 whitespace-nowrap rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-sidebar-muted">
                            เฟส {item.phase}
                          </span>
                        )}
                      </>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
