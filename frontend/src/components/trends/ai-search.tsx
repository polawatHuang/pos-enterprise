"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ExternalLink, Loader2, RefreshCw, Search, Settings2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { AiSearchConfig, AiSearchSettings, ChannelProfile, ScrapeRun, TrendAiSearch } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label, NativeSelect } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";
import { AI_PLATFORM_FOCUS, TREND_STAGE } from "./labels";

const STEPS = [
  { key: "searching", label: "AI ค้นเว็บหาสินค้ากำลังมาแรง", hint: "อาจใช้เวลา 1–3 นาที" },
  { key: "summarizing", label: "สรุปรายการสินค้า" },
  { key: "importing", label: "ตรวจแหล่งอ้างอิงและนำเข้า" },
] as const;

const errorText = (err: unknown) =>
  err instanceof ApiError && err.code === "INTEGRATION_NOT_CONFIGURED"
    ? `ยังไม่ได้ตั้งค่า AI บนเซิร์ฟเวอร์: ${err.message}`
    : err instanceof Error
      ? err.message
      : "เริ่มค้นหาไม่สำเร็จ";

/** POST /ai-search; on 409 (a run is already going) returns the running run's source instead of failing. */
export async function startAiSearch(body: Partial<AiSearchConfig> = {}): Promise<{ sourceId: number; runId: number | null }> {
  try {
    const r = await api.post<{ runId: number; sourceId: number }>("/scraping/ai-search", body);
    return r;
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      const s = await api.get<AiSearchSettings>("/scraping/ai-search");
      if (s.sourceId) return { sourceId: s.sourceId, runId: null };
    }
    throw err;
  }
}

