"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle,
  Bot,
  Clapperboard,
  Eye,
  EyeOff,
  ExternalLink,
  Link2,
  Loader2,
  PackagePlus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Star,
  TrendingUp,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api, apiFetch, ApiError } from "@/lib/api";
import type { TrendDetail, TrendItem, TrendListMeta, TrendStatus } from "@/lib/types";
import { cn, formatDateTime, formatMoney, formatNumber } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, NativeSelect, Pagination, Skeleton, TabBar } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/overlays";
import { Dialog as DialogPrimitive } from "radix-ui";
import { PageHeader } from "@/components/layout/page";
import { PHASE_FILTERS, platformMeta, scoreTone, SORT_OPTIONS, TREND_STATUS } from "./labels";
import { ChecklistSection, LifecycleSection, PhaseChip } from "./lifecycle";
import { AiSearchDialog, AiSearchSection, useAiSearchLauncher } from "./ai-search";
import { CsvImportDialog } from "./csv-import-dialog";

type StatusTab = "active" | TrendStatus | "all";

export function TrendsView() {
  const { can } = useAuth();
  const [status, setStatus] = useState<StatusTab>("active");
  const [platform, setPlatform] = useState("");
  const [sort, setSort] = useState("pick");
  const [phase, setPhase] = useState("all");
  const [hideTop10, setHideTop10] = useState(false);
  const [q, setQ] = useState("");
  const [minCommission, setMinCommission] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<number | null>(null);
  const aiSearch = useAiSearchLauncher();

  const query = {
    status,
    platform: platform || undefined,
    sort,
    q: q || undefined,
    minCommission: minCommission || undefined,
    phase: phase === "all" ? undefined : phase,
    hideTop10: hideTop10 ? "1" : undefined,
    sourceId: sourceFilter ?? undefined,
    page,
    pageSize: 24,
  };
  const list = useQuery({
    queryKey: ["trends", "list", query],
    queryFn: () => apiFetch<{ data: TrendItem[]; meta: TrendListMeta }>("/scraping/trends", { query }),
    placeholderData: keepPreviousData,
  });
  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        title="สินค้าเทรนด์"
        description="สินค้ากระแสไม่เท่ากับสินค้าขายดี — ระบบประเมิน Phase วงจรชีวิตสินค้าและเช็กลิสต์ 9 ข้อ เพื่อหาสินค้าที่กำลังจะเป็นกระแส (Phase 2–4, อันดับ 11 ขึ้นไป)"
        actions={
          <>
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
            {can("scraping:run") && (
              <>
                <Button variant="outline" onClick={() => setImporting(true)}>
                  <Upload /> นำเข้า CSV
                </Button>
                <Button onClick={() => void aiSearch.start()} disabled={aiSearch.starting}>
                  {aiSearch.starting ? <Loader2 className="animate-spin" /> : <Sparkles />} AI ค้นหาสินค้าขายดี
                </Button>
              </>
            )}
          </>
        }
      />
      <TabBar
        value={status}
        onChange={reset(setStatus)}
        tabs={[
          { value: "active", label: "ใหม่ + ติดตาม" },
          { value: "watching", label: "กำลังติดตาม" },
          { value: "imported", label: "นำเข้าแล้ว" },
          { value: "ignored", label: "ไม่สนใจ" },
          { value: "all", label: "ทั้งหมด" },
        ]}
      />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder="ค้นหาสินค้า/ร้าน" className="pl-9" aria-label="ค้นหา" />
        </div>
        <NativeSelect value={platform} onChange={(e) => reset(setPlatform)(e.target.value)} className="w-auto" aria-label="แพลตฟอร์ม">
          <option value="">ทุกแพลตฟอร์ม</option>
          {list.data?.meta.platforms.map((p) => (
            <option key={p.platform} value={p.platform}>
              {platformMeta(p.platform).label} ({p.count})
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={minCommission} onChange={(e) => reset(setMinCommission)(e.target.value)} className="w-auto" aria-label="ค่าคอมขั้นต่ำ">
          <option value="">ค่าคอมทุกระดับ</option>
          {[5, 10, 15, 20].map((v) => (
            <option key={v} value={v}>
              ค่าคอม ≥ {v}%
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={phase} onChange={(e) => reset(setPhase)(e.target.value)} className="w-auto" aria-label="Phase">
          {PHASE_FILTERS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
        <label className="flex h-10 items-center gap-2 rounded-lg border border-input bg-card px-3 text-sm">
          <input type="checkbox" checked={hideTop10} onChange={(e) => reset(setHideTop10)(e.target.checked)} className="size-4 accent-[var(--primary)]" />
          ซ่อนอันดับ 1–10
        </label>
        <NativeSelect value={sort} onChange={(e) => reset(setSort)(e.target.value)} className="w-auto" aria-label="เรียงตาม">
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              เรียง: {o.label}
            </option>
          ))}
        </NativeSelect>
      </div>

      {sourceFilter !== null && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <Badge tone="primary">
            <Sparkles className="size-3.5" /> แสดงเฉพาะผลจาก AI ค้นหา
          </Badge>
          <button className="text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={() => setSourceFilter(null)}>
            ล้างตัวกรอง
          </button>
        </div>
      )}

      <div className="mt-4">
        {list.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-36" />
            ))}
          </div>
        ) : !list.data?.data.length ? (
          <Card className="grid place-items-center gap-2 py-16 text-center text-sm text-muted-foreground">
            <TrendingUp className="size-8" />
            ยังไม่มีสินค้าในมุมมองนี้ — ตั้งค่าแหล่งข้อมูลหรือนำเข้า CSV
          </Card>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.data.data.map((t) => (
                <TrendCard key={t.id} t={t} onOpen={() => setOpenId(t.id)} />
              ))}
            </div>
            <Card className="mt-3">
              <Pagination page={page} pageSize={24} total={list.data.meta.total} onChange={setPage} />
            </Card>
          </>
        )}
      </div>

      <DialogPrimitive.Root open={openId !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        {openId !== null && <TrendDrawer id={openId} onClose={() => setOpenId(null)} />}
      </DialogPrimitive.Root>
      <Dialog open={aiSearch.state !== null} onOpenChange={(o) => !o && aiSearch.close()}>
        {aiSearch.state && (
          <AiSearchDialog
            key={`${aiSearch.state.sourceId}-${aiSearch.state.runId}`}
            sourceId={aiSearch.state.sourceId}
            runId={aiSearch.state.runId}
            onRestart={(body) => aiSearch.start(body)}
            onShowResults={() => {
              setSourceFilter(aiSearch.state!.sourceId);
              setStatus("all");
              setPage(1);
              aiSearch.close();
            }}
          />
        )}
      </Dialog>
      <Dialog open={importing} onOpenChange={setImporting}>
        {importing && <CsvImportDialog onDone={() => setImporting(false)} />}
      </Dialog>
    </div>
  );
}

