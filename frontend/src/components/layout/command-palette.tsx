"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  ArrowRight,
  Boxes,
  ClipboardList,
  Clock,
  CornerDownLeft,
  FilePlus2,
  HeartHandshake,
  Hourglass,
  Loader2,
  PackagePlus,
  ScanBarcode,
  Search,
  ShoppingCart,
  Truck,
  Video,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ScanButton } from "@/components/ui/barcode-scanner";
import { allNavItems } from "@/config/nav";
import { useAuth } from "@/components/auth/auth-provider";

interface Hit {
  id: string;
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  href: string | null;
  exact?: boolean;
  badge?: string | null;
}
interface SearchResult {
  q: string;
  groups: { key: string; label: string; items: Hit[] }[];
}
interface Row extends Hit {
  group: string;
  icon?: LucideIcon;
}

/** Quick actions: the jobs people open the app for, gated by permission. */
const ACTIONS: { label: string; href: string; icon: LucideIcon; permission: string; keywords: string }[] = [
  { label: "เปิดหน้าขาย (POS)", href: "/pos", icon: ShoppingCart, permission: "pos:sell", keywords: "ขาย pos แคชเชียร์ คิดเงิน" },
  { label: "สั่งของ (ยอดแนะนำแบบ 7-Eleven)", href: "/purchasing", icon: Truck, permission: "inventory:read", keywords: "สั่งซื้อ po ใบสั่งซื้อ order" },
  { label: "รับสินค้าเข้า / ปรับสต๊อก", href: "/inventory", icon: PackagePlus, permission: "inventory:write", keywords: "รับของ สต๊อก stock" },
  { label: "เริ่มตรวจนับสต๊อก", href: "/inventory/counts", icon: ClipboardList, permission: "inventory:count", keywords: "นับ count stocktake" },
  { label: "ดูสินค้าใกล้หมดอายุ", href: "/inventory/expiry", icon: Hourglass, permission: "inventory:read", keywords: "หมดอายุ expiry ของเสีย" },
  { label: "เบิกสินค้าสวัสดิการพนักงาน", href: "/inventory/welfare", icon: HeartHandshake, permission: "welfare:request", keywords: "สวัสดิการ เบิก พนักงาน welfare" },
  { label: "สร้างเอกสาร (ใบเสนอราคา/ใบกำกับภาษี)", href: "/accounting/documents/new", icon: FilePlus2, permission: "accounting:write", keywords: "เอกสาร invoice ใบเสร็จ" },
  { label: "สร้างวิดีโอ AI", href: "/videos", icon: Video, permission: "video:create", keywords: "วิดีโอ video คลิป" },
  { label: "สินค้าคงเหลือทั้งหมด", href: "/inventory", icon: Boxes, permission: "inventory:read", keywords: "คงเหลือ stock" },
];

/** "See all" pages that accept ?q= */
const SEE_ALL: Record<string, string> = { products: "/products", documents: "/accounting/documents", trends: "/trends" };
const RECENT_KEY = "search.recent";

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}
function pushRecent(q: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...readRecent().filter((x) => x !== q)].slice(0, 6)));
  } catch {
    // private mode
  }
}