/** Progress + result of an AI search run, with a settings form to search again. */
export function AiSearchDialog({
  sourceId,
  runId,
  onRestart,
  onShowResults,
}: {
  sourceId: number;
  runId: number | null;
  onRestart: (body: Partial<AiSearchConfig>) => Promise<void>;
  onShowResults: () => void;
}) {
  const qc = useQueryClient();
  const [showSettings, setShowSettings] = useState(false);
  const runs = useQuery({
    queryKey: ["trends", "runs", { sourceId }],
    queryFn: () => api.get<ScrapeRun[]>("/scraping/runs", { sourceId }),
    refetchInterval: (q) => (q.state.data?.[0]?.status === "running" ? 4000 : false),
  });
  const run = (runId ? runs.data?.find((r) => r.id === runId) : null) ?? runs.data?.[0] ?? null;
  const status = run?.status;

  // Refresh the trend list once the run finishes
  const lastStatus = useRef(status);
  useEffect(() => {
    if (lastStatus.current === "running" && status && status !== "running") void qc.invalidateQueries({ queryKey: ["trends", "list"] });
    lastStatus.current = status;
  }, [status, qc]);

  return (
    <DialogContent title="AI ค้นหาสินค้าขายดี" description="AI ค้นเว็บหาสินค้าที่กำลังมาแรง เก็บเฉพาะรายการที่มีแหล่งอ้างอิงจากผลค้นจริง" className="max-w-2xl">
      <div className="space-y-4 text-sm">
        {!run ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> กำลังโหลด…
          </div>
        ) : run.status === "running" ? (
          <Progress run={run} />
        ) : run.status === "failed" ? (
          <div className="flex gap-2 rounded-xl bg-danger-soft p-3 text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-medium">ค้นหาไม่สำเร็จ</p>
              <p className="break-words text-xs">{run.error}</p>
            </div>
          </div>
        ) : (
          <Result run={run} onShowResults={onShowResults} />
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          <Button type="button" size="sm" variant="ghost" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>
            <Settings2 /> ตั้งค่าการค้นหา
          </Button>
          {run && run.status !== "running" && (
            <Button type="button" size="sm" variant="outline" onClick={() => void onRestart({})}>
              <RefreshCw /> ค้นหาอีกครั้ง
            </Button>
          )}
        </div>
        {showSettings && (
          <SettingsForm
            disabled={status === "running"}
            onSubmit={async (body) => {
              await onRestart(body);
              setShowSettings(false);
            }}
          />
        )}
      </div>
    </DialogContent>
  );
}

function Progress({ run }: { run: ScrapeRun }) {
  const current = STEPS.findIndex((s) => s.key === run.stage);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.round((now - new Date(run.startedAt).getTime()) / 1000));
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <ol className="space-y-2">
        {STEPS.map((s, i) => {
          const done = current > i;
          const active = current === i || (current === -1 && i === 0);
          return (
            <li key={s.key} className={cn("flex items-center gap-2", !done && !active && "text-muted-foreground")}>
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full border",
                  done ? "border-success bg-success text-white" : active ? "border-primary text-primary" : "border-border",
                )}
              >
                {done ? <Check className="size-3.5" /> : active ? <Loader2 className="size-3.5 animate-spin" /> : i + 1}
              </span>
              <span className={cn(active && "font-medium")}>{s.label}</span>
              {active && "hint" in s && <span className="text-xs text-muted-foreground">({s.hint})</span>}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted-foreground">
        ผ่านไป {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")} นาที · ปิดหน้าต่างนี้ได้ ระบบทำงานต่อเบื้องหลัง
      </p>
    </div>
  );
}

function Result({ run, onShowResults }: { run: ScrapeRun; onShowResults: () => void }) {
  const s = run.summary;
  if (!s) return <p>นำเข้า {run.itemsFound} รายการ</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-success-soft p-3 text-success">
        <Check className="size-4 shrink-0" />
        <p className="min-w-0 flex-1">
          พบ {s.products.length} สินค้า จากการค้น {s.searches} ครั้ง ({s.sources} แหล่ง) · นำเข้า {s.imported} รายการ (ใหม่ {s.created})
          {s.enriched > 0 && ` · ดึงตัวเลขจริงจาก Shopee ${s.enriched} สินค้า`}
        </p>
        <Button size="sm" onClick={onShowResults}>
          ดูในรายการ
        </Button>
      </div>
      {s.enriched === 0 && s.products.length > 0 && (
        <p className="text-xs text-muted-foreground">
          สินค้าที่ AI พบยังไม่มีตัวเลขยอดขาย/ราคาที่ยืนยันได้ — ตรวจในแอปแล้วกรอกในเช็กลิสต์ หรือตั้งค่า Shopee Affiliate เพื่อดึงตัวเลขจริงอัตโนมัติ
        </p>
      )}
      <ul className="max-h-[45vh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
        {s.products.map((p) => (
          <li key={p.title} className="space-y-1 px-3 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{p.title}</span>
              {p.trendStage && <Badge tone={TREND_STAGE[p.trendStage]?.tone ?? "neutral"}>{TREND_STAGE[p.trendStage]?.label ?? p.trendStage}</Badge>}
              {p.category && <span className="text-xs text-muted-foreground">{p.category}</span>}
            </div>
            {p.whyTrending && <p className="text-xs text-muted-foreground">{p.whyTrending}</p>}
            <Sources evidence={p.evidence} />
          </li>
        ))}
      </ul>
      {s.dropped.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">ตัดออก {s.dropped.length} รายการ (ไม่มีแหล่งอ้างอิงจริง / เกินจำนวน)</summary>
          <ul className="mt-1 list-disc pl-5">
            {s.dropped.map((d, i) => (
              <li key={i}>
                {d.title} — {d.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-[11px] text-muted-foreground">
        ค้นโดย {s.provider === "minimax" ? "MiniMax" : "Claude"}
        {s.profile ? ` · ใช้โปรไฟล์ช่อง "${s.profile.name}"` : ""}
      </p>
    </div>
  );
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
};

function Sources({ evidence }: { evidence: { url: string; title: string | null }[] }) {
  if (!evidence.length) return null;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {evidence.map((e) => (
        <li key={e.url} className="min-w-0 max-w-full">
          <a href={e.url} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-center gap-1 text-primary hover:underline">
            <span className="truncate">{e.title || hostOf(e.url)}</span>
            <ExternalLink className="size-3 shrink-0" />
          </a>
        </li>
      ))}
    </ul>
  );
}

function SettingsForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (body: Partial<AiSearchConfig>) => Promise<void> }) {
  const settings = useQuery({ queryKey: ["trends", "ai-search-settings"], queryFn: () => api.get<AiSearchSettings>("/scraping/ai-search") });
  const profiles = useQuery({ queryKey: ["trends", "channel-profiles"], queryFn: () => api.get<ChannelProfile[]>("/scraping/channel-profiles") });
  if (!settings.data) return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
  return <SettingsFields key={settings.dataUpdatedAt} s={settings.data} profiles={profiles.data ?? []} disabled={disabled} onSubmit={onSubmit} />;
}

function SettingsFields({
  s,
  profiles,
  disabled,
  onSubmit,
}: {
  s: AiSearchSettings;
  profiles: ChannelProfile[];
  disabled: boolean;
  onSubmit: (body: Partial<AiSearchConfig>) => Promise<void>;
}) {
  const [focus, setFocus] = useState(s.config.focus ?? "");
  const [platformFocus, setPlatformFocus] = useState<AiSearchConfig["platformFocus"]>(s.config.platformFocus);
  const [count, setCount] = useState(String(s.config.count));
  const [profileId, setProfileId] = useState(s.config.channelProfileId ? String(s.config.channelProfileId) : "");
  const [enrich, setEnrich] = useState(s.config.enrich);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSubmit({ focus: focus.trim(), platformFocus, count: Number(count), channelProfileId: profileId ? Number(profileId) : null, enrich });
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="ai-focus">หมวด/คำค้นที่สนใจ (เว้นว่าง = ทุกหมวด)</Label>
        <Input id="ai-focus" value={focus} onChange={(e) => setFocus(e.target.value)} maxLength={200} placeholder="เช่น ของใช้ในห้องนอน, สัตว์เลี้ยง" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ai-platform">แพลตฟอร์ม</Label>
        <NativeSelect id="ai-platform" value={platformFocus} onChange={(e) => setPlatformFocus(e.target.value as AiSearchConfig["platformFocus"])}>
          {AI_PLATFORM_FOCUS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ai-count">จำนวนสินค้า</Label>
        <NativeSelect id="ai-count" value={count} onChange={(e) => setCount(e.target.value)}>
          {[5, 8, 10, 15].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="ai-profile">โปรไฟล์ช่อง</Label>
        <NativeSelect id="ai-profile" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
          <option value="">ใช้โปรไฟล์หลัก (ถ้ามี)</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <label className="flex items-center gap-2 sm:col-span-2">
        <input type="checkbox" checked={enrich} onChange={(e) => setEnrich(e.target.checked)} className="size-4 accent-primary" />
        ดึงสินค้าจริงพร้อมตัวเลขจาก Shopee Affiliate
        {!s.shopeeEnrich && <span className="text-xs text-muted-foreground">(ยังไม่ได้ตั้งค่า)</span>}
      </label>
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" size="sm" disabled={disabled || busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Search />} ค้นหาด้วยค่านี้
        </Button>
      </div>
    </form>
  );
}

/** Drawer section: why AI suggested the item and where it read that. */
export function AiSearchSection({ a }: { a: TrendAiSearch }) {
  return (
    <section className="space-y-2 rounded-xl border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 font-semibold">
          <Sparkles className="size-4 text-primary" /> ทำไม AI แนะนำ
        </h3>
        {a.trendStage && <Badge tone={TREND_STAGE[a.trendStage]?.tone ?? "neutral"}>{TREND_STAGE[a.trendStage]?.label ?? a.trendStage}</Badge>}
        {!a.verified && <Badge tone="warning">ยังไม่มีตัวเลขยืนยัน</Badge>}
      </div>
      {a.whyTrending && <p>{a.whyTrending}</p>}
      {(a.soldHint || a.priceHint) && (
        <p className="text-xs text-muted-foreground">
          ตามบทความ: {[a.soldHint, a.priceHint].filter(Boolean).join(" · ")} (ตัวเลขจากแหล่งข่าว ยังไม่ยืนยัน)
        </p>
      )}
      {a.keywords.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">คำค้นแนะนำ:</span>
          {a.keywords.map((k) => (
            <Badge key={k} tone="neutral">
              {k}
            </Badge>
          ))}
        </div>
      )}
      {a.risks.length > 0 && <p className="text-xs text-warning">ข้อควรระวัง: {a.risks.join(" · ")}</p>}
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">แหล่งอ้างอิง</p>
        <Sources evidence={a.evidence} />
      </div>
    </section>
  );
}

export { errorText as aiSearchErrorText };

/** Header button: starts a search with the last-used settings in one click. */
export function useAiSearchLauncher() {
  const [state, setState] = useState<{ sourceId: number; runId: number | null } | null>(null);
  const [starting, setStarting] = useState(false);
  const qc = useQueryClient();
  const start = async (body: Partial<AiSearchConfig> = {}) => {
    setStarting(true);
    try {
      const r = await startAiSearch(body);
      setState(r);
      if (!r.runId) toast.info("AI กำลังค้นหาอยู่แล้ว — แสดงความคืบหน้าของรอบนี้");
      await qc.invalidateQueries({ queryKey: ["trends", "runs"] });
      await qc.invalidateQueries({ queryKey: ["trends", "ai-search-settings"] });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setStarting(false);
    }
  };
  return { state, starting, start, close: () => setState(null) };
}