function PlatformTag({ platform }: { platform: string }) {
  const p = platformMeta(platform);
  return <span className={cn("inline-flex h-5 items-center rounded px-1.5 text-[10px] font-semibold", p.className)}>{p.label}</span>;
}

function Thumb({ src, className }: { src: string | null; className?: string }) {
  return (
    <div className={cn("grid shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-muted-foreground", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote marketplace images, arbitrary hosts
        <img src={src} alt="" className="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <TrendingUp className="size-5" />
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

const dash = (v: number | null, f: (n: number) => string) => (v == null ? "—" : f(v));

function TrendCard({ t, onOpen }: { t: TrendItem; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="text-left">
      <Card className="h-full p-4 transition-shadow hover:shadow-md">
        <div className="flex gap-3">
          <Thumb src={t.imageUrl} className="size-14" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <PlatformTag platform={t.platform} />
              <PhaseChip phase={t.phase} />
              {t.aiSearch && !t.aiSearch.verified && (
                <Badge tone="warning" title="AI พบจากการค้นเว็บ ยังไม่มีตัวเลขยอดขายที่ยืนยันได้">
                  <Sparkles className="size-3" /> AI พบ
                </Badge>
              )}
              {t.status !== "new" && <Badge tone={TREND_STATUS[t.status].tone}>{TREND_STATUS[t.status].label}</Badge>}
              {t.hasAnalysis && (
                <span className="text-primary" title="AI วิเคราะห์แล้ว">
                  <Sparkles className="size-3.5" />
                </span>
              )}
            </div>
            <p className="mt-1 line-clamp-2 text-sm font-medium leading-snug">{t.title}</p>
            {t.shopName && <p className="truncate text-xs text-muted-foreground">{t.shopName}</p>}
          </div>
          <div className="shrink-0 text-right">
            <Badge tone={scoreTone(t.pickScore)} className="tabular-nums">
              {t.pickScore == null ? "—" : Math.round(t.pickScore)}
            </Badge>
            <p className="mt-1 text-[10px] text-muted-foreground">เหมาะทำ</p>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="tabular-nums">เช็กลิสต์ {t.checklistPassed ?? 0}/9</span>
          {t.categoryRank != null && (
            <>
              <span aria-hidden>·</span>
              {t.categoryRank <= 10 ? (
                <Badge tone="warning" className="px-1.5 py-0 text-[10px]">
                  อันดับ {t.categoryRank} ในหมวด (อิ่มตัว)
                </Badge>
              ) : (
                <span>อันดับ {t.categoryRank} ในหมวด</span>
              )}
            </>
          )}
          {t.category && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{t.category}</span>
            </>
          )}
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2 border-t border-border pt-3">
          <Metric label="ราคา" value={dash(t.price, formatMoney)} />
          <Metric label="ขายแล้ว" value={dash(t.soldCount, formatNumber)} />
          <Metric label="ชิ้น/วัน" value={dash(t.soldVelocity, (v) => formatNumber(Math.round(v)))} />
          <Metric label="ค่าคอม" value={dash(t.commissionRate, (v) => `${v}%`)} />
        </div>
      </Card>
    </button>
  );
}

/* ----------------------------------------------------------------- drawer */

function TrendDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { can } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const detail = useQuery({ queryKey: ["trends", "detail", id], queryFn: () => api.get<TrendDetail>(`/scraping/trends/${id}`) });
  const t = detail.data;
  const canRun = can("scraping:run");

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
      await qc.invalidateQueries({ queryKey: ["trends"] });
    } catch (err) {
      if (err instanceof ApiError && err.code === "INTEGRATION_NOT_CONFIGURED") toast.error(`ยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์: ${err.message}`);
      else toast.error(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col bg-card shadow-2xl outline-none">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <DialogPrimitive.Title className="min-w-0 flex-1 truncate font-semibold">{t?.title ?? "รายละเอียดสินค้า"}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">รายละเอียดสินค้าเทรนด์</DialogPrimitive.Description>
          <button onClick={onClose} className="grid size-8 place-items-center rounded-lg hover:bg-accent" aria-label="ปิด">
            <X className="size-4" />
          </button>
        </div>
        {!t ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-48" />
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            <div className="flex gap-4">
              <Thumb src={t.imageUrl} className="size-24" />
              <div className="min-w-0 flex-1 space-y-1.5 text-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <PlatformTag platform={t.platform} />
                  <Badge tone={TREND_STATUS[t.status].tone}>{TREND_STATUS[t.status].label}</Badge>
                  <Badge tone={scoreTone(t.pickScore)}>เหมาะทำนายหน้า {t.pickScore == null ? "—" : Math.round(t.pickScore)}/100</Badge>
                  <Badge tone="neutral">แรงกระแส {t.trendScore == null ? "—" : Math.round(t.trendScore)}/100</Badge>
                </div>
                {t.shopName && <p className="text-muted-foreground">ร้าน {t.shopName}</p>}
                <p className="text-xs text-muted-foreground">
                  แหล่ง: {t.sourceName ?? "นำเข้า CSV"} · อัปเดต {formatDateTime(t.lastSeenAt)}
                </p>
                {t.url && (
                  <a href={t.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    เปิดหน้าสินค้า <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-xl border border-border p-3 sm:grid-cols-5">
              <Metric label="ราคา" value={dash(t.price, formatMoney)} />
              <Metric label="ขายแล้ว" value={dash(t.soldCount, formatNumber)} />
              <Metric label="ชิ้น/วัน" value={dash(t.soldVelocity, (v) => formatNumber(Math.round(v)))} />
              <Metric label="ค่าคอม" value={dash(t.commissionRate, (v) => `${v}%`)} />
              <Metric label="รีวิว" value={dash(t.rating, (v) => `${v.toFixed(1)} ★`)} />
            </div>

            {t.aiSearch && <AiSearchSection a={t.aiSearch} />}

            <LifecycleSection t={t} canEdit={canRun} />

            <ChecklistSection key={`${t.id}-${t.lastSeenAt}-${t.pickScore}`} t={t} canEdit={canRun} />

            <SalesChart snapshots={t.snapshots} />

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 font-semibold">
                  <Bot className="size-4 text-primary" /> AI วิเคราะห์
                </h3>
                {canRun && (
                  <Button
                    size="sm"
                    variant={t.aiAnalysis ? "outline" : "default"}
                    disabled={busy !== null}
                    onClick={() => act("ai", () => api.post(`/scraping/trends/${id}/analyze`, { refresh: Boolean(t.aiAnalysis) }))}
                  >
                    {busy === "ai" ? <Loader2 className="animate-spin" /> : t.aiAnalysis ? <RefreshCw /> : <Sparkles />}
                    {t.aiAnalysis ? "วิเคราะห์ใหม่" : "ให้ AI วิเคราะห์"}
                  </Button>
                )}
              </div>
              {t.aiAnalysis ? (
                <Analysis a={t.aiAnalysis} />
              ) : (
                <p className="rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
                  AI จะประเมินความเหมาะสมกับร้านและโปรไฟล์ช่อง จังหวะกระแส กลุ่มเป้าหมาย จุดขาย ไอเดียเปิดคลิป และความเสี่ยงด้านโฆษณา
                </p>
              )}
            </section>
          </div>
        )}
        {t && canRun && (
          <div className="flex flex-wrap gap-2 border-t border-border p-3">
            {t.status === "imported" ? (
              can("products:read") &&
              t.importedProductId && (
                <Button size="sm" variant="outline" onClick={() => router.push(`/products/${t.importedProductId}`)}>
                  <PackagePlus /> ดูสินค้าที่นำเข้า
                </Button>
              )
            ) : (
              <>
                {can("products:write") && (
                  <Button
                    size="sm"
                    disabled={busy !== null}
                    onClick={() =>
                      act(
                        "import",
                        () => api.post(`/scraping/trends/${id}/import-product`, {}),
                        "นำเข้าเป็นสินค้าฉบับร่างแล้ว — ตรวจราคา/ต้นทุนในหน้าสินค้าก่อนเปิดขาย",
                      )
                    }
                  >
                    {busy === "import" ? <Loader2 className="animate-spin" /> : <PackagePlus />} นำเข้าเป็นสินค้า
                  </Button>
                )}
                {t.status === "watching" ? (
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act("st", () => api.patch(`/scraping/trends/${id}`, { status: "new" }))}>
                    <EyeOff /> เลิกติดตาม
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act("st", () => api.patch(`/scraping/trends/${id}`, { status: "watching" }), "เพิ่มในรายการติดตาม")}>
                    <Eye /> ติดตาม
                  </Button>
                )}
                {t.status !== "ignored" && (
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act("ig", () => api.patch(`/scraping/trends/${id}`, { status: "ignored" }))}>
                    ไม่สนใจ
                  </Button>
                )}
              </>
            )}
            {can("video:create") && (
              <Button size="sm" variant="outline" onClick={() => router.push(`/videos?trend=${id}`)}>
                <Clapperboard /> สร้างวิดีโอ
              </Button>
            )}
            {t.platform === "shopee" &&
              (t.affiliateUrl ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => void navigator.clipboard.writeText(t.affiliateUrl!).then(() => toast.success("คัดลอกลิงก์ affiliate แล้ว"))}
                >
                  <Link2 /> คัดลอกลิงก์ affiliate
                </Button>
              ) : (
                t.url && (
                  <Button size="sm" variant="outline" className="ml-auto" disabled={busy !== null} onClick={() => act("aff", () => api.post(`/scraping/trends/${id}/affiliate-link`, {}), "สร้างลิงก์ affiliate แล้ว")}>
                    {busy === "aff" ? <Loader2 className="animate-spin" /> : <Link2 />} สร้างลิงก์ affiliate
                  </Button>
                )
              ))}
          </div>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

const shortDay = (iso: string) => new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short" });

/** Single series (units sold over time): no legend, title names it; tooltip on hover. */
function SalesChart({ snapshots }: { snapshots: TrendDetail["snapshots"] }) {
  const data = snapshots.filter((s) => s.soldCount != null).map((s) => ({ t: s.capturedAt, sold: s.soldCount as number }));
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">ยอดขายสะสมตามเวลา</h3>
      {data.length < 2 ? (
        <p className="rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
          ต้องมีข้อมูลอย่างน้อย 2 ครั้งห่างกันเกิน 20 ชั่วโมง จึงจะคำนวณความเร็วยอดขายและแสดงกราฟได้
        </p>
      ) : (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gSold" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" tickFormatter={shortDay} stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis
                tickFormatter={(v: number) => new Intl.NumberFormat("th-TH", { notation: "compact" }).format(v)}
                stroke="var(--muted-foreground)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={44}
                domain={["auto", "auto"]}
              />
              <Tooltip
                cursor={{ stroke: "var(--border)" }}
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
                      <p className="font-medium">{formatDateTime(String(payload[0].payload.t))}</p>
                      <p className="text-muted-foreground">
                        ขายแล้ว <span className="font-medium text-foreground">{formatNumber(Number(payload[0].value))}</span> ชิ้น
                      </p>
                    </div>
                  ) : null
                }
              />
              <Area type="monotone" dataKey="sold" stroke="var(--chart-1)" strokeWidth={2} fill="url(#gSold)" activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

function Analysis({ a }: { a: TrendDetail["aiAnalysis"] & object }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-start gap-3 rounded-xl bg-primary-soft/60 p-3">
        <div className="text-center">
          <p className="text-2xl font-bold tabular-nums text-primary">{a.fitScore}</p>
          <p className="text-[10px] text-muted-foreground">/10 เหมาะกับร้าน</p>
        </div>
        <p className="min-w-0 flex-1">{a.verdict}</p>
      </div>
      {a.phaseComment && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">จังหวะกระแส</p>
          <p>{a.phaseComment}</p>
        </div>
      )}
      {a.channelFit && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">เข้ากับช่อง{a.channelProfile ? ` "${a.channelProfile.name}"` : ""}</p>
          <p>{a.channelFit}</p>
        </div>
      )}
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-muted-foreground">กลุ่มเป้าหมาย</dt>
          <dd>{a.targetAudience}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">ราคาขายแนะนำ</dt>
          <dd>{a.suggestedPrice == null ? "—" : formatMoney(a.suggestedPrice)}</dd>
        </div>
      </dl>
      <List title="จุดขาย" items={a.sellingPoints} icon={<Star className="size-3.5 text-primary" />} />
      <List title="ไอเดียเปิดคลิป 3 วินาทีแรก" items={a.videoHooks} icon={<Sparkles className="size-3.5 text-primary" />} />
      <div>
        <p className="text-xs font-medium text-muted-foreground">มุมเล่าเรื่อง</p>
        <p>{a.contentAngle}</p>
      </div>
      {a.risks.length > 0 && <List title="ความเสี่ยง" items={a.risks} icon={<AlertTriangle className="size-3.5 text-warning" />} />}
      {a.provider && <p className="text-[11px] text-muted-foreground">วิเคราะห์โดย {a.provider === "minimax" ? "MiniMax" : "Claude"} · ใช้ประกอบการตัดสินใจ ไม่ใช่คำแนะนำทางกฎหมาย</p>}
    </div>
  );
}

function List({ title, items, icon }: { title: string; items: string[]; icon: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="space-y-1">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-0.5 shrink-0">{icon}</span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