/** Top-bar search: opens with a click, Ctrl/⌘+K or "/" anywhere outside a text field. */
export function SearchTrigger() {
  const [open, setOpen] = useState(false);
  const [mac, setMac] = useState(false);
  useEffect(() => {
    setTimeout(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), 0);
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="hidden h-9 w-full max-w-md items-center gap-2 rounded-lg border border-border bg-card px-3 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 lg:flex"
        aria-label="ค้นหา"
        data-testid="search-trigger"
      >
        <Search className="size-4" />
        <span className="flex-1 truncate">ค้นหาสินค้า บาร์โค้ด เอกสาร ลูกค้า ใบสั่งซื้อ...</span>
        <kbd className="rounded border border-border bg-muted px-1.5 font-mono text-[10px]">{mac ? "⌘" : "Ctrl"} K</kbd>
      </button>
      <button onClick={() => setOpen(true)} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-accent lg:hidden" aria-label="ค้นหา">
        <Search className="size-5" />
      </button>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        {open && <Palette onClose={() => setOpen(false)} />}
      </DialogPrimitive.Root>
    </>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const [recent] = useState(readRecent);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 180);
    return () => clearTimeout(t);
  }, [q]);

  const search = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api.get<SearchResult>("/search", { q: debounced }),
    enabled: debounced.length >= 1,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

  const term = q.trim().toLowerCase();
  const rows = useMemo<Row[]>(() => {
    const pages = allNavItems
      .filter((i) => (typeof i.permission === "string" ? can(i.permission) : i.permission.some(can)) && (!term || i.label.toLowerCase().includes(term)))
      .map((i) => ({ id: `nav${i.href}`, title: i.label, subtitle: i.href, href: i.href, group: "ไปที่หน้า", icon: i.icon }));
    const actions = ACTIONS.filter((a) => can(a.permission) && (!term || `${a.label} ${a.keywords}`.toLowerCase().includes(term))).map((a) => ({
      id: `act${a.href}${a.label}`,
      title: a.label,
      href: a.href,
      group: "ทำรายการด่วน",
      icon: a.icon,
    }));
    if (!term) {
      return [
        ...recent.map((r) => ({ id: `recent${r}`, title: r, href: null, group: "ค้นหาล่าสุด", icon: Clock })),
        ...actions.slice(0, 6),
        ...pages.slice(0, 8),
      ];
    }
    const server = debounced && search.data?.q === debounced ? search.data.groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label }))) : [];
    return [...server, ...actions.slice(0, 4), ...pages.slice(0, 5)];
  }, [term, debounced, search.data, recent, can]);

  const go = (r: Row) => {
    if (r.group === "ค้นหาล่าสุด") {
      setQ(r.title);
      setActive(0);
      return;
    }
    if (!r.href) return;
    if (term) pushRecent(q.trim());
    onClose();
    router.push(r.href);
  };

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = rows[Math.min(active, rows.length - 1)];
      if (r) go(r);
      else if (term && can("products:read")) {
        pushRecent(q.trim());
        onClose();
        router.push(`/products?q=${encodeURIComponent(q.trim())}`);
      }
    }
  };

  const grouped = rows.reduce<{ group: string; items: (Row & { index: number })[] }[]>((acc, r, index) => {
    const last = acc.at(-1);
    if (last && last.group === r.group) last.items.push({ ...r, index });
    else acc.push({ group: r.group, items: [{ ...r, index }] });
    return acc;
  }, []);
  const serverGroup = (label: string) => search.data?.groups.find((g) => g.label === label)?.key;
  const loading = search.isFetching && debounced.length > 0;

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className="fixed left-1/2 top-[8vh] z-50 flex max-h-[80dvh] w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onKeyDown={onKeyDown}
        aria-describedby={undefined}
      >
        <DialogPrimitive.Title className="sr-only">ค้นหา</DialogPrimitive.Title>
        <div className="flex items-center gap-3 border-b border-border px-4">
          {loading ? <Loader2 className="size-5 animate-spin text-primary" /> : <Search className="size-5 text-muted-foreground" />}
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            placeholder="พิมพ์ชื่อสินค้า สแกนบาร์โค้ด เลขเอกสาร เบอร์ลูกค้า เลขใบสั่งซื้อ..."
            className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            aria-label="ค้นหาทั้งระบบ"
            data-testid="search-input"
          />
          <ScanButton
            variant="ghost"
            title="สแกนบาร์โค้ดเพื่อค้นหา"
            className="-mr-2 text-muted-foreground"
            onDetected={(code) => {
              setQ(code);
              setActive(0);
            }}
          />
          <kbd className="hidden rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground sm:block">Esc</kbd>
        </div>
        <div ref={listRef} className="flex-1 overflow-y-auto p-2" role="listbox" aria-label="ผลการค้นหา">
          {term && !loading && debounced === q.trim() && rows.length === 0 && (
            <div className="grid place-items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <ScanBarcode className="size-8 opacity-40" />
              ไม่พบ &quot;{q.trim()}&quot; — ลองพิมพ์บางส่วนของชื่อ, SKU หรือเบอร์โทร
            </div>
          )}
          {grouped.map((g) => {
            const key = serverGroup(g.group);
            return (
              <div key={g.group} className="mb-1">
                <div className="flex items-center justify-between px-2 pb-1 pt-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.group}</p>
                  {key && SEE_ALL[key] && (
                    <button
                      className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                      onClick={() => {
                        pushRecent(q.trim());
                        onClose();
                        router.push(`${SEE_ALL[key]}?q=${encodeURIComponent(q.trim())}`);
                      }}
                    >
                      ดูทั้งหมด <ArrowRight className="size-3" />
                    </button>
                  )}
                </div>
                {g.items.map((r) => {
                  const i = r.index;
                  const Icon = r.icon;
                  return (
                    <button
                      key={r.id}
                      data-index={i}
                      role="option"
                      aria-selected={i === active}
                      onMouseMove={() => setActive(i)}
                      onClick={() => go(r)}
                      disabled={!r.href && r.group !== "ค้นหาล่าสุด"}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm",
                        i === active ? "bg-primary-soft text-foreground" : "hover:bg-accent/60",
                        !r.href && r.group !== "ค้นหาล่าสุด" && "cursor-default opacity-80",
                      )}
                      data-testid="search-row"
                    >
                      {Icon ? (
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <span className={cn("size-2 shrink-0 rounded-full", r.exact ? "bg-success" : "bg-primary/40")} />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {r.title}
                          {r.exact && <span className="ml-2 rounded bg-success-soft px-1.5 py-0.5 text-[10px] font-semibold text-success">ตรงรหัส</span>}
                          {r.badge && <span className="ml-2 rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-warning">{r.badge}</span>}
                        </span>
                        {r.subtitle && <span className="block truncate text-xs text-muted-foreground">{r.subtitle}</span>}
                      </span>
                      {r.meta && <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{r.meta}</span>}
                      {i === active && r.href && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <span>↑↓ เลือก</span>
          <span>Enter เปิด</span>
          <span>Esc ปิด</span>
          <span className="ml-auto hidden sm:inline">กด / หรือ Ctrl+K ได้จากทุกหน้า</span>
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
