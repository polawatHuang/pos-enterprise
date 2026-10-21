"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, Loader2, MessageCircle, Plus, Repeat2, Search, UserPlus, Users, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { apiBlob, apiFetch, api } from "@/lib/api";
import type { CustomerList, CustomerListItem, CustomerSort, CustomerSummary, Platform } from "@/lib/types";
import { cn, formatMoney, formatNumber, initials } from "@/lib/utils";
import { CUSTOMERS_WRITE } from "@/config/nav";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, NativeSelect, Pagination, Skeleton } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/overlays";
import { PageHeader } from "@/components/layout/page";
import { ErrorNote, KpiCard, channelLabel } from "@/components/dashboard/widgets";
import { PLATFORM } from "@/components/inbox/labels";
import { CustomerFormDialog } from "./customer-form";
import { SORT_OPTIONS, customerSegment, daysAgoLabel, formatPhone } from "./labels";

const PAGE_SIZE = 25;
const SORTS = new Set<string>(SORT_OPTIONS.map((o) => o.value));

export function CustomersView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { can } = useAuth();
  const canWrite = CUSTOMERS_WRITE.some((p) => can(p));

  // Filters live in the URL so "back" from a customer returns to the same list
  const q = params.get("q") ?? "";
  const tag = params.get("tag") ?? "";
  const sort = (SORTS.has(params.get("sort") ?? "") ? params.get("sort") : "recent") as CustomerSort;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const setParams = (next: Record<string, string | number | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "" || (k === "page" && v === 1) || (k === "sort" && v === "recent")) sp.delete(k);
      else sp.set(k, String(v));
    }
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const [draft, setDraft] = useState(q);
  useEffect(() => {
    if (draft.trim() === q) return;
    const t = setTimeout(() => setParams({ q: draft.trim(), page: null }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the typed text drives the debounce
  }, [draft]);

  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);

  const summary = useQuery({ queryKey: ["customers", "summary"], queryFn: () => api.get<CustomerSummary>("/customers/summary"), staleTime: 60_000 });
  const query = { q, tag, sort, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
  const list = useQuery({
    queryKey: ["customers", "list", query],
    queryFn: () => apiFetch<CustomerList>("/customers", { query }),
    placeholderData: keepPreviousData,
  });

  const exportCsv = async () => {
    setExporting(true);
    try {
      const qs = new URLSearchParams(Object.entries({ q, tag, sort }).filter(([, v]) => v)).toString();
      const blob = await apiBlob(`/customers/export.csv${qs ? `?${qs}` : ""}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ส่งออกไม่สำเร็จ");
    } finally {
      setExporting(false);
    }
  };

  const s = summary.data;
  const rows = list.data?.data ?? [];
  const total = list.data?.meta.total ?? 0;
  const filtered = Boolean(q || tag);
  const open = (c: CustomerListItem) => router.push(`/customers/${c.id}`);

  return (
    <>
      <PageHeader
        title="ลูกค้า"
        description="ประวัติการซื้อ ยอดสะสม และแชตของลูกค้าทุกช่องทางในที่เดียว"
        actions={
          <>
            <Button variant="outline" onClick={exportCsv} disabled={exporting || total === 0}>
              {exporting ? <Loader2 className="animate-spin" /> : <Download />} ส่งออก CSV
            </Button>
            {canWrite && (
              <Button onClick={() => setCreating(true)}>
                <Plus /> เพิ่มลูกค้า
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="ลูกค้าทั้งหมด"
          icon={Users}
          loading={summary.isPending}
          value={formatNumber(s?.totalCustomers ?? 0)}
          footer={s && <span className="text-xs text-muted-foreground">ยินยอมรับข่าวสาร {formatNumber(s.consentCount)} คน</span>}
        />
        <KpiCard
          label="ลูกค้าใหม่เดือนนี้"
          icon={UserPlus}
          tone="success"
          loading={summary.isPending}
          value={formatNumber(s?.newThisMonth ?? 0)}
          footer={
            s && (
              <span className="text-xs text-muted-foreground">
                {s.totalCustomers ? `${((s.newThisMonth / s.totalCustomers) * 100).toFixed(1)}% ของลูกค้าทั้งหมด` : "ยังไม่มีลูกค้า"}
              </span>
            )
          }
        />
        <KpiCard
          label="ลูกค้าซื้อซ้ำ"
          icon={Repeat2}
          tone="warning"
          loading={summary.isPending}
          value={`${(s?.repeatRate ?? 0).toFixed(1)}%`}
          footer={
            s && (
              <div className="space-y-1.5">
                <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className="h-full rounded-full bg-warning" style={{ width: `${Math.min(s.repeatRate, 100)}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatNumber(s.repeatBuyers)} จาก {formatNumber(s.buyers)} คนที่เคยซื้อ ซื้อ 2 ครั้งขึ้นไป
                </p>
              </div>
            )
          }
        />
        <KpiCard
          label="ยอดซื้อเฉลี่ยต่อลูกค้า"
          icon={Wallet}
          tone="info"
          loading={summary.isPending}
          value={formatMoney(s?.avgSpend ?? 0)}
          footer={s && <span className="text-xs text-muted-foreground">เฉลี่ยต่อบิล {formatMoney(s.avgBasket)}</span>}
        />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative w-full sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="ค้นหาชื่อ / เบอร์โทร / อีเมล / รหัสสมาชิก"
                className="h-9 pl-9 pr-8"
                aria-label="ค้นหาลูกค้า"
              />
              {draft && (
                <button
                  type="button"
                  aria-label="ล้างคำค้น"
                  onClick={() => setDraft("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            <NativeSelect aria-label="เรียงตาม" value={sort} onChange={(e) => setParams({ sort: e.target.value, page: null })}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  เรียงตาม: {o.label}
                </option>
              ))}
            </NativeSelect>
            <p className="text-sm text-muted-foreground sm:ml-auto">
              {list.data ? `${formatNumber(total)} คน` : " "}
              {list.isFetching && list.data && <Loader2 className="ml-2 inline size-3.5 animate-spin" />}
            </p>
          </div>
          {s && s.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="กรองตามแท็ก">
              <TagChip active={!tag} onClick={() => setParams({ tag: null, page: null })}>
                ทั้งหมด
              </TagChip>
              {s.tags.slice(0, 15).map((t) => (
                <TagChip key={t.tag} active={tag === t.tag} onClick={() => setParams({ tag: tag === t.tag ? null : t.tag, page: null })}>
                  {t.tag} <span className="tabular-nums opacity-70">{t.count}</span>
                </TagChip>
              ))}
            </div>
          )}
        </div>

        {list.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : list.isError && !list.data ? (
          <ErrorNote onRetry={() => list.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyCustomers
            filtered={filtered}
            canWrite={canWrite}
            onCreate={() => setCreating(true)}
            onClear={() => {
              setDraft("");
              setParams({ q: null, tag: null, page: null });
            }}
          />
        ) : (
          <>
            {/* Desktop: table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="table-cards w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-medium">ลูกค้า</th>
                    <th className="px-4 py-3 font-medium">ติดต่อ</th>
                    <th className="px-4 py-3 text-right font-medium">ยอดซื้อรวม</th>
                    <th className="px-4 py-3 text-right font-medium">บิล</th>
                    <th className="px-4 py-3 font-medium">ซื้อล่าสุด</th>
                    <th className="px-4 py-3 font-medium">ช่องทาง</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const seg = customerSegment(c);
                    return (
                      <tr key={c.id} onClick={() => open(c)} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={c.name} />
                            <div className="min-w-0">
                              <Link href={`/customers/${c.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:text-primary">
                                {c.name}
                              </Link>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                                {c.memberNo && <span className="text-xs text-muted-foreground">{c.memberNo}</span>}
                                {seg && <Badge tone={seg.tone}>{seg.label}</Badge>}
                                {c.tags.slice(0, 3).map((t) => (
                                  <Badge key={t}>{t}</Badge>
                                ))}
                                {c.tags.length > 3 && <span className="text-xs text-muted-foreground">+{c.tags.length - 3}</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td data-label="ติดต่อ" className="px-4 py-3 text-muted-foreground">
                          <p className="tabular-nums">{formatPhone(c.phone) ?? "–"}</p>
                          {c.email && <p className="max-w-[200px] truncate text-xs">{c.email}</p>}
                        </td>
                        <td data-label="ยอดซื้อรวม" className="px-4 py-3 text-right">
                          <p className="font-medium tabular-nums">{formatMoney(c.totalSpent)}</p>
                          {c.points > 0 && <p className="text-xs text-muted-foreground tabular-nums">{formatNumber(c.points)} แต้ม</p>}
                        </td>
                        <td data-label="บิล" className="px-4 py-3 text-right tabular-nums">{formatNumber(c.orderCount)}</td>
                        <td data-label="ซื้อล่าสุด" className="px-4 py-3 text-muted-foreground">{daysAgoLabel(c.lastOrderAt)}</td>
                        <td data-label="ช่องทาง" className="px-4 py-3">
                          <Channels c={c} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile: cards */}
            <ul className="divide-y divide-border md:hidden">
              {rows.map((c) => {
                const seg = customerSegment(c);
                return (
                  <li key={c.id}>
                    <Link href={`/customers/${c.id}`} className="flex gap-3 p-4 active:bg-muted/60">
                      <Avatar name={c.name} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate font-medium">{c.name}</p>
                          <p className="shrink-0 font-semibold tabular-nums">{formatMoney(c.totalSpent)}</p>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {[formatPhone(c.phone), `${formatNumber(c.orderCount)} บิล`, `ล่าสุด ${daysAgoLabel(c.lastOrderAt)}`].filter(Boolean).join(" · ")}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          {seg && <Badge tone={seg.tone}>{seg.label}</Badge>}
                          {c.tags.slice(0, 2).map((t) => (
                            <Badge key={t}>{t}</Badge>
                          ))}
                          <Channels c={c} />
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {list.data && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={(p) => setParams({ page: p })} />}
      </Card>

      <Dialog open={creating} onOpenChange={setCreating}>
        {creating && (
          <CustomerFormDialog
            customer={null}
            tagSuggestions={s?.tags.map((t) => t.tag)}
            onSaved={(c) => {
              setCreating(false);
              router.push(`/customers/${c.id}`);
            }}
          />
        )}
      </Dialog>
    </>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  // Stable hue per name so the same customer always gets the same colour
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden
      className={cn("grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold", className)}
      style={{ background: `hsl(${h} 65% 50% / 0.14)`, color: `hsl(${h} 55% 42%)` }}
    >
      {initials(name) || "?"}
    </span>
  );
}

export function PlatformBadge({ platform, className }: { platform: Platform; className?: string }) {
  const p = PLATFORM[platform] ?? PLATFORM.website;
  return (
    <span className={cn("inline-flex h-4 items-center rounded px-1 text-[9px] font-bold leading-none", p.className, className)} title={p.label}>
      {p.short}
    </span>
  );
}

function TagChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors",
        active ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Channels({ c }: { c: CustomerListItem }) {
  if (!c.salesChannels.length && !c.chatPlatforms.length) return <span className="text-xs text-muted-foreground">–</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {c.salesChannels.map((ch) => (
        <span key={ch} className="rounded border border-border px-1.5 py-px text-[11px] text-muted-foreground">
          {channelLabel(ch)}
        </span>
      ))}
      {c.chatPlatforms.map((p) => (
        <PlatformBadge key={p} platform={p} />
      ))}
      {c.openChats > 0 && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full bg-primary-soft px-1.5 py-px text-[11px] font-medium text-primary"
          title="แชตที่ยังเปิดอยู่"
        >
          <MessageCircle className="size-3" />
          {c.openChats}
        </span>
      )}
    </span>
  );
}

function EmptyCustomers({ filtered, canWrite, onCreate, onClear }: { filtered: boolean; canWrite: boolean; onCreate: () => void; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary">
        <Users className="size-7" />
      </span>
      <p className="mt-4 font-medium">{filtered ? "ไม่พบลูกค้าที่ตรงกับเงื่อนไข" : "ยังไม่มีลูกค้า"}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {filtered ? "ลองค้นด้วยเบอร์โทรบางส่วน หรือเลือกแท็กอื่น" : "ลูกค้าที่สมัครสมาชิกตอนขายหน้าร้าน หรือทักแชตเข้ามา จะแสดงที่นี่อัตโนมัติ"}
      </p>
      <div className="mt-4 flex gap-2">
        {filtered && (
          <Button variant="outline" onClick={onClear}>
            ล้างตัวกรอง
          </Button>
        )}
        {canWrite && (
          <Button onClick={onCreate}>
            <Plus /> เพิ่มลูกค้า
          </Button>
        )}
      </div>
    </div>
  );
}
