"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronDown, Cpu, Download, ExternalLink, Filter, History, Loader2, Search, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { api, apiFetch, apiUrl } from "@/lib/api";
import type { AuditFacets, AuditLogEntry } from "@/lib/types";
import { cn, formatDateTime, formatRelativeTime, formatThaiDate, initials } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Label, NativeSelect, Skeleton } from "@/components/ui/primitives";
import { PageHeader } from "@/components/layout/page";
import { ErrorNote } from "@/components/dashboard/widgets";
import { METADATA_LABELS, actionLabel, actionTone, entityHref, entityLabel, moduleLabel } from "./audit-labels";

const PAGE_SIZE = 50;
const MASKED = "••••••";

interface Filters {
  userId: string;
  module: string;
  from: string;
  to: string;
  q: string;
  entityType: string;
  entityId: string;
}
const FILTER_KEYS: (keyof Filters)[] = ["userId", "module", "from", "to", "q", "entityType", "entityId"];
const EMPTY: Filters = { userId: "", module: "", from: "", to: "", q: "", entityType: "", entityId: "" };

type Page = { data: AuditLogEntry[]; meta: { nextCursor: number | null } };

/** YYYY-MM-DD of an ISO time in the browser's timezone (for day headers). */
function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dayTitle(key: string) {
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  if (key === today) return "วันนี้";
  if (key === yesterday) return "เมื่อวาน";
  return formatThaiDate(key);
}
const exactTime = (iso: string) => new Date(iso).toLocaleString("th-TH", { dateStyle: "full", timeStyle: "medium" });

