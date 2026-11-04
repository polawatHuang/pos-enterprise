"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Clapperboard,
  Download,
  Film,
  ImageIcon,
  Loader2,
  Mic,
  Music,
  Pause,
  RefreshCw,
  Save,
  Sparkles,
  UserRound,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api, apiDownload } from "@/lib/api";
import type { DramaCatalog, DramaCharacter, DramaProject, DramaShot, DramaStepKey, DramaVisualMode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Label, Skeleton, Textarea } from "@/components/ui/primitives";
import { MinimaxVoicePicker } from "@/components/videos/voice-picker";

const STEPS: { key: DramaStepKey; label: string; icon: typeof Film }[] = [
  { key: "setup", label: "ตั้งค่าเรื่อง", icon: Wand2 },
  { key: "script", label: "บทบรรยาย", icon: Clapperboard },
  { key: "characters", label: "ตัวละคร", icon: UserRound },
  { key: "cover", label: "สร้างปก", icon: ImageIcon },
  { key: "storyboard", label: "สตอรี่บอร์ด", icon: Film },
  { key: "export", label: "รวม/ส่งออก", icon: Download },
];
const NEXT_LABEL: Record<DramaStepKey, string> = {
  setup: "บันทึกแล้วไปสร้างบทบรรยาย",
  script: "ไปสร้างตัวละคร",
  characters: "ไปสร้างปก",
  cover: "ไปทำสตอรี่บอร์ด",
  storyboard: "ไปพากย์เสียงและรวมวิดีโอ",
  export: "พากย์เสียงและรวมวิดีโอ",
};
/** Fallback look of a style card before its sample picture exists. */
const STYLE_GRADIENT: Record<string, string> = {
  realistic: "from-amber-700 to-stone-900",
  cinematic: "from-sky-800 to-slate-950",
  vintage: "from-orange-300 to-amber-800",
  noir: "from-zinc-400 to-zinc-900",
  cartoon2d: "from-cyan-400 to-blue-700",
  anime: "from-pink-400 to-indigo-700",
  watercolor: "from-teal-200 to-sky-600",
  pencil: "from-lime-200 to-emerald-700",
  cgi3d: "from-violet-400 to-purple-800",
  fantasy: "from-fuchsia-500 to-indigo-900",
  papercut: "from-rose-300 to-orange-600",
};

type Settings = {
  title: string;
  genre: string;
  substyle: string | null;
  style: string;
  lengthSec: number;
  visualMode: DramaVisualMode;
  premise: string;
  narratorVoiceId: string;
  music: boolean;
};
const settingsOf = (p: DramaProject): Settings => ({
  title: p.title,
  genre: p.genre,
  substyle: p.substyle,
  style: p.style,
  lengthSec: p.lengthSec,
  visualMode: p.visualMode,
  premise: p.premise ?? "",
  narratorVoiceId: p.narratorVoiceId ?? "",
  music: p.music,
});

