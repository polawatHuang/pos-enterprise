"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GripVertical, Pin, PinOff } from "lucide-react";
import { hasPermission, isFrontline, navGroups, type NavItem } from "@/config/nav";
import { cn } from "@/lib/utils";

export function Brand({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  return (
    <div className={cn("flex h-16 shrink-0 items-center gap-3 px-5", collapsed && "justify-center px-0", className)}>
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

interface SidebarPreferences {
  showAll: boolean;
  pinned: string[];
  order: string[];
}

function readPreferences(storageKey: string): SidebarPreferences {
  try {
    if (typeof window === "undefined") return { showAll: false, pinned: [], order: [] };
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as {
      showAll?: unknown;
      pinned?: unknown;
      order?: unknown;
    };
    return {
      showAll: saved.showAll === true,
      pinned: Array.isArray(saved.pinned) ? saved.pinned.filter((href): href is string => typeof href === "string") : [],
      order: Array.isArray(saved.order) ? saved.order.filter((href): href is string => typeof href === "string") : [],
    };
  } catch {
    return { showAll: false, pinned: [], order: [] };
  }
}

export function SidebarNav({
  permissions,
  userId,
  collapsed = false,
  scrollable = true,
  onNavigate,
}: {
  permissions: string[];
  userId: number;
  collapsed?: boolean;
  scrollable?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const storageKey = `pe.sidebar.preferences.${userId}`;
  // The most specific matching item wins (/inventory/counts must not also light up /inventory)
  const matches = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const best = navGroups
    .flatMap((g) => g.items.map((i) => i.href))
    .filter(matches)
    .sort((a, b) => b.length - a.length)[0];
  // A cashier starts with the few pages they use; the rest is one tap away and the choice is remembered
  const frontline = isFrontline(permissions);
  const [preferences, setPreferences] = useState(() => readPreferences(storageKey));
  const { showAll, pinned, order } = preferences;
  const [draggedHref, setDraggedHref] = useState<string | null>(null);
  const [draggedSection, setDraggedSection] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const touchDrop = useRef<{ pointerId: number; href: string | null; after: boolean } | null>(null);

  const persist = (next: Partial<SidebarPreferences>) => {
    setPreferences((current) => ({ ...current, ...next }));
    try {
      const current = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Record<string, unknown>;
      localStorage.setItem(storageKey, JSON.stringify({ ...current, ...next }));
    } catch {
      // Preferences remain active for this visit when browser storage is unavailable.
    }
  };
  const toggleAll = () => {
    const next = !showAll;
    persist({ showAll: next });
  };

  const permittedItems = useMemo(
    () => navGroups.flatMap((group) => group.items).filter((item) => hasPermission(permissions, item.permission)),
    [permissions],
  );
  const ordered = (items: NavItem[]) =>
    [...items].sort((a, b) => {
      const aIndex = order.indexOf(a.href);
      const bIndex = order.indexOf(b.href);
      return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex);
    });
  const pinnedItems = ordered(permittedItems.filter((item) => pinned.includes(item.href)));
  const short = frontline && !showAll;
  const groups = navGroups
    .map((g) => ({
      ...g,
      items: ordered(g.items.filter((i) =>
        hasPermission(permissions, i.permission) &&
        !pinned.includes(i.href) &&
        (!short || i.essential || i.href === best),
      )),
    }))
    .filter((g) => g.items.length > 0);

  const togglePinned = (href: string) => {
    const next = pinned.includes(href) ? pinned.filter((item) => item !== href) : [...pinned, href];
    persist({ pinned: next });
  };

  const reorder = (targetHref: string, targetSection: string, after: boolean) => {
    if (!draggedHref || draggedHref === targetHref || draggedSection !== targetSection) return;
    const next = [...order];
    const allHrefs = permittedItems.map((item) => item.href);
    const completeOrder = [...new Set([...next.filter((href) => allHrefs.includes(href)), ...allHrefs])];
    const from = completeOrder.indexOf(draggedHref);
    if (from < 0 || !completeOrder.includes(targetHref)) return;
    completeOrder.splice(from, 1);
    const targetIndex = completeOrder.indexOf(targetHref);
    completeOrder.splice(targetIndex + (after ? 1 : 0), 0, draggedHref);
    persist({ order: completeOrder });
    setDraggedHref(null);
    setDraggedSection(null);
    setDropTarget(null);
  };

  const renderItem = (item: NavItem, section: string) => {
    const active = item.href === best;
    const Icon = item.icon;
    return (
      <li
        key={item.href}
        data-sidebar-item
        data-nav-href={item.href}
        data-nav-section={section}
        onDragStart={(event) => {
          setDraggedHref(item.href);
          setDraggedSection(section);
          setDropTarget(null);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", item.href);
        }}
        onDragOver={(event) => {
          if (draggedHref && draggedSection === section) {
            event.preventDefault();
            setDropTarget(item.href);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          const bounds = event.currentTarget.getBoundingClientRect();
          reorder(item.href, section, event.clientY > bounds.top + bounds.height / 2);
        }}
        onDragEnd={() => {
          setDraggedHref(null);
          setDraggedSection(null);
          setDropTarget(null);
        }}
        className={cn(draggedHref === item.href && "opacity-40", dropTarget === item.href && "rounded-lg ring-1 ring-primary")}
      >
        <div className="group flex h-10 items-center rounded-lg">
          {!collapsed && (
            <button
              type="button"
              draggable={!collapsed}
              className="touch-none grid h-full w-7 shrink-0 cursor-grab place-items-center text-sidebar-muted/60 active:cursor-grabbing"
              aria-label={`ลากเพื่อเรียงลำดับ ${item.label}`}
              onPointerDown={(event) => {
                if (event.pointerType !== "touch") return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                touchDrop.current = { pointerId: event.pointerId, href: null, after: false };
                setDraggedHref(item.href);
                setDraggedSection(section);
                setDropTarget(null);
              }}
              onPointerMove={(event) => {
                if (touchDrop.current?.pointerId !== event.pointerId) return;
                const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-sidebar-item]");
                const href = target?.dataset.navHref;
                if (target?.dataset.navSection === section && href && href !== item.href) {
                  const bounds = target.getBoundingClientRect();
                  touchDrop.current.href = href;
                  touchDrop.current.after = event.clientY > bounds.top + bounds.height / 2;
                  setDropTarget(href);
                } else {
                  touchDrop.current.href = null;
                  setDropTarget(null);
                }
              }}
              onPointerUp={(event) => {
                if (touchDrop.current?.pointerId !== event.pointerId) return;
                const target = touchDrop.current;
                touchDrop.current = null;
                if (target.href) reorder(target.href, section, target.after);
                else {
                  setDraggedHref(null);
                  setDraggedSection(null);
                  setDropTarget(null);
                }
              }}
              onPointerCancel={() => {
                touchDrop.current = null;
                setDraggedHref(null);
                setDraggedSection(null);
                setDropTarget(null);
              }}
            >
              <GripVertical className="size-3.5" />
            </button>
          )}
          <Link
            href={item.href}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
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
          {!collapsed && (
            <button
              type="button"
              onClick={() => togglePinned(item.href)}
              className="mr-1 grid size-8 shrink-0 place-items-center rounded-md text-sidebar-muted transition hover:bg-white/10 hover:text-white lg:opacity-0 lg:group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={pinned.includes(item.href) ? `ถอนหมุด ${item.label}` : `ปักหมุด ${item.label}`}
              title={pinned.includes(item.href) ? "ถอนหมุด" : "ปักหมุด"}
            >
              {pinned.includes(item.href) ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <nav
      aria-label="เมนูหลัก"
      className={cn(
        "w-full touch-pan-y px-3 pb-6",
        scrollable
          ? "scrollbar-thin min-h-0 flex-1 basis-0 overflow-x-hidden overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]"
          : "min-h-0 flex-none overflow-visible",
      )}
    >
      {pinnedItems.length > 0 && (
        <div className="mt-5 first:mt-2">
          {!collapsed && <p className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wider text-sidebar-muted">ปักหมุด</p>}
          <ul className="space-y-0.5">{pinnedItems.map((item) => renderItem(item, "pinned"))}</ul>
        </div>
      )}
      {groups.map((group) => (
        <div key={group.label} className="mt-5 first:mt-2">
          {!collapsed && (
            <p className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wider text-sidebar-muted">{group.label}</p>
          )}
          <ul className="space-y-0.5">{group.items.map((item) => renderItem(item, group.label))}</ul>
        </div>
      ))}
      {frontline && !collapsed && (
        <button
          type="button"
          onClick={toggleAll}
          className="mt-5 h-10 w-full rounded-lg px-3 text-left text-sm text-sidebar-muted hover:bg-white/5 hover:text-white"
        >
          {short ? "แสดงเมนูทั้งหมด" : "แสดงเฉพาะเมนูที่ใช้บ่อย"}
        </button>
      )}
    </nav>
  );
}
