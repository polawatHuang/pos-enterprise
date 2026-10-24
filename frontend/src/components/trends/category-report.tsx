"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight, CloudDownload, Info, LayoutGrid, Loader2, Search, Settings2, Sparkles, Store, TrendingUp, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import type { CategoryReport } from "@/lib/types";
import { cn, formatNumber } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, NativeSelect, Skeleton, TabBar } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/overlays";
import { PageHeader } from "@/components/layout/page";
import { AiSearchDialog, useAiSearchLauncher } from "./ai-search";
import { KalodataSettingsDialog } from "./kalodata-settings";
import { baht, CategoryTable, type CategorySort, Growth, periodLabel, SIGNAL } from "./kalo-ui";

type Level = "1" | "2" | "3";

/**
 * สินค้าเทรนด์ — the market first, like Kalodata's category report: how big each category is this month,
 * whether it grows, how concentrated it is, then drill into a category and its products.
 * Follows the guide's flow: ตลาด → หมวด → สินค้า → ช่องทาง → ครีเอเตอร์ → คอนเทนต์.
 */
export function CategoryReportView() {
  const { can } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [period, setPeriod] = useState(params.get("period") ?? "");
  const [level, setLevel] = useState<Level>((params.get("level") as Level | null) ?? "1");
  const [parentId, setParentId] = useState<string | null>(params.get("parent"));
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<CategorySort>("revenue");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [growingOnly, setGrowingOnly] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const aiSearch = useAiSearchLauncher();

  const query = {
    period: period || undefined,
    level: parentId ? undefined : level,
    parentId: parentId ?? undefined,
    q: q || undefined,
    sort,
    dir,
    growingOnly: growingOnly ? "1" : undefined,
  };
  const report = useQuery({
    queryKey: ["trends", "categories", query],
    queryFn: () => api.get<CategoryReport>("/scraping/categories", query),
    placeholderData: keepPreviousData,
    refetchInterval: (qq) => (qq.state.data?.kalodata.running ? 15_000 : false),
  });
  const d = report.data;
  const shownPeriod = d?.period ?? null;

  const onSort = (k: CategorySort) => {
    if (k === sort) setDir(dir === "desc" ? "asc" : "desc");
    else {
      setSort(k);
      setDir(k === "top3" ? "asc" : "desc");
    }
  };

  return (
    <div>
      <PageHeader
        title="สินค้าเทรนด์"
        description="เริ่มจากตลาด: หมวดไหนใหญ่ โตเร็ว และยังไม่กระจุกกับไม่กี่ร้าน → เจาะหมวด → เลือกสินค้าที่อยู่ Phase 2–4 คะแนนคัดเลือกสูง แล้วถอดสูตรคลิปที่ขายได้"
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/trends/products">
                <LayoutGrid /> สินค้าทั้งหมด
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/trends/channel">
                <UserRound /> โปรไฟล์ช่อง
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/trends/sources">
                <Settings2 /> แหล่งข้อมูล
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setSettingsOpen(true)}>
              <CloudDownload /> ดึงข้อมูลอัตโนมัติ
              {d && (
                <Badge tone={d.kalodata.enabled ? "success" : "neutral"} className="ml-0.5">
                  {d.kalodata.enabled ? "เปิด" : "ปิด"}
                </Badge>
              )}
            </Button>
            {can("scraping:run") && (
              <Button onClick={() => void aiSearch.start()} disabled={aiSearch.starting}>
                {aiSearch.starting ? <Loader2 className="animate-spin" /> : <Sparkles />} AI ค้นหาสินค้าขายดี
              </Button>
            )}
          </>
        }
      />

      {report.isPending ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-96" />
        </div>
      ) : !d?.period ? (
        <EmptyState d={d} onSettings={() => setSettingsOpen(true)} />
      ) : (
        <>
          {d.kalodata.running && (
            <p className="mb-3 flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
              <Loader2 className="size-4 animate-spin" /> กำลังดึงข้อมูลเดือนใหม่จาก Kalodata — ตารางจะอัปเดตเองเมื่อเสร็จ
            </p>
          )}
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              label={`ยอดขาย TikTok Shop ไทย 30 วัน · รอบ${periodLabel(d.period)}`}
              value={baht(d.summary?.revenue)}
              foot={
                <>
                  <Growth value={d.summary?.growth} /> จากเดือนก่อน · {d.summary?.categories} หมวดหลัก
                </>
              }
            />
            <SummaryCard
              label="หมวดหลักที่โตเร็วที่สุด"
              value={d.summary?.fastest?.name ?? "—"}
              href={d.summary?.fastest ? `/trends/categories/${d.summary.fastest.id}?period=${d.period}` : undefined}
              foot={d.summary?.fastest ? <Growth value={d.summary.fastest.growth} /> : "—"}
            />
            <SummaryCard
              label="หมวดน่าเข้าที่สุด (โต + ไม่กระจุก)"
              value={d.summary?.opportunity?.name ?? "ยังไม่มีหมวดที่ผ่านเกณฑ์"}
              href={d.summary?.opportunity ? `/trends/categories/${d.summary.opportunity.id}?period=${d.period}` : undefined}
              foot={
                d.summary?.opportunity ? (
                  <>
                    <Growth value={d.summary.opportunity.growth} /> · 3 ร้านแรกครอง {Math.round(d.summary.opportunity.top3 ?? 0)}%
                  </>
                ) : (
                  "เกณฑ์: โต ≥10% · 3 ร้านแรก <50% · ร้านขายได้ดี"
                )
              }
            />
            <SummaryCard
              label="สินค้าที่กำลังติดตาม"
              value={formatNumber(d.summary?.tracked ?? 0)}
              href="/trends/products?status=watching"
              foot={`จากสินค้า Kalodata ในระบบ ${formatNumber(d.summary?.products ?? 0)} ตัว`}
            />
          </div>

          <Card>
            <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                {parentId ? (
                  <nav aria-label="ตำแหน่งหมวด" className="flex flex-wrap items-center gap-1 text-sm">
                    <button type="button" className="min-h-9 font-medium text-primary hover:underline" onClick={() => setParentId(null)}>
                      ทุกหมวดหลัก
                    </button>
                    {d.breadcrumb.map((b) => (
                      <span key={b.id} className="inline-flex items-center gap-1">
                        <ChevronRight className="size-3.5 text-muted-foreground" />
                        <button type="button" className="min-h-9 font-medium hover:underline" onClick={() => setParentId(b.id)}>
                          {b.name}
                        </button>
                      </span>
                    ))}
                  </nav>
                ) : (
                  <TabBar
                    value={level}
                    onChange={setLevel}
                    tabs={[
                      { value: "1", label: "หมวดหลัก" },
                      { value: "2", label: "หมวดรอง" },
                      { value: "3", label: "หมวดย่อย" },
                    ]}
                  />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <NativeSelect aria-label="เดือน" className="h-10" value={shownPeriod ?? ""} onChange={(e) => setPeriod(e.target.value)}>
                  {d.periods.map((p) => (
                    <option key={p} value={p}>
                      {periodLabel(p)}
                    </option>
                  ))}
                </NativeSelect>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาหมวด" className="h-10 w-44 pl-9" aria-label="ค้นหาหมวด" />
                </div>
                <NativeSelect
                  aria-label="เรียงตาม"
                  className="h-10 sm:hidden"
                  value={`${sort}:${dir}`}
                  onChange={(e) => {
                    const [k, d2] = e.target.value.split(":");
                    setSort(k as CategorySort);
                    setDir(d2 as "asc" | "desc");
                  }}
                >
                  <option value="revenue:desc">เรียง: ยอดขายสูงสุด</option>
                  <option value="growth:desc">เรียง: โตเร็วสุด</option>
                  <option value="top3:asc">เรียง: กระจุกน้อยสุด</option>
                  <option value="avgShop:desc">เรียง: ยอดขายเฉลี่ย/ร้านสูงสุด</option>
                  <option value="sale:desc">เรียง: ขายได้ (ชิ้น) มากสุด</option>
                </NativeSelect>
                <label className="flex h-10 items-center gap-2 whitespace-nowrap rounded-lg border border-input bg-card px-3 text-sm">
                  <input type="checkbox" checked={growingOnly} onChange={(e) => setGrowingOnly(e.target.checked)} className="size-4 accent-[var(--primary)]" />
                  เฉพาะหมวดที่โต
                </label>
              </div>
            </div>
            {d.items.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">ไม่พบหมวดที่ตรงเงื่อนไข</p>
            ) : (
              <CategoryTable
                items={d.items}
                sort={sort}
                dir={dir}
                onSort={onSort}
                period={d.period}
                onDrill={(c) => {
                  setParentId(c.id);
                  setQ("");
                }}
              />
            )}
            <Legend />
          </Card>
        </>
      )}

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        {settingsOpen && <KalodataSettingsDialog />}
      </Dialog>
      <Dialog open={aiSearch.state !== null} onOpenChange={(o) => !o && aiSearch.close()}>
        {aiSearch.state && (
          <AiSearchDialog
            key={`${aiSearch.state.sourceId}-${aiSearch.state.runId}`}
            sourceId={aiSearch.state.sourceId}
            runId={aiSearch.state.runId}
            onRestart={(body) => aiSearch.start(body)}
            onShowResults={() => {
              const sid = aiSearch.state!.sourceId;
              aiSearch.close();
              router.push(`/trends/products?source=${sid}&status=all`);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function SummaryCard({ label, value, foot, href }: { label: string; value: string; foot: React.ReactNode; href?: string }) {
  const body = (
    <Card className={cn("h-full p-4", href && "transition-shadow hover:shadow-md")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">{foot}</p>
    </Card>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

/** How to read the table (guide §2.2). */
function Legend() {
  return (
    <details className="border-t border-border px-4 py-3 text-sm">
      <summary className="flex min-h-9 cursor-pointer items-center gap-1.5 font-medium text-muted-foreground">
        <Info className="size-4" /> อ่านตารางนี้อย่างไร
      </summary>
      <div className="mt-2 grid gap-2 text-muted-foreground sm:grid-cols-2">
        {Object.values(SIGNAL).map((s) => (
          <p key={s.label} className="flex items-start gap-2">
            <Badge tone={s.tone} className="shrink-0">
              {s.label}
            </Badge>
            {s.hint}
          </p>
        ))}
        <p className="sm:col-span-2">
          <b className="text-foreground">ช่วงเวลา</b> = ตัวเลขหมวดหมู่เป็นยอด 30 วันล่าสุด ณ วันที่ดึงของแต่ละรอบ (Kalodata ไม่ให้เลือกหมวดหมู่เป็นเดือนปฏิทิน)
          ส่วนสินค้าเป็นยอดตามเดือนปฏิทิน · กราฟ 6 เดือนจะครบเมื่อดึงต่อเนื่องหลายรอบ · <b className="text-foreground">3 ร้านแรกครอง</b> = ส่วนแบ่งยอดขายของ 3
          ร้านอันดับแรก ยิ่งสูงยิ่งเข้ายาก · <b className="text-foreground">ยอดขายเฉลี่ย/ร้าน</b> สูง = ร้านในหมวดนี้ขายได้จริง ·
          ตลาดโตสูงไม่ได้แปลว่าครีเอเตอร์ใหม่จะขายง่าย และตลาดที่หดตัวก็ยังอาจมีสินค้าบางตัวที่มาแรง — เจาะดูหมวดย่อยและสินค้าก่อนตัดสินใจ
        </p>
      </div>
    </details>
  );
}

function EmptyState({ d, onSettings }: { d: CategoryReport | undefined; onSettings: () => void }) {
  return (
    <Card className="grid place-items-center gap-3 px-6 py-14 text-center">
      <TrendingUp className="size-10 text-primary" />
      <div className="max-w-lg space-y-1">
        <p className="text-lg font-semibold">ยังไม่มีข้อมูลตลาด TikTok Shop</p>
        <p className="text-sm text-muted-foreground">
          {d?.kalodata.configured
            ? "เปิดดึงข้อมูลอัตโนมัติ หรือกดดึงเดือนล่าสุดตอนนี้ ระบบจะดึงอันดับหมวดหมู่ สินค้าขายดี สินค้ามาแรง สินค้าใหม่ และสินค้าค่าคอมสูงให้เดือนละครั้ง"
            : "ใส่คีย์ API ของ Kalodata ในหน้าการเชื่อมต่อ API แล้วเปิดดึงข้อมูลอัตโนมัติ ระบบจะดึงรายงานหมวดหมู่และสินค้าขายดีให้เดือนละครั้ง"}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={onSettings}>
          <CloudDownload /> ตั้งค่าดึงข้อมูล
        </Button>
        <Button variant="outline" asChild>
          <Link href="/trends/products">
            <Store /> ดูสินค้าเทรนด์จากแหล่งอื่น
          </Link>
        </Button>
      </div>
    </Card>
  );
}
