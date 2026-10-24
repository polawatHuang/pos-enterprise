"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight, FileStack, Plus, Search, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { DocCategory, HubDocument, HubPage } from "@/lib/types";
import { cn, formatMoney, formatThaiDate, monthRange, todayStr } from "@/lib/utils";
import { hasPermission } from "@/config/nav";
import { useAuth } from "@/components/auth/auth-provider";
import { Badge, Card, Input, NativeSelect, Pagination, Skeleton } from "@/components/ui/primitives";
import {
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlays";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page";
import { ErrorNote } from "@/components/dashboard/widgets";
import { SaleDetailDialog } from "@/components/accounting/sale-detail";
import { CATEGORY, CATEGORY_ORDER, CREATE_MENU, RELATED, hrefOf, statusOf, typeLabel } from "./hub-labels";

type Period = "month" | "last" | "3m" | "year" | "all" | "custom";
const PERIODS: { value: Period; label: string }[] = [
  { value: "month", label: "เดือนนี้" },
  { value: "last", label: "เดือนก่อน" },
  { value: "3m", label: "3 เดือนล่าสุด" },
  { value: "year", label: "ปีนี้" },
  { value: "all", label: "ทั้งหมด" },
  { value: "custom", label: "กำหนดเอง…" },
];

function rangeOf(p: Period, custom: { from: string; to: string }): { from?: string; to?: string } {
  if (p === "month") return monthRange(0);
  if (p === "last") return monthRange(-1);
  if (p === "3m") return { from: monthRange(-2).from, to: monthRange(0).to };
  if (p === "year") return { from: `${todayStr().slice(0, 4)}-01-01`, to: `${todayStr().slice(0, 4)}-12-31` };
  if (p === "custom") return { from: custom.from || undefined, to: custom.to || undefined };
  return {};
}

/** Which categories each source feeds: a category shows only when the user can read one of its sources. */
const SOURCE_CATEGORIES: Record<string, DocCategory[]> = {
  documents: ["sales", "finance"],
  purchase_orders: ["purchase"],
  stock_documents: ["purchase", "stock"],
  stock_transfers: ["stock"],
  stock_counts: ["stock"],
  welfare: ["hr"],
  transactions: ["finance"],
  pos_returns: ["sales"],
  pos_sales: ["sales"],
};

const CATEGORY_TONE: Record<DocCategory, string> = {
  sales: "bg-primary/10 text-primary",
  purchase: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  stock: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  finance: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  hr: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

/**
 * ศูนย์รวมเอกสาร: every document of the business in one list — sales, purchasing, stock, money and
 * tax, staff — searchable by number or name, filtered by category, type and period. Each row opens
 * the page where that document is managed; "สร้างเอกสาร" lists every kind, grouped the same way.
 */
export function DocumentsHub() {
  const { user } = useAuth();
  const perms = user?.permissions ?? [];
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [category, setCategory] = useState<DocCategory | "">((params.get("category") as DocCategory | null) ?? "");
  const [type, setType] = useState(params.get("type") ?? "");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [search, setSearch] = useState(q);
  const [period, setPeriod] = useState<Period>(params.get("q") || params.get("status") ? "all" : "3m");
  const [custom, setCustom] = useState({ from: monthRange(0).from, to: todayStr() });
  const [includePos, setIncludePos] = useState(false);
  const [page, setPage] = useState(1);
  const [sale, setSale] = useState<number | null>(null);

  // typing settles for a moment before the list reloads
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  // the address keeps the category and search, so a link or the back button lands on the same list
  useEffect(() => {
    const sp = new URLSearchParams();
    if (category) sp.set("category", category);
    if (search) sp.set("q", search);
    if (status) sp.set("status", status);
    const next = sp.toString();
    if (next !== params.toString()) router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the filters drive the address
  }, [category, search, status]);

  const range = rangeOf(period, custom);
  const query = {
    category: category || undefined,
    type: type || undefined,
    status: status || undefined,
    q: search || undefined,
    ...range,
    includePos: includePos ? "1" : "0",
    page,
    pageSize: 30,
  };
  const list = useQuery({
    queryKey: ["documents-hub", query],
    queryFn: () => apiFetch<HubPage>("/documents/hub", { query }),
    placeholderData: keepPreviousData,
  });
  const meta = list.data?.meta;
  const sources = useMemo(() => meta?.sources ?? [], [meta]);
  const visible = useMemo(() => CATEGORY_ORDER.filter((c) => sources.some((s) => SOURCE_CATEGORIES[s]?.includes(c))), [sources]);
  const counts = meta?.counts ?? {};
  const totalAll = Object.values(counts).reduce((s, n) => s + (n ?? 0), 0);
  const pick = (c: DocCategory | "") => {
    setCategory(c);
    setType("");
    setStatus("");
    setPage(1);
  };
  const createGroups = CREATE_MENU.map((g) => ({ ...g, items: g.items.filter((i) => hasPermission(perms, i.permission)) })).filter((g) => g.items.length);
  const related = (category ? (RELATED[category] ?? []) : Object.values(RELATED).flat()).filter((r) => hasPermission(perms, r.permission));
  const typeOptions = category ? CATEGORY[category].types : visible.flatMap((c) => CATEGORY[c].types);

  const open = (d: HubDocument) => {
    const href = hrefOf(d);
    if (href) router.push(href);
    else setSale(d.id);
  };

  return (
    <>
      <PageHeader
        title="ศูนย์เอกสาร"
        description="เอกสารทุกอย่างของร้านในที่เดียว — ขาย ซื้อ สต๊อก การเงินและภาษี บุคคล ค้นหาด้วยเลขที่หรือชื่อคู่ค้า แล้วกดเปิดจัดการต่อได้ทันที"
        actions={
          createGroups.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger className={buttonVariants()}>
                <Plus /> สร้างเอกสาร
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-[70vh] w-72 overflow-y-auto">
                {createGroups.map((g, gi) => (
                  <div key={g.category}>
                    {gi > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel>{CATEGORY[g.category].label}</DropdownMenuLabel>
                    {g.items.map((i) => (
                      <DropdownMenuItem key={i.label} onSelect={() => router.push(i.href)}>
                        <i.icon className="size-4 text-muted-foreground" /> {i.label}
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      />

      {/* categories: one tap filters the list; the numbers follow the search and period */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" role="tablist" aria-label="หมวดเอกสาร">
        <CategoryCard
          active={category === ""}
          onClick={() => pick("")}
          icon={FileStack}
          label="ทั้งหมด"
          hint="ทุกหมวด"
          count={meta ? totalAll : undefined}
          tone="bg-muted text-foreground"
        />
        {visible.map((c) => (
          <CategoryCard
            key={c}
            active={category === c}
            onClick={() => pick(c)}
            icon={CATEGORY[c].icon}
            label={CATEGORY[c].label}
            hint={CATEGORY[c].hint}
            count={meta ? (counts[c] ?? 0) : undefined}
            tone={CATEGORY_TONE[c]}
          />
        ))}
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:flex-wrap lg:items-center">
          <div className="relative w-full lg:max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหาเลขที่เอกสาร หรือชื่อลูกค้า / ผู้ขาย / พนักงาน"
              className="h-10 pl-9"
              aria-label="ค้นหาเอกสาร"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <NativeSelect aria-label="ช่วงเวลา" className="h-10" value={period} onChange={(e) => (setPeriod(e.target.value as Period), setPage(1))}>
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="ประเภทเอกสาร" className="h-10" value={type} onChange={(e) => (setType(e.target.value), setPage(1))}>
              <option value="">ทุกประเภท</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>
                  {typeLabel(t)}
                </option>
              ))}
            </NativeSelect>
            {period === "custom" && (
              <>
                <Input
                  type="date"
                  aria-label="ตั้งแต่วันที่"
                  className="h-10"
                  value={custom.from}
                  onChange={(e) => (setCustom({ ...custom, from: e.target.value }), setPage(1))}
                />
                <Input
                  type="date"
                  aria-label="ถึงวันที่"
                  className="h-10"
                  value={custom.to}
                  onChange={(e) => (setCustom({ ...custom, to: e.target.value }), setPage(1))}
                />
              </>
            )}
          </div>
          {sources.includes("pos_sales") && (category === "" || category === "sales") && (
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input type="checkbox" className="size-5" checked={includePos} onChange={(e) => (setIncludePos(e.target.checked), setPage(1))} />
              รวมบิลขายหน้าร้าน
            </label>
          )}
          {status && (
            <button type="button" onClick={() => setStatus("")} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-muted px-3 text-xs">
              สถานะ: {status === "issued" ? "ออกแล้ว / ค้างชำระ" : status} <X className="size-3.5" />
            </button>
          )}
        </div>

        {list.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorNote onRetry={() => list.refetch()} error={list.error} />
        ) : !list.data?.data.length ? (
          <div className="px-4 py-14 text-center text-sm text-muted-foreground">
            <FileStack className="mx-auto mb-2 size-8 opacity-50" />
            {search ? `ไม่พบเอกสารที่ตรงกับ “${search}”` : "ยังไม่มีเอกสารในช่วงนี้"}
            {period !== "all" && (
              <button type="button" className="ml-1 text-primary underline-offset-2 hover:underline" onClick={() => setPeriod("all")}>
                ดูทุกช่วงเวลา
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-cards w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">เอกสาร</th>
                  <th className="px-4 py-3 font-medium">คู่ค้า / รายละเอียด</th>
                  <th className="px-4 py-3 font-medium">วันที่</th>
                  <th className="px-4 py-3 text-right font-medium">ยอด</th>
                  <th className="px-4 py-3 font-medium">สถานะ</th>
                  <th className="w-8 px-2 py-3" />
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((d) => {
                  const st = statusOf(d);
                  const Icon = CATEGORY[d.category].icon;
                  const href = hrefOf(d);
                  return (
                    <tr
                      key={`${d.source}-${d.id}-${d.docNo}`}
                      onClick={() => open(d)}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", CATEGORY_TONE[d.category])} aria-hidden>
                            <Icon className="size-4" />
                          </span>
                          <span className="min-w-0">
                            {href ? (
                              <Link href={href} onClick={(e) => e.stopPropagation()} className="block font-medium hover:text-primary">
                                {d.docNo.startsWith("DRAFT-") ? "ฉบับร่าง" : d.docNo}
                              </Link>
                            ) : (
                              <span className="block font-medium">{d.docNo}</span>
                            )}
                            <span className="block text-xs text-muted-foreground">{typeLabel(d.type)}</span>
                          </span>
                        </div>
                      </td>
                      <td data-label="คู่ค้า" className="max-w-64 truncate px-4 py-3">
                        {d.party ?? "–"}
                      </td>
                      <td data-label="วันที่" className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        {formatThaiDate(d.docDate)}
                      </td>
                      <td data-label="ยอด" className="px-4 py-3 text-right font-medium tabular-nums">
                        {d.amount == null ? "–" : formatMoney(d.amount)}
                      </td>
                      <td data-label="สถานะ" className="px-4 py-3">
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </td>
                      <td aria-hidden className="cards-hide px-2 py-3 text-muted-foreground">
                        <ChevronRight className="size-4" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {meta && <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} onChange={setPage} />}
      </Card>

      {related.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">รายงานที่เกี่ยวข้อง:</span>
          {related.map((r) => (
            <Link key={r.href} href={r.href} className="inline-flex min-h-9 items-center rounded-full border border-border px-3 hover:bg-muted">
              {r.label}
            </Link>
          ))}
        </div>
      )}

      <Dialog open={sale !== null} onOpenChange={(o) => !o && setSale(null)}>
        {sale !== null && <SaleDetailDialog id={sale} path={perms.includes("accounting:read") ? undefined : `/pos/orders/${sale}`} />}
      </Dialog>
    </>
  );
}

function CategoryCard({
  active,
  onClick,
  icon: Icon,
  label,
  hint,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
  count: number | undefined;
  tone: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      title={hint}
      className={cn(
        "flex min-h-16 items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/60",
        active ? "border-primary ring-2 ring-primary/30" : "border-border",
      )}
    >
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg", tone)} aria-hidden>
        <Icon className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{count === undefined ? "…" : `${count.toLocaleString("th-TH")} ฉบับ`}</span>
      </span>
    </button>
  );
}