export function AuditLogViewer() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [filters, setFilters] = useState<Filters>(() => {
    const f = { ...EMPTY };
    for (const k of FILTER_KEYS) f[k] = params.get(k) ?? "";
    return f;
  });
  const [qInput, setQInput] = useState(filters.q);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [exporting, setExporting] = useState(false);

  // Debounce the free-text search
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === qInput.trim() ? f : { ...f, q: qInput.trim() })), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  // Keep the URL shareable (e.g. a link to one product's history)
  useEffect(() => {
    const qs = new URLSearchParams();
    for (const k of FILTER_KEYS) if (filters[k]) qs.set(k, filters[k]);
    const next = qs.toString();
    if (next !== params.toString()) router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [filters, params, pathname, router]);

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const active = FILTER_KEYS.some((k) => filters[k]);
  const rangeInvalid = !!filters.from && !!filters.to && filters.from > filters.to;
  const query = useMemo(() => {
    const out: Record<string, string> = {};
    for (const k of FILTER_KEYS) if (filters[k]) out[k] = filters[k];
    return out;
  }, [filters]);

  const facets = useQuery({ queryKey: ["audit", "facets"], queryFn: () => api.get<AuditFacets>("/audit/facets"), staleTime: 60_000 });
  const logs = useInfiniteQuery({
    queryKey: ["audit", "list", query],
    queryFn: ({ pageParam }) => apiFetch<Page>("/audit", { query: { ...query, limit: PAGE_SIZE, cursor: pageParam } }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.meta.nextCursor,
    enabled: !rangeInvalid,
  });
  const rows = useMemo(() => logs.data?.pages.flatMap((p) => p.data) ?? [], [logs.data]);
  const groups = useMemo(() => {
    const out: { key: string; items: AuditLogEntry[] }[] = [];
    for (const r of rows) {
      const key = dayKey(r.createdAt);
      if (out.at(-1)?.key !== key) out.push({ key, items: [] });
      out.at(-1)!.items.push(r);
    }
    return out;
  }, [rows]);

  const toggle = (id: number) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function exportCsv() {
    setExporting(true);
    try {
      // Refreshes an expired session first (a plain link would just get 401)
      await api.get("/auth/me");
      const res = await fetch(apiUrl("/audit/export.csv", query), { credentials: "include" });
      if (!res.ok) throw new Error(`ส่งออกไม่สำเร็จ (${res.status})`);
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "audit-log.csv";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      const capped = res.headers.get("x-export-truncated");
      if (capped) toast.warning(`ส่งออกเฉพาะ ${Number(capped).toLocaleString("th-TH")} รายการล่าสุด — กรองช่วงวันที่ให้แคบลงเพื่อดูส่วนที่เหลือ`);
      else toast.success(`ส่งออก ${Number(res.headers.get("x-export-rows") ?? 0).toLocaleString("th-TH")} รายการแล้ว`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ส่งออกไม่สำเร็จ");
    } finally {
      setExporting(false);
    }
  }

  const userOptions = facets.data?.users ?? [];
  const moduleOptions = facets.data?.modules ?? [];

  return (
    <>
      <PageHeader
        title="บันทึกการใช้งาน"
        description="ใครทำอะไร เมื่อไร — ประวัติการเปลี่ยนแปลงข้อมูลสำคัญในระบบ (ข้อมูลลับ เช่น token หรือรหัสผ่าน จะถูกซ่อนเสมอ)"
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={exporting || rangeInvalid}>
            {exporting ? <Loader2 className="animate-spin" /> : <Download />} ส่งออก CSV
          </Button>
        }
      />

      <Card>
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))_auto_auto]">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="ค้นหารหัสการกระทำ เลขที่รายการ หรือรายละเอียด"
              className="h-9 pl-9"
              aria-label="ค้นหาบันทึก"
            />
          </div>
          <NativeSelect value={filters.userId} onChange={(e) => set({ userId: e.target.value })} aria-label="ผู้ใช้" className="w-full">
            <option value="">ผู้ใช้ทั้งหมด</option>
            {userOptions.map((u) => (
              <option key={u.id ?? "system"} value={u.id ?? "system"}>
                {u.name} ({u.count.toLocaleString("th-TH")})
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={filters.module} onChange={(e) => set({ module: e.target.value })} aria-label="โมดูล" className="w-full">
            <option value="">ทุกโมดูล</option>
            {moduleOptions.map((m) => (
              <option key={m.module} value={m.module}>
                {moduleLabel(m.module)} ({m.count.toLocaleString("th-TH")})
              </option>
            ))}
          </NativeSelect>
          <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-1">
            <Label htmlFor="audit-from" className="sr-only">
              ตั้งแต่วันที่
            </Label>
            <Input
              id="audit-from"
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(e) => set({ from: e.target.value })}
              className="h-9 min-w-0 flex-1 lg:w-36"
              aria-invalid={rangeInvalid || undefined}
            />
            <span className="text-xs text-muted-foreground">ถึง</span>
            <Label htmlFor="audit-to" className="sr-only">
              ถึงวันที่
            </Label>
            <Input
              id="audit-to"
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(e) => set({ to: e.target.value })}
              className="h-9 min-w-0 flex-1 lg:w-36"
              aria-invalid={rangeInvalid || undefined}
            />
          </div>
          <Button
            variant="ghost"
            className="h-9"
            disabled={!active}
            onClick={() => {
              setQInput("");
              setFilters(EMPTY);
            }}
          >
            <X /> ล้างตัวกรอง
          </Button>
        </div>

        {(filters.entityType || rangeInvalid) && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 text-sm">
            {filters.entityType && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft py-1 pl-3 pr-1 text-xs font-medium text-primary">
                <Filter className="size-3.5" />
                เฉพาะ {entityLabel(filters.entityType)}
                {filters.entityId && ` #${filters.entityId}`}
                <button
                  className="grid size-5 place-items-center rounded-full hover:bg-primary/15"
                  onClick={() => set({ entityType: "", entityId: "" })}
                  aria-label="เลิกกรองรายการนี้"
                >
                  <X className="size-3" />
                </button>
              </span>
            )}
            {rangeInvalid && <span className="text-xs text-danger">วันที่เริ่มต้องไม่หลังวันที่สิ้นสุด</span>}
          </div>
        )}

        {logs.isPending && !rangeInvalid ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-9 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : logs.isError ? (
          <ErrorNote onRetry={() => void logs.refetch()} />
        ) : rows.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <History className="size-6" />
            </div>
            <p className="mt-4 font-medium">{active ? "ไม่พบบันทึกตามตัวกรอง" : "ยังไม่มีบันทึกการใช้งาน"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {active ? "ลองเปลี่ยนผู้ใช้ โมดูล หรือช่วงวันที่" : "การเข้าสู่ระบบ การขาย และการแก้ไขข้อมูลสำคัญจะแสดงที่นี่"}
            </p>
          </div>
        ) : (
          <div>
            {groups.map((g) => (
              <Fragment key={g.key}>
                <div className="border-b border-border bg-muted/60 px-4 py-1.5 text-xs font-medium text-muted-foreground">{dayTitle(g.key)}</div>
                <ul>
                  {g.items.map((r) => (
                    <AuditRow
                      key={r.id}
                      entry={r}
                      open={expanded.has(r.id)}
                      onToggle={() => toggle(r.id)}
                      onEntityFilter={() => set({ entityType: r.entityType ?? "", entityId: r.entityId ?? "" })}
                      entityFiltered={filters.entityType === r.entityType && filters.entityId === (r.entityId ?? "")}
                    />
                  ))}
                </ul>
              </Fragment>
            ))}
            <div className="flex flex-col items-center gap-1 border-t border-border p-4">
              {logs.hasNextPage ? (
                <Button variant="outline" onClick={() => void logs.fetchNextPage()} disabled={logs.isFetchingNextPage}>
                  {logs.isFetchingNextPage && <Loader2 className="animate-spin" />} โหลดเพิ่ม
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">แสดงครบ {rows.length.toLocaleString("th-TH")} รายการแล้ว</p>
              )}
              {logs.isFetchNextPageError && <p className="text-xs text-danger">โหลดเพิ่มไม่สำเร็จ กรุณาลองใหม่</p>}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

function AuditRow({
  entry: r,
  open,
  onToggle,
  onEntityFilter,
  entityFiltered,
}: {
  entry: AuditLogEntry;
  open: boolean;
  onToggle: () => void;
  onEntityFilter: () => void;
  entityFiltered: boolean;
}) {
  const href = entityHref(r.entityType, r.entityId);
  const label = actionLabel(r.action);
  const hasMeta = r.metadata != null && !(typeof r.metadata === "object" && Object.keys(r.metadata as object).length === 0);
  const panelId = `audit-${r.id}`;

  return (
    <li className="border-b border-border last:border-0">
      <div className="flex items-start gap-3 px-4 py-3 hover:bg-muted/40">
        {r.user ? (
          <span
            className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary"
            title={r.user.email ?? r.user.name}
          >
            {initials(r.user.name) || "?"}
          </span>
        ) : (
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" title="ระบบ / webhook">
            <Cpu className="size-4" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium">{r.user?.name ?? "ระบบ"}</span>
            <Badge tone={actionTone(r.action)}>{label}</Badge>
            {label !== r.action && <code className="hidden text-[11px] text-muted-foreground sm:inline">{r.action}</code>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <time dateTime={r.createdAt} title={exactTime(r.createdAt)} className="cursor-default">
              {formatRelativeTime(r.createdAt)} · {formatDateTime(r.createdAt)}
            </time>
            {r.entityType && (
              <span className="inline-flex min-w-0 items-center gap-1">
                {href ? (
                  <Link href={href} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                    {entityLabel(r.entityType)}
                    {r.entityId && ` #${r.entityId}`}
                    <ExternalLink className="size-3" />
                  </Link>
                ) : (
                  <span className="truncate">
                    {entityLabel(r.entityType)}
                    {r.entityId && ` #${r.entityId}`}
                  </span>
                )}
                {r.entityId && !entityFiltered && (
                  <button onClick={onEntityFilter} className="-my-2 rounded p-2 hover:bg-accent hover:text-foreground" title="ดูประวัติทั้งหมดของรายการนี้">
                    <History className="size-3.5" />
                    <span className="sr-only">ดูประวัติทั้งหมดของรายการนี้</span>
                  </button>
                )}
              </span>
            )}
            {r.ip && <span className="hidden font-mono sm:inline">IP {r.ip}</span>}
          </div>
        </div>

        <button
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={open ? "ซ่อนรายละเอียด" : "ดูรายละเอียด"}
        >
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open && (
        <div id={panelId} className="space-y-3 bg-muted/30 px-4 pb-4 pt-1 sm:pl-16">
          <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[10rem_minmax(0,1fr)]">
            <Detail label="เวลา" value={exactTime(r.createdAt)} />
            <Detail label="รหัสการกระทำ" value={<code>{r.action}</code>} />
            {r.user?.email && <Detail label="อีเมล" value={r.user.email} />}
            {r.ip && <Detail label="IP" value={<span className="font-mono">{r.ip}</span>} />}
            {r.entityType && <Detail label="ข้อมูล" value={<code>{`${r.entityType}${r.entityId ? ` #${r.entityId}` : ""}`}</code>} />}
          </dl>
          {hasMeta ? <MetadataView value={r.metadata} /> : <p className="text-xs text-muted-foreground">ไม่มีรายละเอียดเพิ่มเติม</p>}
        </div>
      )}
    </li>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </>
  );
}

function MetadataValue({ value }: { value: unknown }) {
  if (value === MASKED)
    return (
      <Badge tone="neutral" className="gap-1">
        <ShieldCheck className="size-3" /> ซ่อนไว้
      </Badge>
    );
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  if (typeof value === "boolean") return <span>{value ? "ใช่" : "ไม่ใช่"}</span>;
  if (typeof value === "number") return <span className="tabular-nums">{value.toLocaleString("th-TH")}</span>;
  if (typeof value === "string") return <span className="break-words">{value}</span>;
  if (Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number")) {
    if (!value.length) return <span className="text-muted-foreground">—</span>;
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((v, i) => (
          <code key={i} className="rounded bg-card px-1.5 py-0.5 ring-1 ring-border">
            {String(v)}
          </code>
        ))}
      </span>
    );
  }
  return <pre className="max-h-48 overflow-auto rounded-md bg-card p-2 text-[11px] ring-1 ring-border">{JSON.stringify(value, null, 2)}</pre>;
}

function MetadataView({ value }: { value: unknown }) {
  const [raw, setRaw] = useState(false);
  const entries = value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value as Record<string, unknown>) : null;
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <p className="text-xs font-medium">รายละเอียด</p>
        {entries && (
          <button onClick={() => setRaw((v) => !v)} className="text-xs font-medium text-primary hover:underline">
            {raw ? "แสดงเป็นตาราง" : "ดู JSON"}
          </button>
        )}
      </div>
      {entries && !raw ? (
        <dl className="grid gap-x-4 gap-y-2 p-3 text-xs sm:grid-cols-[10rem_minmax(0,1fr)]">
          {entries.map(([k, v]) => (
            <Fragment key={k}>
              <dt className="text-muted-foreground">
                {METADATA_LABELS[k] ?? k}
                {METADATA_LABELS[k] && <span className="ml-1 font-mono text-[10px] opacity-70">{k}</span>}
              </dt>
              <dd className="min-w-0">
                <MetadataValue value={v} />
              </dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        <pre className="max-h-72 overflow-auto p-3 text-[11px] leading-relaxed">{JSON.stringify(value, null, 2)}</pre>
      )}
    </div>
  );
}