const errorText = (err: unknown) => (err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ");

export function DramaStudio({ id }: { id: number }) {
  const q = useQuery({
    queryKey: ["drama", id],
    queryFn: () => api.get<DramaProject>(`/drama/${id}`),
    refetchInterval: (query) => (query.state.data?.runTarget ? 4000 : false),
  });
  if (!q.data) return <Skeleton className="h-[70vh] rounded-2xl" />;
  return <Studio p={q.data} />;
}

/** Opens at the first unfinished step; the step-01 settings are edited locally until saved. */
function Studio({ p }: { p: DramaProject }) {
  const id = p.id;
  const qc = useQueryClient();
  const catalog = useQuery({ queryKey: ["drama", "catalog"], queryFn: () => api.get<DramaCatalog>("/drama/catalog"), staleTime: 30_000 });
  const [step, setStep] = useState<DramaStepKey>(() =>
    p.shots.length ? (p.steps.find((x) => x.status !== "done" && x.key !== "setup")?.key ?? "export") : "setup",
  );
  const [form, setForm] = useState<Settings>(() => settingsOf(p));
  const [busy, setBusy] = useState(false);

  const set = (data: DramaProject) => qc.setQueryData(["drama", id], data);
  const call = async (fn: () => Promise<DramaProject>, ok?: string) => {
    setBusy(true);
    try {
      set(await fn());
      if (ok) toast.success(ok);
      return true;
    } catch (err) {
      toast.error(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const saveSettings = () =>
    call(() =>
      api.put<DramaProject>(`/drama/${id}/settings`, {
        ...form,
        substyle: form.substyle || null,
        premise: form.premise || null,
        narratorVoiceId: form.narratorVoiceId || null,
      }),
    );
  const run = (target: DramaStepKey | "all") => call(() => api.post<DramaProject>(`/drama/${id}/run`, { target }));
  const redo = (what: "character" | "shot" | "cover" | "voices", itemId?: number) => call(() => api.post<DramaProject>(`/drama/${id}/redo`, { what, itemId }));
  const stop = () => call(() => api.post<DramaProject>(`/drama/${id}/cancel`), "ยกเลิกงานออโต้แล้ว งานที่สร้างเสร็จยังอยู่ในโปรเจกต์");
  const statusOf = (k: DramaStepKey) => p.steps.find((s) => s.key === k)?.status ?? "todo";
  const running = Boolean(p.runTarget);
  const idx = STEPS.findIndex((s) => s.key === step);

  const next = async () => {
    if (step === "setup" && !(await saveSettings())) return;
    if (step === "export") {
      await run("export");
      return;
    }
    const nextKey = STEPS[idx + 1].key;
    if (statusOf(nextKey) === "todo" && !running && (nextKey === "script" || p.shots.length)) await run(nextKey);
    setStep(nextKey);
  };
  const auto = async () => {
    if (step === "setup" && !(await saveSettings())) return;
    if (await run("all")) toast.success("เริ่มทำออโต้แล้ว ระบบข้ามงานที่เสร็จแล้วและทำต่อจากจุดเดิม");
  };

  return (
    <div className="pb-40 sm:pb-28">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/drama" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> ละครทั้งหมด
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-xl font-semibold sm:text-2xl">{p.title}</h1>
        {running && (
          <Badge tone="primary" className="max-w-full">
            <Loader2 className="size-3 shrink-0 animate-spin" /> <span className="truncate">{p.stageDetail ?? "กำลังทำงาน"}</span>
          </Badge>
        )}
      </div>
      {p.error && !running && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          <X className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1">{p.error}</span>
        </div>
      )}

      {/* step bar */}
      <nav aria-label="ขั้นตอน" className="mb-5 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {STEPS.map((s, i) => {
          const st = statusOf(s.key);
          const active = s.key === step;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setStep(s.key)}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition",
                active
                  ? "border-transparent bg-gradient-to-r from-rose-600 to-fuchsia-600 text-white shadow-md"
                  : st === "done"
                    ? "border-success/40 bg-success-soft/50 hover:bg-success-soft"
                    : "border-border bg-card hover:bg-accent",
              )}
            >
              <span className={cn("text-xs tabular-nums", active ? "text-white/80" : "text-muted-foreground")}>{String(i + 1).padStart(2, "0")}</span>
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
              {st === "running" ? (
                <Loader2 className="size-4 shrink-0 animate-spin" />
              ) : st === "done" ? (
                <span className={cn("grid size-5 shrink-0 place-items-center rounded-full", active ? "bg-white/25" : "bg-success text-white")}>
                  <Check className="size-3" />
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {step === "setup" && catalog.data && <SetupStep form={form} onChange={setForm} catalog={catalog.data} />}
      {step === "script" && <ScriptStep p={p} busy={busy} onRun={() => run("script")} onSaved={set} />}
      {step === "characters" && (
        <CharactersStep p={p} busy={busy} catalog={catalog.data} onRun={() => run("characters")} onRedo={(cid) => redo("character", cid)} onSaved={set} />
      )}
      {step === "cover" && <CoverStep p={p} busy={busy} onRun={() => run("cover")} onRedo={() => redo("cover")} />}
      {step === "storyboard" && <StoryboardStep p={p} busy={busy} onRun={() => run("storyboard")} onRedo={(sid) => redo("shot", sid)} onSaved={set} />}
      {step === "export" && <ExportStep p={p} busy={busy} onRun={() => run("export")} onRevoice={() => redo("voices")} />}

      {/* sticky actions */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/90 backdrop-blur lg:left-[var(--sidebar-width,16rem)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
          <Button variant="outline" onClick={() => setStep(STEPS[Math.max(0, idx - 1)].key)} disabled={idx === 0}>
            <ArrowLeft /> ย้อนกลับ
          </Button>
          <Button variant="secondary" className="min-w-0 flex-1 sm:flex-none" onClick={() => void next()} disabled={busy || (running && step !== "setup")}>
            {step === "setup" ? <Save /> : step === "export" ? <Clapperboard /> : null}
            <span className="truncate">{NEXT_LABEL[step]}</span>
          </Button>
          <div className="hidden flex-1 sm:block" />
          {running ? (
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => void stop()} disabled={busy}>
              <Pause /> หยุดออโต้
            </Button>
          ) : (
            <Button
              className="h-auto w-full flex-col gap-0 bg-gradient-to-r from-rose-600 to-fuchsia-600 py-2 text-white shadow-lg hover:opacity-95 sm:w-auto sm:px-6"
              onClick={() => void auto()}
              disabled={busy}
            >
              <span className="flex items-center gap-2 text-base font-semibold">
                <Sparkles className="size-4" /> ทำออโต้ที่ค้างต่อ
              </span>
              <span className="text-[11px] font-normal text-white/85">ข้ามงานที่เสร็จแล้ว ทำต่อจากจุดเดิม</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- 01 setup */

function SetupStep({ form, onChange, catalog }: { form: Settings; onChange: (f: Settings) => void; catalog: DramaCatalog }) {
  const qc = useQueryClient();
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...form, [k]: v });
  const genre = catalog.genres.find((g) => g.id === form.genre);
  const previews = catalog.previews[form.genre] ?? {};
  const pending = Object.values(previews).some((x) => x.status === "pending");
  const missing = catalog.styles.some((s) => !previews[s.id]?.url);
  // poll the gallery while its sample pictures are being drawn
  useQuery({
    queryKey: ["drama", "catalog", "poll", form.genre],
    queryFn: async () => {
      await qc.invalidateQueries({ queryKey: ["drama", "catalog"], exact: true });
      return Date.now();
    },
    enabled: pending,
    refetchInterval: 4000,
  });
  const makePreviews = async () => {
    try {
      await api.post("/drama/catalog/previews", { genre: form.genre });
      await qc.invalidateQueries({ queryKey: ["drama", "catalog"], exact: true });
      toast.success("กำลังสร้างภาพตัวอย่างทีละภาพ (ประมาณ 1–2 นาที)");
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  const len = catalog.lengths.find((l) => l.sec === form.lengthSec) ?? catalog.lengths[0];

  return (
    <div className="space-y-6">
      <Section n="01" title="หมวดหมู่เรื่องเล่า" hint="เลือกแนวเรื่อง เพื่อกำหนดโทน บทพูด และภาพให้เข้ากัน">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {catalog.genres.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onChange({ ...form, genre: g.id, substyle: null })}
              className={cn(
                "rounded-xl border p-3 text-left transition",
                form.genre === g.id
                  ? "border-transparent bg-gradient-to-br from-rose-600 to-fuchsia-600 text-white shadow-md"
                  : "border-border bg-card hover:bg-accent",
              )}
            >
              <p className="font-semibold">{g.label}</p>
              <p className={cn("mt-0.5 line-clamp-2 text-xs", form.genre === g.id ? "text-white/85" : "text-muted-foreground")}>{g.hint}</p>
            </button>
          ))}
        </div>
        {!!genre?.substyles.length && (
          <div className="mt-3 flex flex-wrap gap-2">
            {genre.substyles.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => set("substyle", form.substyle === s ? null : s)}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition",
                  form.substyle === s ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:bg-accent",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section
        n="02"
        title="สไตล์ภาพ"
        hint="ภาพทุกช็อต ตัวละคร และปกจะใช้สไตล์เดียวกัน"
        action={
          missing && catalog.configured.minimax ? (
            <Button size="sm" variant="outline" onClick={() => void makePreviews()} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Sparkles />} {pending ? "กำลังสร้างภาพตัวอย่าง…" : "สร้างภาพตัวอย่างสไตล์"}
            </Button>
          ) : null
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {catalog.styles.map((s) => {
            const pv = previews[s.id];
            const on = form.style === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => set("style", s.id)}
                className={cn(
                  "group overflow-hidden rounded-xl border-2 text-left transition",
                  on ? "border-rose-600 shadow-lg shadow-rose-600/20" : "border-transparent bg-card hover:border-border",
                )}
              >
                <div className={cn("relative aspect-[4/3] overflow-hidden bg-gradient-to-br", STYLE_GRADIENT[s.id] ?? "from-slate-500 to-slate-900")}>
                  {pv?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={pv.url} alt="" className="size-full object-cover transition group-hover:scale-105" />
                  ) : pv?.status === "pending" ? (
                    <Loader2 className="absolute inset-0 m-auto size-6 animate-spin text-white/70" />
                  ) : null}
                  {on && (
                    <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-rose-600 text-white">
                      <Check className="size-4" />
                    </span>
                  )}
                </div>
                <div className={cn("p-3", on ? "bg-rose-600 text-white" : "bg-card")}>
                  <p className="font-semibold">{s.label}</p>
                  <p className={cn("mt-0.5 line-clamp-2 text-xs", on ? "text-white/85" : "text-muted-foreground")}>{s.hint}</p>
                </div>
              </button>
            );
          })}
        </div>
      </Section>

      <Section n="03" title="ความยาวและการเคลื่อนไหว" hint="คลิปแนวตั้ง 9:16 สำหรับ TikTok / Reels / Shorts">
        <div className="flex flex-wrap gap-2">
          {catalog.lengths.map((l) => (
            <button
              key={l.sec}
              type="button"
              onClick={() => set("lengthSec", l.sec)}
              className={cn(
                "rounded-xl border px-4 py-2 text-sm",
                form.lengthSec === l.sec ? "border-primary bg-primary-soft font-semibold text-primary" : "border-border bg-card hover:bg-accent",
              )}
            >
              {l.label} <span className="text-xs text-muted-foreground">· ~{l.shots} ช็อต</span>
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {catalog.visualModes.map((m) => {
            const clips = Math.round(len.shots * m.clipShare);
            const on = form.visualMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => set("visualMode", m.id)}
                className={cn("rounded-xl border-2 p-4 text-left transition", on ? "border-rose-600 bg-rose-600/5" : "border-border bg-card hover:bg-accent")}
              >
                <p className="flex items-center gap-2 font-semibold">
                  {m.id === "stills" ? <ImageIcon className="size-4" /> : <Film className="size-4" />} {m.label}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{m.hint}</p>
                <p className="mt-2 text-xs">
                  ภาพ AI ~{len.shots + 5} ภาพ{clips ? ` · คลิป H3 ${clips} คลิป (~${clips * 6} วินาที)` : ""}
                </p>
              </button>
            );
          })}
        </div>
      </Section>

      <Section n="04" title="ไอเดียเรื่องและเสียง" hint="เว้นว่างได้ ให้ AI คิดเรื่องใหม่ตามแนวที่เลือก">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="dr-premise">ไอเดียเรื่อง</Label>
            <Textarea
              id="dr-premise"
              rows={5}
              maxLength={2000}
              value={form.premise}
              onChange={(e) => set("premise", e.target.value)}
              placeholder="เช่น หญิงสาวย้ายเข้าบ้านริมคลองของยาย แล้วได้ยินเสียงเรียกชื่อทุกคืนตอนตีสาม…"
            />
          </div>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="dr-title">ชื่อเรื่อง (AI ตั้งให้ได้)</Label>
              <Input id="dr-title" value={form.title} maxLength={255} onChange={(e) => set("title", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Mic className="size-4" /> เสียงผู้บรรยาย
              </Label>
              <MinimaxVoicePicker
                value={form.narratorVoiceId}
                onChange={(v) => set("narratorVoiceId", v)}
                configured={catalog.configured.minimax}
                defaultVoiceId={catalog.configured.defaultVoiceId}
              />
              <p className="text-xs text-muted-foreground">ตัวละครแต่ละตัวได้เสียงของตัวเองอัตโนมัติ เปลี่ยนได้ที่ขั้นตัวละคร</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.music} onChange={(e) => set("music", e.target.checked)} className="size-4 accent-primary" />
              <Music className="size-4" /> ใส่เพลงประกอบเบา ๆ
            </label>
          </div>
        </div>
      </Section>
      {(!catalog.configured.minimax || !catalog.configured.shotstack) && (
        <p className="rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm text-warning">
          ยังไม่ได้ตั้งค่า{" "}
          {[!catalog.configured.minimax && "MiniMax (MINIMAX_API_KEY)", !catalog.configured.shotstack && "Shotstack (ตัวรวมวิดีโอ)"]
            .filter(Boolean)
            .join(" และ ")}{" "}
          ที่หน้า{" "}
          <a href="/settings/integrations" className="underline">
            การเชื่อมต่อ API
          </a>
        </p>
      )}
    </div>
  );
}

function Section({ n, title, hint, action, children }: { n: string; title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-rose-600 to-fuchsia-600 text-xs font-bold text-white">
          {n}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{title}</h2>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Empty / waiting state of a step with its main action. */
function StepCta({
  p,
  step,
  title,
  hint,
  action,
  busy,
  onRun,
}: {
  p: DramaProject;
  step: DramaStepKey;
  title: string;
  hint: string;
  action: string;
  busy: boolean;
  onRun: () => void;
}) {
  const runningHere = p.runningStep === step;
  return (
    <Card className="flex flex-col items-center gap-3 p-10 text-center">
      {runningHere ? <Loader2 className="size-10 animate-spin text-primary" /> : <Sparkles className="size-10 text-rose-500" />}
      <p className="text-lg font-semibold">{runningHere ? (p.stageDetail ?? "กำลังทำงาน") : title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{hint}</p>
      {!runningHere && (
        <Button onClick={onRun} disabled={busy || !!p.runTarget} className="bg-gradient-to-r from-rose-600 to-fuchsia-600 text-white">
          <Sparkles /> {action}
        </Button>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------- 02 script */

function ScriptStep({ p, busy, onRun, onSaved }: { p: DramaProject; busy: boolean; onRun: () => void; onSaved: (d: DramaProject) => void }) {
  if (!p.shots.length) {
    return (
      <StepCta
        p={p}
        step="script"
        title="ให้ AI เขียนบทละคร"
        hint="AI จะคิดเรื่อง ตัวละคร และแบ่งเป็นช็อตพร้อมคำบรรยาย บทพูด และคำสั่งภาพ ใช้เวลาประมาณ 1 นาที"
        action="เขียนบทด้วย AI"
        busy={busy}
        onRun={onRun}
      />
    );
  }
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">เรื่องย่อ</p>
            <p className="font-medium">{p.logline}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !!p.runTarget}
            onClick={() => {
              if (window.confirm("เขียนบทใหม่ทั้งเรื่อง? ตัวละคร ภาพ และเสียงเดิมจะถูกลบ")) onRun();
            }}
          >
            <RefreshCw /> เขียนบทใหม่
          </Button>
        </div>
      </Card>
      <div className="space-y-3">
        {p.shots.map((s) => (
          <ShotEditor key={`${s.id}-${s.narration}-${JSON.stringify(s.dialogue)}`} p={p} shot={s} onSaved={onSaved} />
        ))}
      </div>
    </div>
  );
}

function ShotEditor({ p, shot, onSaved }: { p: DramaProject; shot: DramaShot; onSaved: (d: DramaProject) => void }) {
  const [narration, setNarration] = useState(shot.narration ?? "");
  const [dialogue, setDialogue] = useState(shot.dialogue);
  const [saving, setSaving] = useState(false);
  const dirty = narration !== (shot.narration ?? "") || JSON.stringify(dialogue) !== JSON.stringify(shot.dialogue);
  const save = async () => {
    setSaving(true);
    try {
      onSaved(await api.put<DramaProject>(`/drama/${p.id}/shots/${shot.id}`, { narration: narration || null, dialogue }));
      toast.success(`บันทึกช็อต ${shot.seq} แล้ว`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  };
  const nameOf = (key: string) => p.characters.find((c) => c.key === key)?.name ?? key;
  return (
    <Card className="p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="grid size-7 place-items-center rounded-lg bg-muted text-xs font-bold tabular-nums">{shot.seq}</span>
        <p className="min-w-0 flex-1 truncate font-medium">{shot.scene}</p>
        <Badge tone={shot.kind === "clip" ? "primary" : "neutral"}>{shot.kind === "clip" ? "คลิป H3" : "ภาพนิ่ง"}</Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">ผู้บรรยาย</Label>
          <Textarea rows={2} value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="(ไม่มีคำบรรยาย)" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">บทพูดตัวละคร</Label>
          {dialogue.length ? (
            dialogue.map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="shrink-0 rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                  {nameOf(d.character)}
                </span>
                <Input value={d.line} onChange={(e) => setDialogue(dialogue.map((x, j) => (j === i ? { ...x, line: e.target.value } : x)))} className="h-9" />
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">— ไม่มีบทพูด —</p>
          )}
        </div>
      </div>
      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">คำสั่งภาพ (ภาษาอังกฤษ)</summary>
        <p className="mt-1 whitespace-pre-wrap">{shot.visualPrompt}</p>
        {shot.camera && <p className="mt-1">กล้อง: {shot.camera}</p>}
      </details>
      {dirty && (
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />} บันทึกช็อตนี้
          </Button>
        </div>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------- 03 characters */

function CharactersStep({
  p,
  busy,
  catalog,
  onRun,
  onRedo,
  onSaved,
}: {
  p: DramaProject;
  busy: boolean;
  catalog?: DramaCatalog;
  onRun: () => void;
  onRedo: (id: number) => void;
  onSaved: (d: DramaProject) => void;
}) {
  if (!p.shots.length) return <NeedScript />;
  const anyPortrait = p.characters.some((c) => c.portraitUrl);
  return (
    <div className="space-y-4">
      {!anyPortrait && (
        <StepCta
          p={p}
          step="characters"
          title="วาดหน้าตาตัวละคร"
          hint="AI วาดภาพตัวละครทุกตัวตามสไตล์ที่เลือก แล้วใช้เป็นต้นแบบให้หน้าตาเหมือนเดิมทุกช็อต"
          action="สร้างภาพตัวละคร"
          busy={busy}
          onRun={onRun}
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {p.characters.map((c) => (
          <CharacterCard key={`${c.id}-${c.voiceId}`} p={p} c={c} busy={busy} catalog={catalog} onRedo={onRedo} onSaved={onSaved} />
        ))}
      </div>
    </div>
  );
}

function CharacterCard({
  p,
  c,
  busy,
  catalog,
  onRedo,
  onSaved,
}: {
  p: DramaProject;
  c: DramaCharacter;
  busy: boolean;
  catalog?: DramaCatalog;
  onRedo: (id: number) => void;
  onSaved: (d: DramaProject) => void;
}) {
  const saveVoice = async (voiceId: string) => {
    try {
      onSaved(await api.put<DramaProject>(`/drama/${p.id}/characters/${c.id}`, { voiceId: voiceId || null }));
      toast.success(`เปลี่ยนเสียง ${c.name} แล้ว`);
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  const drawing = p.runningStep === "characters" && c.status === "pending";
  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-[3/4] bg-gradient-to-br from-slate-700 to-slate-950">
        {c.portraitUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.portraitUrl} alt={c.name} className="size-full object-cover" />
        ) : drawing ? (
          <Loader2 className="absolute inset-0 m-auto size-8 animate-spin text-white/70" />
        ) : (
          <UserRound className="absolute inset-0 m-auto size-12 text-white/30" />
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-3 pt-10 text-white">
          <p className="text-lg font-semibold">{c.name}</p>
          <p className="text-xs text-white/80">{c.role}</p>
        </div>
      </div>
      <div className="space-y-3 p-3">
        {c.description && <p className="text-sm text-muted-foreground">{c.description}</p>}
        {c.status === "failed" && <p className="text-xs text-danger">{c.error}</p>}
        <div className="space-y-1">
          <Label className="text-xs">เสียงตัวละคร</Label>
          <MinimaxVoicePicker
            value={c.voiceId ?? ""}
            onChange={(v) => void saveVoice(v)}
            configured={!!catalog?.configured.minimax}
            defaultVoiceId={catalog?.configured.defaultVoiceId ?? null}
          />
        </div>
        <Button variant="outline" size="sm" className="w-full" disabled={busy || !!p.runTarget} onClick={() => onRedo(c.id)}>
          <RefreshCw /> {c.portraitUrl ? "วาดใหม่" : "วาดตัวละครนี้"}
        </Button>
      </div>
    </Card>
  );
}

const NeedScript = () => <Card className="p-8 text-center text-sm text-muted-foreground">ต้องมีบทก่อน — ไปที่ขั้น 02 บทบรรยาย แล้วให้ AI เขียนบท</Card>;

/* --------------------------------------------------------------- 04 cover */

function CoverStep({ p, busy, onRun, onRedo }: { p: DramaProject; busy: boolean; onRun: () => void; onRedo: () => void }) {
  if (!p.shots.length) return <NeedScript />;
  if (!p.coverUrl) {
    return (
      <StepCta
        p={p}
        step="cover"
        title="สร้างภาพปกละคร"
        hint="ภาพปกแนวโปสเตอร์หนังพร้อมตัวละครหลัก ใช้เป็นฉากเปิดของวิดีโอและภาพหน้าปกโพสต์"
        action="สร้างปก"
        busy={busy}
        onRun={onRun}
      />
    );
  }
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative aspect-[9/16] w-full max-w-xs overflow-hidden rounded-2xl shadow-2xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.coverUrl} alt="ปก" className="size-full object-cover" />
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent p-5 pb-16 text-center">
          <p className="text-2xl font-extrabold leading-tight text-white drop-shadow-lg">{p.title}</p>
        </div>
      </div>
      <Button variant="outline" onClick={onRedo} disabled={busy || !!p.runTarget}>
        <RefreshCw /> สร้างปกใหม่
      </Button>
    </div>
  );
}

/* ---------------------------------------------------------- 05 storyboard */

function StoryboardStep({
  p,
  busy,
  onRun,
  onRedo,
  onSaved,
}: {
  p: DramaProject;
  busy: boolean;
  onRun: () => void;
  onRedo: (id: number) => void;
  onSaved: (d: DramaProject) => void;
}) {
  if (!p.shots.length) return <NeedScript />;
  const done = p.shots.filter((s) => s.imageStatus === "done").length;
  const clips = p.shots.filter((s) => s.kind === "clip");
  const toggle = async (s: DramaShot) => {
    try {
      onSaved(await api.put<DramaProject>(`/drama/${p.id}/shots/${s.id}`, { kind: s.kind === "clip" ? "still" : "clip" }));
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            ภาพ {done}/{p.shots.length} ช็อต · คลิป H3 {clips.filter((s) => s.clipStatus === "done").length}/{clips.length}
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-rose-600 to-fuchsia-600 transition-all"
              style={{ width: `${(done / Math.max(1, p.shots.length)) * 100}%` }}
            />
          </div>
        </div>
        {p.runningStep !== "storyboard" && (
          <Button onClick={onRun} disabled={busy || !!p.runTarget} className="bg-gradient-to-r from-rose-600 to-fuchsia-600 text-white">
            <Sparkles /> {done ? "สร้างช็อตที่เหลือ" : "สร้างสตอรี่บอร์ด"}
          </Button>
        )}
      </Card>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {p.shots.map((s) => {
          const working =
            p.runningStep === "storyboard" &&
            (s.imageStatus === "pending" || s.clipStatus === "processing" || (s.kind === "clip" && s.clipStatus === "pending"));
          return (
            <div key={s.id} className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="relative aspect-[9/16] bg-gradient-to-br from-slate-700 to-slate-950">
                {s.clipUrl ? (
                  <video
                    src={s.clipUrl}
                    poster={s.imageUrl ?? undefined}
                    muted
                    loop
                    playsInline
                    className="size-full object-cover"
                    onMouseEnter={(e) => void e.currentTarget.play()}
                    onMouseLeave={(e) => e.currentTarget.pause()}
                  />
                ) : s.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.imageUrl} alt="" className="size-full object-cover" />
                ) : null}
                {working && (
                  <div className="absolute inset-0 grid place-items-center bg-black/40">
                    <Loader2 className="size-7 animate-spin text-white" />
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-bold text-white tabular-nums">{s.seq}</span>
                <button
                  type="button"
                  onClick={() => void toggle(s)}
                  disabled={!!p.runTarget}
                  className={cn(
                    "absolute right-2 top-2 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
                    s.kind === "clip" ? "bg-rose-600 text-white" : "bg-white/85 text-slate-900",
                  )}
                  title="สลับคลิป / ภาพนิ่ง"
                >
                  {s.kind === "clip" ? "คลิป H3" : "ภาพนิ่ง"}
                </button>
              </div>
              <div className="space-y-1.5 p-2">
                <p className="line-clamp-2 text-xs text-muted-foreground">{s.narration || s.dialogue[0]?.line || s.scene}</p>
                {(s.imageStatus === "failed" || s.clipStatus === "failed") && <p className="line-clamp-2 text-[11px] text-danger">{s.error}</p>}
                <Button variant="ghost" size="sm" className="h-7 w-full text-xs" disabled={busy || !!p.runTarget} onClick={() => onRedo(s.id)}>
                  <RefreshCw /> สร้างช็อตนี้ใหม่
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- 06 export */

function ExportStep({ p, busy, onRun, onRevoice }: { p: DramaProject; busy: boolean; onRun: () => void; onRevoice: () => void }) {
  if (!p.shots.length) return <NeedScript />;
  const voiced = p.shots.filter((s) => s.audioStatus === "done").length;
  if (!p.outputUrl) {
    return (
      <div className="space-y-4">
        <StepCta
          p={p}
          step="export"
          title="พากย์เสียงและรวมเป็นวิดีโอ"
          hint={`ผู้บรรยายและตัวละครพากย์ทีละช็อต (${voiced}/${p.shots.length}) แล้วรวมภาพ คลิป คำบรรยาย และเพลงเป็นไฟล์ MP4 แนวตั้ง`}
          action="พากย์เสียงและรวมวิดีโอ"
          busy={busy}
          onRun={onRun}
        />
      </div>
    );
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <div className="mx-auto w-full max-w-xs overflow-hidden rounded-2xl bg-black shadow-2xl">
        <video src={p.outputUrl} poster={p.coverUrl ?? undefined} controls playsInline className="aspect-[9/16] w-full" />
      </div>
      <div className="space-y-4">
        <Card className="space-y-3 p-4">
          <p className="text-lg font-semibold">{p.title}</p>
          <p className="text-sm text-muted-foreground">
            {p.durationSec ? `${Math.floor(p.durationSec / 60)}:${String(p.durationSec % 60).padStart(2, "0")} นาที · ` : ""}
            {p.shots.length} ช็อต · 9:16
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={p.outputUrl}
              download={`${p.title}.mp4`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              <Download className="size-4" /> ดาวน์โหลด MP4
            </a>
            {p.hasSubtitles && (
              <Button variant="outline" onClick={() => void apiDownload(`/drama/${p.id}/subtitles.srt`, undefined, `drama-${p.id}.srt`)}>
                <Download /> คำบรรยาย .srt
              </Button>
            )}
            <Link href="/social" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium hover:bg-accent">
              ตั้งเวลาโพสต์
            </Link>
          </div>
        </Card>
        <Card className="space-y-2 p-4">
          <div className="flex items-center gap-2">
            <p className="flex-1 font-semibold">เสียงพากย์</p>
            <Button variant="outline" size="sm" onClick={onRevoice} disabled={busy || !!p.runTarget}>
              <RefreshCw /> พากย์ใหม่ทั้งเรื่อง
            </Button>
          </div>
          <ul className="max-h-72 space-y-1.5 overflow-y-auto text-sm">
            {p.shots.flatMap((s) =>
              s.audio.map((a, i) => (
                <li key={`${s.id}-${i}`} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-xs text-muted-foreground tabular-nums">{s.seq}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 text-xs",
                      a.speaker === "narrator" ? "bg-muted" : "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
                    )}
                  >
                    {a.speaker === "narrator" ? "ผู้บรรยาย" : (a.name ?? a.speaker)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{a.text}</span>
                  {a.url && <audio src={a.url} controls preload="none" className="h-8 w-28 shrink-0 sm:w-40" />}
                </li>
              )),
            )}
          </ul>
        </Card>
      </div>
    </div>
  );
}
