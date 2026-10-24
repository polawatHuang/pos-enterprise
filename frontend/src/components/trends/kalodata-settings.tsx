"use client";

import { useDeferredValue, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleSlash, Coins, Download, Globe, KeyRound, Loader2, RefreshCw, Search, Tag } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { KaloCategoryOption, KaloRun, KaloSettings } from "@/lib/types";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label, NativeSelect, Skeleton } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";
import { baht, Growth, periodLabel } from "./kalo-ui";

const STAGE: Record<string, string> = {
  balance: "ตรวจเครดิต",
  categories: "ดึงหมวดหมู่",
  products: "ดึงสินค้าขายดี",
  details: "ดึงรายละเอียดสินค้า",
  finish: "สรุปผล",
  done: "เสร็จ",
};

/** The month "pull now" asks for: the next one if it has ended, else a re-pull of the latest ended month. */
const pullPeriod = (s: KaloSettings) => (s.nextPeriod <= s.latestFull ? s.nextPeriod : s.latestFull);

/** Switch the monthly Kalodata pull on/off, pick the day, see credits and past pulls, pull now. */
export function KalodataSettingsDialog() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const canRun = can("scraping:run");
  const q = useQuery({
    queryKey: ["trends", "kalodata", "settings"],
    queryFn: () => api.get<KaloSettings>("/scraping/kalodata/settings"),
    refetchInterval: (query) => (query.state.data?.running ? 5_000 : false),
  });
  const credits = useQuery({
    queryKey: ["trends", "kalodata", "balance"],
    queryFn: () => api.get<{ balance: number | null; error: string | null }>("/scraping/kalodata/balance"),
    enabled: Boolean(q.data?.configured),
    staleTime: 60_000,
  });
  const [busy, setBusy] = useState<string | null>(null);

  const save = async (patch: { enabled?: boolean; dayOfMonth?: number; scope?: "category" | "all"; categoryId?: string | null }) => {
    setBusy("save");
    try {
      await api.put("/scraping/kalodata/settings", patch);
      await qc.invalidateQueries({ queryKey: ["trends"] });
      if (patch.enabled !== undefined) toast.success(patch.enabled ? "เปิดดึงข้อมูลอัตโนมัติแล้ว" : "ปิดดึงข้อมูลอัตโนมัติแล้ว");
      if (patch.categoryId || patch.scope === "all") toast.success(patch.scope === "all" ? "ดึงทั้งตลาด" : "เลือกหมวดแล้ว");
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.code === "INTEGRATION_NOT_CONFIGURED"
          ? "ยังไม่ได้ใส่คีย์ Kalodata — ไปที่หน้าการเชื่อมต่อ API"
          : err instanceof Error
            ? err.message
            : "บันทึกไม่สำเร็จ",
      );
    } finally {
      setBusy(null);
    }
  };
  const runNow = async () => {
    const s = q.data;
    if (!s || s.estimateCredits == null) return;
    if (
      !window.confirm(
        `ดึงข้อมูล ${periodLabel(pullPeriod(s))} ตอนนี้? ใช้ประมาณ ${s.estimateCredits} เครดิต (ราว ${Math.round(s.estimateCredits * 0.1 * 36)} บาท)`,
      )
    )
      return;
    setBusy("run");
    try {
      await api.post("/scraping/kalodata/run", { period: pullPeriod(s) });
      toast.success("เริ่มดึงข้อมูลแล้ว ใช้เวลาประมาณ 5–10 นาที");
      await qc.invalidateQueries({ queryKey: ["trends"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เริ่มดึงข้อมูลไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };

  const s = q.data;
  const balance = credits.data?.balance ?? null;
  const balanceError = credits.data?.error ?? (credits.isError ? credits.error.message : null);
  return (
    <DialogContent
      title="ข้อมูลตลาดจาก Kalodata"
      description="อันดับหมวดหมู่และสินค้าขายดีของ TikTok Shop ไทย ดึงอัตโนมัติเดือนละครั้งหลังจบเดือน"
      className="max-w-xl"
    >
      {q.isError ? (
        <div className="space-y-3 rounded-lg bg-danger-soft p-4 text-sm text-danger">
          <p>โหลดการตั้งค่าไม่สำเร็จ: {q.error.message}</p>
          <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
            <RefreshCw /> ลองใหม่
          </Button>
        </div>
      ) : !s ? (
        <Skeleton className="h-60" />
      ) : (
        <div className="space-y-4">
          {!s.configured && (
            <div className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-sm">
              <KeyRound className="mt-0.5 size-4 shrink-0 text-warning" />
              <p>
                ยังไม่ได้ใส่คีย์ API ของ Kalodata — สร้างคีย์ที่หน้าบัญชีของ Kalodata แล้วใส่ใน{" "}
                <Link href="/settings/integrations" className="font-medium text-primary underline">
                  การเชื่อมต่อ API
                </Link>{" "}
                (ช่อง KALODATA_API_KEY)
              </p>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
            <div>
              <p className="font-medium">ดึงข้อมูลอัตโนมัติทุกเดือน</p>
              <p className="text-xs text-muted-foreground">ปิดไว้ได้ถ้ายังไม่อยากใช้เครดิต — ข้อมูลเดิมยังดูได้ตามปกติ</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={s.enabled}
              aria-label="ดึงข้อมูลอัตโนมัติทุกเดือน"
              disabled={!canRun || busy !== null || (!s.configured && !s.enabled)}
              onClick={() => void save({ enabled: !s.enabled })}
              className={cn(
                "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
                s.enabled ? "bg-primary" : "bg-muted-foreground/30",
              )}
            >
              <span className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform", s.enabled ? "translate-x-6" : "translate-x-1")} />
            </button>
          </div>

          <CategoryPicker s={s} canEdit={canRun && busy === null} onChange={(patch) => void save(patch)} />

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="kalo-day">ดึงทุกวันที่</Label>
              <NativeSelect
                id="kalo-day"
                className="h-10 w-full"
                value={s.dayOfMonth}
                disabled={!canRun || busy !== null}
                onChange={(e) => void save({ dayOfMonth: Number(e.target.value) })}
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d} ของเดือน
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">เครดิตคงเหลือ</p>
              <p className="flex items-center gap-1 text-lg font-semibold tabular-nums">
                <Coins className="size-4 text-warning" />
                {credits.isFetching && balance == null ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : balance != null ? (
                  formatNumber(balance)
                ) : (
                  "—"
                )}
              </p>
              {balanceError && <p className="text-xs text-danger">{balanceError}</p>}
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">ใช้ต่อเดือนประมาณ</p>
              {s.estimateCredits == null ? (
                <p className="text-sm text-muted-foreground">เลือกหมวดก่อน</p>
              ) : (
                <>
                  <p className="text-lg font-semibold tabular-nums">~{s.estimateCredits} เครดิต</p>
                  <p className="text-xs text-muted-foreground">≈ ${(s.estimateCredits * 0.1).toFixed(1)} USD</p>
                </>
              )}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            ข้อมูลล่าสุด: {s.lastPeriod ? periodLabel(s.lastPeriod) : "ยังไม่เคยดึง"} · รอบถัดไป: {periodLabel(s.nextPeriod)}
            {s.enabled ? ` (ดึงวันที่ ${s.dayOfMonth} ขึ้นไป)` : " (ปิดอยู่)"}
          </p>

          {canRun && (
            <Button variant="outline" onClick={() => void runNow()} disabled={busy !== null || s.running || !s.configured || s.estimateCredits == null}>
              {busy === "run" || s.running ? <Loader2 className="animate-spin" /> : <Download />}{" "}
              {s.running
                ? "กำลังดึงข้อมูล…"
                : s.nextPeriod <= s.latestFull
                  ? `ดึงข้อมูล ${periodLabel(s.nextPeriod)} ตอนนี้`
                  : `ดึง ${periodLabel(s.latestFull)} ใหม่อีกครั้ง`}
            </Button>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">ประวัติการดึง</p>
              <button
                type="button"
                className="inline-flex min-h-9 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => void q.refetch()}
              >
                <RefreshCw className="size-3.5" /> รีเฟรช
              </button>
            </div>
            {s.runs.length === 0 ? (
              <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">ยังไม่เคยดึงข้อมูล</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {s.runs.map((r) => (
                  <RunRow key={r.id} r={r} />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </DialogContent>
  );
}

const LEVEL = { 1: "หมวดหลัก", 2: "หมวดรอง", 3: "หมวดย่อย" } as const;

/** Which category to pull: search the categories already pulled (free), or the whole market. */
function CategoryPicker({
  s,
  canEdit,
  onChange,
}: {
  s: KaloSettings;
  canEdit: boolean;
  onChange: (patch: { scope?: "category" | "all"; categoryId?: string | null }) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(s.scope === "category" && !s.category);
  const [text, setText] = useState("");
  const q = useDeferredValue(text.trim());
  const [loading, setLoading] = useState(false);
  const options = useQuery({
    queryKey: ["trends", "kalodata", "category-options", q],
    queryFn: () => api.get<{ items: KaloCategoryOption[]; needsLoad: boolean }>("/scraping/kalodata/category-options", q ? { q } : {}),
    enabled: open,
  });
  const pick = (patch: { scope?: "category" | "all"; categoryId?: string | null }) => {
    onChange(patch);
    setOpen(false);
    setText("");
  };
  const loadList = async () => {
    if (!window.confirm("โหลดรายชื่อหมวดหลักและหมวดรองจาก Kalodata? ใช้ประมาณ 3 เครดิต (ครั้งเดียว)")) return;
    setLoading(true);
    try {
      const r = await api.post<{ categories: number; credits: number }>("/scraping/kalodata/category-options/load");
      toast.success(`โหลดแล้ว ${formatNumber(r.categories)} หมวด ใช้ ${r.credits} เครดิต`);
      await qc.invalidateQueries({ queryKey: ["trends", "kalodata", "category-options"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "โหลดไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">ดึงข้อมูลหมวดไหน</p>
          {s.scope === "all" ? (
            <p className="flex items-center gap-1.5 text-sm">
              <Globe className="size-4 text-primary" /> ทั้งตลาด <span className="text-xs text-muted-foreground">(ทุกหมวด ใช้เครดิตมาก)</span>
            </p>
          ) : s.category ? (
            <p className="text-sm">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <Tag className="size-4 text-primary" /> {s.category.name}
              </span>
              <span className="block text-xs text-muted-foreground">
                {s.category.path ? `${s.category.path} · ` : ""}
                {LEVEL[s.category.level]} · ดึงเฉพาะหมวดนี้ หมวดย่อย และสินค้าในหมวด
              </span>
            </p>
          ) : (
            <p className="text-sm text-warning">ยังไม่ได้เลือกหมวด — เลือกก่อนดึงข้อมูล</p>
          )}
        </div>
        {canEdit && !open && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            เปลี่ยน
          </Button>
        )}
      </div>
      {open && (
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="ค้นหาหมวด เช่น ครีม หูฟัง ของเล่น"
              className="pl-9"
              aria-label="ค้นหาหมวด"
            />
          </div>
          <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border" role="listbox" aria-label="หมวดหมู่">
            <li>
              <button
                type="button"
                role="option"
                aria-selected={s.scope === "all"}
                disabled={!canEdit}
                onClick={() => pick({ scope: "all", categoryId: null })}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted/50"
              >
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Globe className="size-4 text-primary" /> ทั้งตลาด
                </span>
                <span className="text-xs text-muted-foreground">~30 เครดิต/รอบ</span>
              </button>
            </li>
            {options.isPending ? (
              <li className="p-3">
                <Skeleton className="h-16" />
              </li>
            ) : options.data?.needsLoad ? (
              <li className="space-y-2 p-3 text-sm text-muted-foreground">
                <p>ยังไม่มีรายชื่อหมวดในระบบ</p>
                <Button size="sm" variant="outline" onClick={() => void loadList()} disabled={loading || !canEdit}>
                  {loading ? <Loader2 className="animate-spin" /> : <Coins className="text-warning" />} โหลดรายชื่อหมวด · ~3 เครดิต
                </Button>
              </li>
            ) : !options.data?.items.length ? (
              <li className="p-3 text-sm text-muted-foreground">ไม่พบหมวดที่ตรงกับ &quot;{q}&quot;</li>
            ) : (
              options.data.items.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={s.category?.id === o.id}
                    disabled={!canEdit}
                    onClick={() => pick({ categoryId: o.id })}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/50",
                      s.category?.id === o.id && "bg-primary/10",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{o.name}</span>
                        <Badge tone="neutral">{LEVEL[o.level]}</Badge>
                      </span>
                      {o.path && <span className="block truncate text-xs text-muted-foreground">{o.path}</span>}
                    </span>
                    <span className="shrink-0 text-right text-xs tabular-nums">
                      {baht(o.revenue)}
                      <span className="block">
                        <Growth value={o.growth} />
                      </span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>หมวดหลักใช้ ~6 เครดิต · หมวดรอง/ย่อยใช้ ~4 เครดิต ต่อรอบ</span>
            {(s.category || s.scope === "all") && (
              <button type="button" className="min-h-9 font-medium hover:text-foreground" onClick={() => setOpen(false)}>
                ยกเลิก
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RunRow({ r }: { r: KaloRun }) {
  return (
    <li className="space-y-1 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {r.status === "succeeded" ? (
          <CheckCircle2 className="size-4 text-success" />
        ) : r.status === "failed" ? (
          <CircleSlash className="size-4 text-danger" />
        ) : (
          <Loader2 className="size-4 animate-spin text-primary" />
        )}
        <span className="font-medium">{r.period ? periodLabel(r.period) : "—"}</span>
        <span className="text-xs text-muted-foreground">{r.scopeName ?? "ทั้งตลาด"}</span>
        <Badge tone={r.status === "succeeded" ? "success" : r.status === "failed" ? "danger" : "primary"}>
          {r.status === "running" ? (STAGE[r.stage ?? ""] ?? "กำลังดึง") : r.status === "succeeded" ? "สำเร็จ" : "ไม่สำเร็จ"}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(r.startedAt)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {r.counts
          ? `${formatNumber(r.counts.categories)} หมวด · ${formatNumber(r.counts.products)} สินค้า · รายละเอียด ${formatNumber(r.counts.details)} ตัว`
          : ""}
        {r.credits != null ? ` · ใช้ ~${r.credits} เครดิต` : ""}
        {r.status === "running" && r.tasksLeft ? ` · เหลือ ${r.tasksLeft} ขั้น` : ""} · {r.triggeredBy}
      </p>
      {r.error && <p className="text-xs text-danger">{r.error}</p>}
      {r.warnings.length > 0 && (
        <p className="flex items-start gap-1 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" /> ข้ามบางส่วน {r.warnings.length} รายการ: {r.warnings[0]}
        </p>
      )}
    </li>
  );
}
