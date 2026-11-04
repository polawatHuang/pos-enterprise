"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ShoppingBag,
  Upload,
  Check,
  Clapperboard,
  Download,
  Film,
  ImageIcon,
  Layers,
  ListOrdered,
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
import type { DramaCatalog, DramaCharacter, DramaEpisode, DramaProject, DramaShot, DramaStepKey } from "@/lib/types";
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
  episodesTotal: number;
  premise: string;
  narratorVoiceId: string;
  music: boolean;
  tieIn: boolean;
  productName: string;
  productPitch: string;
};
const settingsOf = (p: DramaProject): Settings => ({
  title: p.title,
  genre: p.genre,
  substyle: p.substyle,
  style: p.style,
  lengthSec: p.lengthSec,
  episodesTotal: p.episodesTotal,
  premise: p.premise ?? "",
  narratorVoiceId: p.narratorVoiceId ?? "",
  music: p.music,
  tieIn: p.tieIn,
  productName: p.productName ?? "",
  productPitch: p.productPitch ?? "",
});

const errorText = (err: unknown) => (err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ");

export function DramaStudio({ id }: { id: number }) {
  // null = let the server pick (the episode being made, or the first unfinished one)
  const [ep, setEp] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ["drama", id, ep],
    queryFn: () => api.get<DramaProject>(`/drama/${id}${ep ? `?episode=${ep}` : ""}`),
    refetchInterval: (query) => (query.state.data?.runTarget ? 4000 : false),
    placeholderData: (prev) => prev,
  });
  if (!q.data) return <Skeleton className="h-[70vh] rounded-2xl" />;
  return <Studio p={q.data} queryKey={["drama", id, ep]} onEpisode={setEp} />;
}

/** Opens at the first unfinished step; the step-01 settings are edited locally until saved. */
function Studio({ p, queryKey, onEpisode }: { p: DramaProject; queryKey: unknown[]; onEpisode: (n: number) => void }) {
  const id = p.id;
  const ep = p.episode;
  const series = p.episodesTotal > 1;
  const qc = useQueryClient();
  const catalog = useQuery({
    queryKey: ["drama", "catalog"],
    queryFn: () => api.get<DramaCatalog>("/drama/catalog"),
    staleTime: 30_000,
  });
  const [step, setStep] = useState<DramaStepKey>(() =>
    p.hasOutline ? (p.steps.find((x) => x.status !== "done" && x.key !== "setup")?.key ?? "export") : "setup",
  );
  const [form, setForm] = useState<Settings>(() => settingsOf(p));
  const [busy, setBusy] = useState(false);

  const set = (data: DramaProject) => {
    qc.setQueryData(queryKey, data);
    if (data.episode !== ep) onEpisode(data.episode);
  };
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
        productName: form.productName || null,
        productPitch: form.productPitch || null,
      }),
    );
  const run = (target: DramaStepKey | "all" | "series") => call(() => api.post<DramaProject>(`/drama/${id}/run`, { target, episode: ep }));
  const redo = (what: "character" | "shot" | "clip" | "cover" | "voices" | "outline", itemId?: number) =>
    call(() =>
      api.post<DramaProject>(`/drama/${id}/redo`, {
        what,
        itemId,
        episode: ep,
      }),
    );
  const stop = () => call(() => api.post<DramaProject>(`/drama/${id}/cancel?episode=${ep}`), "ยกเลิกงานออโต้แล้ว งานที่สร้างเสร็จยังอยู่ในโปรเจกต์");
  const left = p.episodes.filter((e) => e.status !== "done").length;
  /** Every remaining episode in order (asks first: it is the expensive button). */
  const runSeries = async () => {
    if (step === "setup" && !(await saveSettings())) return;
    const clipSec = p.estimate.perEpisode.clipSeconds * left;
    if (
      !window.confirm(
        `ทำต่อทุกตอนที่เหลือ ${left} ตอน?\nใช้คลิปวิดีโอ MiniMax H3 ประมาณ ${Math.round(clipSec / 60)} นาที (${clipSec} วินาที) และใช้เวลาหลายชั่วโมง ปิดหน้านี้ได้`,
      )
    )
      return;
    if (await run("series")) toast.success(`เริ่มทำทุกตอนต่อเนื่องแล้ว (เหลือ ${left} ตอน)`);
  };
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
    const ready = nextKey === "script" || (nextKey === "characters" || nextKey === "cover" ? p.hasOutline : p.shots.length > 0);
    if (statusOf(nextKey) === "todo" && !running && ready) await run(nextKey);
    setStep(nextKey);
  };
  const auto = async () => {
    if (step === "setup" && !(await saveSettings())) return;
    if (await run("all"))
      toast.success(
        series ? `เริ่มทำตอนที่ ${ep} ออโต้แล้ว ข้ามงานที่เสร็จแล้วและทำต่อจากจุดเดิม` : "เริ่มทำออโต้แล้ว ระบบข้ามงานที่เสร็จแล้วและทำต่อจากจุดเดิม",
      );
  };

  return (
    <div className={series ? "pb-60 sm:pb-28" : "pb-40 sm:pb-28"}>
      {/* header */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/drama" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> ละครทั้งหมด
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-xl font-semibold sm:text-2xl">{p.title}</h1>
        {series && (
          <Badge tone="neutral">
            <Layers className="size-3" /> {p.episodesTotal} ตอนจบ
          </Badge>
        )}
        {running && (
          <button type="button" onClick={() => p.runEpisode && onEpisode(p.runEpisode)} className="max-w-full" title="ไปที่ตอนที่กำลังทำ">
            <Badge tone="primary" className="max-w-full">
              <Loader2 className="size-3 shrink-0 animate-spin" /> <span className="truncate">{p.stageDetail ?? "กำลังทำงาน"}</span>
            </Badge>
          </button>
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

      {series && (step === "script" || step === "storyboard" || step === "export") && p.hasOutline && (
        <EpisodeBar episodes={p.episodes} current={ep} onPick={onEpisode} />
      )}

      {step === "setup" && catalog.data && <SetupStep form={form} onChange={setForm} catalog={catalog.data} p={p} onSaved={set} />}
      {step === "script" && <ScriptStep p={p} busy={busy} onRun={() => run("script")} onRestart={() => redo("outline")} onSaved={set} />}
      {step === "characters" && (
        <CharactersStep p={p} busy={busy} catalog={catalog.data} onRun={() => run("characters")} onRedo={(cid) => redo("character", cid)} onSaved={set} />
      )}
      {step === "cover" && <CoverStep p={p} busy={busy} onRun={() => run("cover")} onRedo={() => redo("cover")} />}
      {step === "storyboard" && (
        <StoryboardStep p={p} busy={busy} onRun={() => run("storyboard")} onRedo={(sid) => redo("shot", sid)} onRedoClip={(sid) => redo("clip", sid)} />
      )}
      {step === "export" && <ExportStep p={p} busy={busy} onRun={() => run("export")} onRevoice={() => redo("voices")} onPick={onEpisode} />}

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
            <>
              {series && left > 1 && (
                <Button variant="outline" className="h-auto w-full flex-col gap-0 py-2 sm:w-auto" onClick={() => void runSeries()} disabled={busy}>
                  <span className="flex items-center gap-2 font-semibold">
                    <Layers className="size-4" /> ทำทุกตอนต่อเนื่อง
                  </span>
                  <span className="text-[11px] font-normal text-muted-foreground">เหลือ {left} ตอน ทำเรียงจนจบเรื่อง</span>
                </Button>
              )}
              <Button
                className="h-auto w-full flex-col gap-0 bg-gradient-to-r from-rose-600 to-fuchsia-600 py-2 text-white shadow-lg hover:opacity-95 sm:w-auto sm:px-6"
                onClick={() => void auto()}
                disabled={busy}
              >
                <span className="flex items-center gap-2 text-base font-semibold">
                  <Sparkles className="size-4" /> {series ? `ทำตอนที่ ${ep} ออโต้` : "ทำออโต้ที่ค้างต่อ"}
                </span>
                <span className="text-[11px] font-normal text-white/85">ข้ามงานที่เสร็จแล้ว ทำต่อจากจุดเดิม</span>
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ episode bar */

const EPISODE_TONE: Record<DramaEpisode["status"], string> = {
  todo: "bg-muted-foreground/40",
  progress: "bg-amber-500",
  running: "bg-primary animate-pulse",
  failed: "bg-danger",
  done: "bg-success",
};

/** Which episode the script / storyboard / export steps show. */
function EpisodeBar({ episodes, current, onPick }: { episodes: DramaEpisode[]; current: number; onPick: (n: number) => void }) {
  const done = episodes.filter((e) => e.status === "done").length;
  return (
    <div className="mb-5 rounded-2xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-2 text-sm">
        <ListOrdered className="size-4 text-muted-foreground" />
        <span className="font-semibold">เลือกตอน</span>
        <span className="text-xs text-muted-foreground">
          เสร็จแล้ว {done}/{episodes.length} ตอน
        </span>
      </div>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {episodes.map((e) => (
          <button
            key={e.no}
            type="button"
            onClick={() => onPick(e.no)}
            aria-current={e.no === current ? "true" : undefined}
            title={e.title ?? undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm tabular-nums transition",
              e.no === current ? "border-transparent bg-gradient-to-r from-rose-600 to-fuchsia-600 font-semibold text-white" : "border-border hover:bg-accent",
            )}
          >
            <span className={cn("size-2 rounded-full", EPISODE_TONE[e.status])} />
            ตอน {e.no}
          </button>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- 01 setup */

function SetupStep({
  form,
  onChange,
  catalog,
  p,
  onSaved,
}: {
  form: Settings;
  onChange: (f: Settings) => void;
  catalog: DramaCatalog;
  p: DramaProject;
  onSaved: (d: DramaProject) => void;
}) {
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
      await qc.invalidateQueries({
        queryKey: ["drama", "catalog"],
        exact: true,
      });
      return Date.now();
    },
    enabled: pending,
    refetchInterval: 4000,
  });
  const makePreviews = async () => {
    try {
      await api.post("/drama/catalog/previews", { genre: form.genre });
      await qc.invalidateQueries({
        queryKey: ["drama", "catalog"],
        exact: true,
      });
      toast.success("กำลังสร้างภาพตัวอย่างทีละภาพ (ประมาณ 1–2 นาที)");
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  const len = catalog.lengths.find((l) => l.sec === form.lengthSec) ?? catalog.lengths[0];
  const written = p.episodes.some((e) => e.shots > 0);
  const clipSec = len.sec * form.episodesTotal;
  const setEpisodes = (n: number) => set("episodesTotal", Math.max(1, Math.min(catalog.maxEpisodes, Math.round(n) || 1)));

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
            <Button size="sm" variant="ghost" onClick={() => void makePreviews()} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Sparkles />} {pending ? "กำลังสร้างภาพของร้าน…" : "สร้างภาพชุดใหม่ของร้าน"}
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
                  {pv?.status === "pending" && !pv.url ? (
                    <Loader2 className="absolute inset-0 m-auto size-6 animate-spin text-white/70" />
                  ) : (
                    <StyleImage key={`${form.genre}-${s.id}-${pv?.url ?? ""}`} src={pv?.url ?? defaultPreview(form.genre, s.id)} />
                  )}
                  {pv?.status === "failed" && !pv.url && (
                    <span
                      className="absolute inset-x-1 bottom-1 truncate rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white"
                      title={pv.error ?? undefined}
                    >
                      สร้างภาพไม่สำเร็จ: {pv.error}
                    </span>
                  )}
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

      <Section n="03" title="จำนวนตอนและความยาว" hint="ตอนเดียวจบ หรือซีรีส์หลายตอน — แต่ละตอนเป็นคลิปแนวตั้ง 9:16 แยกกัน เรื่องต่อเนื่องกัน">
        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 block">จำนวนตอน</Label>
            <div className="flex flex-wrap items-center gap-2">
              {catalog.episodePresets.map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={written}
                  onClick={() => setEpisodes(n)}
                  className={cn(
                    "rounded-xl border px-4 py-2 text-sm transition disabled:opacity-50",
                    form.episodesTotal === n ? "border-primary bg-primary-soft font-semibold text-primary" : "border-border bg-card hover:bg-accent",
                  )}
                >
                  {n === 1 ? "ตอนเดียวจบ" : `${n} ตอนจบ`}
                </button>
              ))}
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                ระบุเอง
                <Input
                  type="number"
                  min={1}
                  max={catalog.maxEpisodes}
                  value={form.episodesTotal}
                  disabled={written}
                  onChange={(e) => setEpisodes(Number(e.target.value))}
                  className="h-9 w-20"
                  aria-label="จำนวนตอน"
                />
                ตอน
              </label>
            </div>
            {written && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                เขียนบทแล้ว จึงเปลี่ยนจำนวนตอนไม่ได้ — ถ้าต้องการ ให้กด &quot;เขียนเรื่องใหม่ทั้งหมด&quot; ที่ขั้น 02
              </p>
            )}
          </div>
          <div>
            <Label className="mb-1.5 block">ความยาว{form.episodesTotal > 1 ? "ต่อตอน" : ""}</Label>
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
          </div>
          <div className="flex flex-wrap items-start gap-3 rounded-xl border-2 border-rose-600/40 bg-rose-600/5 p-4">
            <Film className="mt-0.5 size-5 shrink-0 text-rose-600" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold">วิดีโอเคลื่อนไหวทุกช็อต — ไม่มีสไลด์ภาพนิ่ง</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                ตัวละครขยับ พูด และแสดงอารมณ์ทุกช็อตด้วย MiniMax H3 ยาวเท่าบทพูด ถ้าคลิปไหนสร้างไม่สำเร็จ ระบบลองใหม่อัตโนมัติ 3 ครั้ง และไม่เอาภาพนิ่งมาแทน
              </p>
              <p className="mt-2 text-xs">
                {form.episodesTotal > 1 ? `ต่อตอน: ` : ""}คลิป H3 ~{len.shots} คลิป (~{len.sec} วินาที)
                {form.episodesTotal > 1 && (
                  <>
                    {" "}
                    · ทั้งเรื่อง {form.episodesTotal} ตอน: ~{len.shots * form.episodesTotal} คลิป (~
                    {Math.round(clipSec / 60)} นาทีวิดีโอ)
                  </>
                )}
              </p>
            </div>
          </div>
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
      <TieInSection form={form} onChange={onChange} p={p} onSaved={onSaved} />
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

/** Built-in sample picture of a style for a genre (public/drama-styles); "ระบุเอง" uses the drama set. */
const defaultPreview = (genre: string, style: string) => `/drama-styles/${genre === "custom" ? "drama" : genre}/${style}.webp`;

/** A style card picture that quietly falls back to the card's gradient when the file is missing. */
function StyleImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="size-full object-cover transition group-hover:scale-105" />;
}

/** Shrink a photo in the browser (longest side 1024 px, JPEG) so the upload stays small. */
async function shrinkImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("อ่านรูปไม่ได้"));
      el.src = url;
    });
    const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("อ่านรูปไม่ได้");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Optional product tie-in: every episode gets a moment where a character presents the shop's product. */
function TieInSection({
  form,
  onChange,
  p,
  onSaved,
}: {
  form: Settings;
  onChange: (f: Settings) => void;
  p: DramaProject;
  onSaved: (d: DramaProject) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("เลือกไฟล์รูปภาพ");
    setUploading(true);
    try {
      onSaved(
        await api.post<DramaProject>(`/drama/${p.id}/product-image`, {
          image: await shrinkImage(file),
        }),
      );
      toast.success("อัปโหลดรูปสินค้าแล้ว");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setUploading(false);
    }
  };
  const remove = async () => {
    try {
      onSaved(await api.del<DramaProject>(`/drama/${p.id}/product-image`));
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  return (
    <Section
      n="05"
      title="ไทอินสินค้า"
      hint="ให้ตัวละครหยิบ ใช้ และพูดถึงสินค้าของร้านอย่างเป็นธรรมชาติในทุกตอน"
      action={
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <span>{form.tieIn ? "เปิด" : "ปิด"}</span>
          <button
            type="button"
            role="switch"
            aria-checked={form.tieIn}
            aria-label="ไทอินสินค้า"
            onClick={() => onChange({ ...form, tieIn: !form.tieIn })}
            className={cn("relative h-6 w-11 rounded-full transition", form.tieIn ? "bg-gradient-to-r from-rose-600 to-fuchsia-600" : "bg-muted")}
          >
            <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", form.tieIn ? "left-[1.375rem]" : "left-0.5")} />
          </button>
        </label>
      }
    >
      {form.tieIn ? (
        <div className="grid gap-4 md:grid-cols-[12rem_1fr]">
          <div>
            <Label className="mb-1.5 block">รูปสินค้า</Label>
            <label
              className={cn(
                "relative grid aspect-square cursor-pointer place-items-center overflow-hidden rounded-xl border-2 border-dashed bg-muted/40 text-center text-xs text-muted-foreground transition hover:border-rose-500",
                p.productImageUrl ? "border-transparent" : "border-border",
              )}
            >
              {p.productImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.productImageUrl} alt="สินค้า" className="size-full object-contain" />
              ) : uploading ? (
                <Loader2 className="size-6 animate-spin" />
              ) : (
                <span className="flex flex-col items-center gap-1 p-3">
                  <Upload className="size-6" /> แตะเพื่อเลือกรูปสินค้า
                  <span className="text-[11px]">พื้นหลังเรียบ เห็นฉลากชัด</span>
                </span>
              )}
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => void upload(e.target.files?.[0])} />
            </label>
            {p.productImageUrl && (
              <button type="button" onClick={() => void remove()} className="mt-1.5 text-xs text-muted-foreground hover:text-danger">
                ลบรูป
              </button>
            )}
          </div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="dr-product">ชื่อสินค้า</Label>
              <Input
                id="dr-product"
                value={form.productName}
                maxLength={191}
                onChange={(e) => onChange({ ...form, productName: e.target.value })}
                placeholder="เช่น เซรั่มหน้าใส สูตรเข้มข้น"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dr-pitch">สิ่งที่อยากให้ตัวละครพูดไทอิน</Label>
              <Textarea
                id="dr-pitch"
                rows={4}
                maxLength={1500}
                value={form.productPitch}
                onChange={(e) => onChange({ ...form, productPitch: e.target.value })}
                placeholder="เช่น ซึมไว ไม่เหนียว ใช้ทุกเช้าหน้าฉ่ำ สั่งได้ที่ตะกร้าในคลิป มีโปร 1 แถม 1 ถึงสิ้นเดือน"
              />
              <p className="text-xs text-muted-foreground">
                AI จะแต่งฉากไทอิน 1–2 ช็อตให้เข้ากับเรื่อง ตัวละครพูดตามนี้ และโชว์รูปสินค้าจริงบนจอช่วงนั้น · ห้ามอ้างสรรพคุณเกินจริง
              </p>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">ปิดอยู่ — ละครจะไม่มีการพูดถึงสินค้า</p>
      )}
    </Section>
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

function ScriptStep({
  p,
  busy,
  onRun,
  onRestart,
  onSaved,
}: {
  p: DramaProject;
  busy: boolean;
  onRun: () => void;
  onRestart: () => void;
  onSaved: (d: DramaProject) => void;
}) {
  const series = p.episodesTotal > 1;
  if (!p.hasOutline) {
    return (
      <StepCta
        p={p}
        step="script"
        title={series ? `ให้ AI วางโครงเรื่อง ${p.episodesTotal} ตอน` : "ให้ AI เขียนบทละคร"}
        hint={
          series
            ? `AI คิดเรื่อง ตัวละคร และเรื่องย่อของทั้ง ${p.episodesTotal} ตอนให้ต่อเนื่องกัน (มีจุดค้างท้ายทุกตอน) แล้วเขียนบทตอนที่ 1 เป็นช็อตพร้อมคำบรรยายและบทพูด`
            : "AI จะคิดเรื่อง ตัวละคร และแบ่งเป็นช็อตพร้อมคำบรรยาย บทพูด และคำสั่งวิดีโอ ใช้เวลาประมาณ 1 นาที"
        }
        action={series ? "วางโครงเรื่องและเขียนตอนที่ 1" : "เขียนบทด้วย AI"}
        busy={busy}
        onRun={onRun}
      />
    );
  }
  const e = p.episodes.find((x) => x.no === p.episode);
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">เรื่องย่อ{series ? `ทั้งเรื่อง (${p.episodesTotal} ตอนจบ)` : ""}</p>
            <p className="font-medium">{p.logline}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !!p.runTarget}
            onClick={() => {
              if (window.confirm("เขียนเรื่องใหม่ทั้งหมด? โครงเรื่อง ตัวละคร บท ภาพ คลิป และเสียงเดิมทุกตอนจะถูกลบ")) onRestart();
            }}
          >
            <RefreshCw /> เขียนเรื่องใหม่ทั้งหมด
          </Button>
        </div>
      </Card>
      {series && <OutlineCard p={p} onSaved={onSaved} />}
      {series && (
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <h2 className="min-w-0 flex-1 text-lg font-semibold">
            ตอนที่ {p.episode}
            {e?.title ? `: ${e.title}` : ""}
          </h2>
        </div>
      )}
      {!p.shots.length ? (
        <StepCta
          p={p}
          step="script"
          title={`เขียนบทตอนที่ ${p.episode}`}
          hint={`AI เขียนบทตอนนี้ต่อจากตอนที่แล้ว ตามเรื่องย่อของตอน${e?.summary ? `: ${e.summary}` : ""}`}
          action={`เขียนบทตอนที่ ${p.episode}`}
          busy={busy}
          onRun={onRun}
        />
      ) : (
        <>
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || !!p.runTarget}
              onClick={() => {
                if (
                  window.confirm(
                    `เขียนบท${series ? `ตอนที่ ${p.episode}` : ""}ใหม่? ภาพ คลิป และเสียงของ${series ? "ตอนนี้" : "เรื่องนี้"}จะถูกลบ (ตัวละครยังอยู่)`,
                  )
                )
                  onRun();
              }}
            >
              <RefreshCw /> เขียนบท{series ? "ตอนนี้" : ""}ใหม่
            </Button>
          </div>
          <div className="space-y-3">
            {p.shots.map((s) => (
              <ShotEditor key={`${s.id}-${s.narration}-${JSON.stringify(s.dialogue)}`} p={p} shot={s} onSaved={onSaved} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** The series outline: one summary per episode, editable before (or after) its script is written. */
function OutlineCard({ p, onSaved }: { p: DramaProject; onSaved: (d: DramaProject) => void }) {
  const [open, setOpen] = useState(false);
  const shown = open ? p.episodes : p.episodes.slice(0, 4);
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <ListOrdered className="size-4 text-rose-600" />
        <p className="flex-1 font-semibold">โครงเรื่องทั้ง {p.episodesTotal} ตอน</p>
        <span className="text-xs text-muted-foreground">แก้เรื่องย่อของตอนที่ยังไม่ได้เขียนบท เพื่อกำหนดทิศทางได้</span>
      </div>
      <ol className="space-y-2">
        {shown.map((e) => (
          <OutlineRow key={`${e.no}-${e.title}-${e.summary}-${e.cliffhanger}`} p={p} e={e} onSaved={onSaved} />
        ))}
      </ol>
      {p.episodes.length > 4 && (
        <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setOpen(!open)}>
          {open ? "ย่อรายการ" : `ดูทั้งหมด ${p.episodes.length} ตอน`}
        </Button>
      )}
    </Card>
  );
}

function OutlineRow({ p, e, onSaved }: { p: DramaProject; e: DramaEpisode; onSaved: (d: DramaProject) => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(e.title ?? "");
  const [summary, setSummary] = useState(e.summary ?? "");
  const [cliffhanger, setCliffhanger] = useState(e.cliffhanger ?? "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const d = await api.put<DramaProject>(`/drama/${p.id}/episodes/${e.no}`, {
        title: title || undefined,
        summary: summary || null,
        cliffhanger: cliffhanger || null,
      });
      onSaved({ ...d, episode: p.episode, shots: p.shots, steps: p.steps });
      setEditing(false);
      toast.success(`บันทึกตอนที่ ${e.no} แล้ว`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <li className={cn("rounded-xl border p-3", e.no === p.episode ? "border-rose-500/50 bg-rose-600/5" : "border-border")}>
      {editing ? (
        <div className="space-y-2">
          <Input value={title} maxLength={255} onChange={(ev) => setTitle(ev.target.value)} aria-label={`ชื่อตอนที่ ${e.no}`} />
          <Textarea rows={3} value={summary} maxLength={3000} onChange={(ev) => setSummary(ev.target.value)} placeholder="เรื่องย่อของตอน" />
          <Textarea rows={2} value={cliffhanger} maxLength={1500} onChange={(ev) => setCliffhanger(ev.target.value)} placeholder="จบตอนด้วย…" />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              ยกเลิก
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />} บันทึก
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-xs font-bold tabular-nums">{e.no}</span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{e.title}</p>
            {e.summary && <p className="text-sm text-muted-foreground">{e.summary}</p>}
            {e.cliffhanger && <p className="mt-1 text-xs text-rose-600">จบตอน: {e.cliffhanger}</p>}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)} disabled={!!p.runTarget}>
            แก้
          </Button>
        </div>
      )}
    </li>
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
      onSaved(
        await api.put<DramaProject>(`/drama/${p.id}/shots/${shot.id}`, {
          narration: narration || null,
          dialogue,
        }),
      );
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
        {shot.isProduct && (
          <Badge tone="warning">
            <ShoppingBag className="size-3" /> ไทอินสินค้า
          </Badge>
        )}
        <Badge tone="primary">
          <Film className="size-3" /> วิดีโอ H3
        </Badge>
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
  if (!p.hasOutline) return <NeedScript />;
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
      onSaved(
        await api.put<DramaProject>(`/drama/${p.id}/characters/${c.id}`, {
          voiceId: voiceId || null,
        }),
      );
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

const NeedScript = ({ episode }: { episode?: number }) => (
  <Card className="p-8 text-center text-sm text-muted-foreground">
    {episode ? `ตอนที่ ${episode} ยังไม่มีบท` : "ต้องมีบทก่อน"} — ไปที่ขั้น 02 บทบรรยาย แล้วให้ AI เขียนบท
  </Card>
);

/* --------------------------------------------------------------- 04 cover */

function CoverStep({ p, busy, onRun, onRedo }: { p: DramaProject; busy: boolean; onRun: () => void; onRedo: () => void }) {
  if (!p.hasOutline) return <NeedScript />;
  if (!p.coverUrl) {
    return (
      <StepCta
        p={p}
        step="cover"
        title="สร้างภาพปกละคร"
        hint={`ภาพปกแนวโปสเตอร์หนังพร้อมตัวละครหลัก ใช้เป็นภาพหน้าปกโพสต์${p.episodesTotal > 1 ? "ของทุกตอน" : ""}`}
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
  onRedoClip,
}: {
  p: DramaProject;
  busy: boolean;
  onRun: () => void;
  onRedo: (id: number) => void;
  onRedoClip: (id: number) => void;
}) {
  if (!p.shots.length) return <NeedScript episode={p.episodesTotal > 1 ? p.episode : undefined} />;
  const images = p.shots.filter((s) => s.imageStatus === "done").length;
  const clips = p.shots.filter((s) => s.clipStatus === "done" && s.clipUrl).length;
  const failed = p.shots.filter((s) => s.imageStatus === "failed" || s.clipStatus === "failed");
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {p.episodesTotal > 1 ? `ตอนที่ ${p.episode} · ` : ""}วิดีโอ H3 {clips}/{p.shots.length} ช็อต
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              (ภาพตั้งต้น {images}/{p.shots.length})
            </span>
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-rose-600 to-fuchsia-600 transition-all"
              style={{
                width: `${(clips / Math.max(1, p.shots.length)) * 100}%`,
              }}
            />
          </div>
        </div>
        {p.runningStep !== "storyboard" && (
          <Button onClick={onRun} disabled={busy || !!p.runTarget} className="bg-gradient-to-r from-rose-600 to-fuchsia-600 text-white">
            <Sparkles /> {clips || images ? "สร้างช็อตที่เหลือ" : "สร้างสตอรี่บอร์ด"}
          </Button>
        )}
      </Card>
      {failed.length > 0 && !p.runTarget && (
        <div role="alert" className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          ช็อต {failed.map((s) => s.seq).join(", ")} สร้างวิดีโอไม่สำเร็จหลังลอง 3 ครั้ง — แก้คำบรรยายภาพที่ขั้น 02 หรือกด &quot;สร้างคลิปใหม่&quot; ที่ช็อตนั้น
          (วิดีโอจะไม่ใช้ภาพนิ่งแทน)
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {p.shots.map((s) => {
          const bad = s.imageStatus === "failed" || s.clipStatus === "failed";
          const working = p.runningStep === "storyboard" && (p.runShotId ? s.id === p.runShotId : !bad && !(s.clipStatus === "done" && s.clipUrl));
          return (
            <div key={s.id} className={cn("overflow-hidden rounded-xl border bg-card", bad ? "border-danger/60" : "border-border")}>
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
                  <img src={s.imageUrl} alt="" className="size-full object-cover opacity-60" />
                ) : null}
                {working && (
                  <div className="absolute inset-0 grid place-items-center bg-black/40 text-center text-[11px] text-white">
                    <span className="flex flex-col items-center gap-1">
                      <Loader2 className="size-7 animate-spin" />
                      {s.imageStatus === "done" ? "กำลังทำวิดีโอ" : "กำลังทำภาพตั้งต้น"}
                    </span>
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-bold text-white tabular-nums">{s.seq}</span>
                {s.isProduct && (
                  <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-amber-400 px-1.5 py-0.5 text-[11px] font-semibold text-amber-950">
                    <ShoppingBag className="size-3" /> ไทอิน
                  </span>
                )}
                <span
                  className={cn(
                    "absolute right-2 top-2 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
                    s.clipUrl && s.clipStatus === "done" ? "bg-success text-white" : bad ? "bg-danger text-white" : "bg-white/85 text-slate-900",
                  )}
                >
                  {s.clipUrl && s.clipStatus === "done" ? "วิดีโอ ✓" : bad ? "ไม่สำเร็จ" : s.clipStatus === "processing" ? "กำลังทำ" : "รอวิดีโอ"}
                </span>
              </div>
              <div className="space-y-1.5 p-2">
                <p className="line-clamp-2 text-xs text-muted-foreground">{s.narration || s.dialogue[0]?.line || s.scene}</p>
                {s.error && (bad || s.clipAttempts > 0) && <p className="line-clamp-3 text-[11px] text-danger">{s.error}</p>}
                {bad && s.imageStatus === "done" && (
                  <Button variant="outline" size="sm" className="h-7 w-full text-xs" disabled={busy || !!p.runTarget} onClick={() => onRedoClip(s.id)}>
                    <Film /> สร้างคลิปใหม่
                  </Button>
                )}
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

const minutes = (sec: number | null) => (sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : "–");

function ExportStep({
  p,
  busy,
  onRun,
  onRevoice,
  onPick,
}: {
  p: DramaProject;
  busy: boolean;
  onRun: () => void;
  onRevoice: () => void;
  onPick: (n: number) => void;
}) {
  const series = p.episodesTotal > 1;
  const e = p.episodes.find((x) => x.no === p.episode);
  const table = series ? <EpisodeTable p={p} onPick={onPick} /> : null;
  if (!p.shots.length) {
    return (
      <div className="space-y-4">
        <NeedScript episode={series ? p.episode : undefined} />
        {table}
      </div>
    );
  }
  const voiced = p.shots.filter((s) => s.audioStatus === "done").length;
  if (!p.outputUrl) {
    return (
      <div className="space-y-4">
        <StepCta
          p={p}
          step="export"
          title={series ? `พากย์เสียงและรวมตอนที่ ${p.episode}` : "พากย์เสียงและรวมเป็นวิดีโอ"}
          hint={`ผู้บรรยายและตัวละครพากย์ทีละช็อต (${voiced}/${p.shots.length}) แล้วรวมคลิปวิดีโอทุกช็อต คำบรรยาย และเพลงเป็นไฟล์ MP4 แนวตั้ง`}
          action={series ? `รวมตอนที่ ${p.episode}` : "พากย์เสียงและรวมวิดีโอ"}
          busy={busy}
          onRun={onRun}
        />
        {table}
      </div>
    );
  }
  const name = series ? `${p.title} ตอนที่ ${p.episode}` : p.title;
  return (
    <div className="space-y-4">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <div className="mx-auto w-full max-w-xs self-start overflow-hidden rounded-2xl bg-black shadow-2xl">
          <video key={p.outputUrl} src={p.outputUrl} poster={p.coverUrl ?? undefined} controls playsInline className="aspect-[9/16] w-full object-contain" />
        </div>
        <div className="space-y-4">
          <Card className="space-y-3 p-4">
            <p className="text-lg font-semibold">
              {p.title}
              {series && (
                <span className="ml-2 text-base font-normal text-muted-foreground">
                  ตอนที่ {p.episode}/{p.episodesTotal}
                  {e?.title ? ` · ${e.title}` : ""}
                </span>
              )}
            </p>
            <p className="text-sm text-muted-foreground">
              {p.durationSec ? `${minutes(p.durationSec)} นาที · ` : ""}
              {p.shots.length} ช็อตวิดีโอ · 9:16
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={p.outputUrl}
                download={`${name}.mp4`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
              >
                <Download className="size-4" /> ดาวน์โหลด MP4
              </a>
              {p.hasSubtitles && (
                <Button
                  variant="outline"
                  onClick={() =>
                    void apiDownload(
                      `/drama/${p.id}/subtitles.srt?episode=${p.episode}`,
                      undefined,
                      series ? `drama-${p.id}-ep${p.episode}.srt` : `drama-${p.id}.srt`,
                    )
                  }
                >
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
                <RefreshCw /> พากย์ใหม่ทั้ง{series ? "ตอน" : "เรื่อง"}
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
      {table}
    </div>
  );
}

const STATUS_LABEL: Record<
  DramaEpisode["status"],
  {
    text: string;
    tone: "neutral" | "warning" | "primary" | "danger" | "success";
  }
> = {
  todo: { text: "ยังไม่เริ่ม", tone: "neutral" },
  progress: { text: "กำลังทำ", tone: "warning" },
  running: { text: "กำลังสร้าง", tone: "primary" },
  failed: { text: "ติดปัญหา", tone: "danger" },
  done: { text: "เสร็จแล้ว", tone: "success" },
};

/** Every episode of the series with its video. */
function EpisodeTable({ p, onPick }: { p: DramaProject; onPick: (n: number) => void }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border p-4">
        <Layers className="size-4 text-rose-600" />
        <p className="flex-1 font-semibold">ทุกตอน</p>
        <span className="text-xs text-muted-foreground">
          เสร็จ {p.episodes.filter((e) => e.status === "done").length}/{p.episodesTotal}
        </span>
      </div>
      <ul className="divide-y divide-border">
        {p.episodes.map((e) => {
          const st = STATUS_LABEL[e.status];
          return (
            <li key={e.no} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", e.no === p.episode && "bg-rose-600/5")}>
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-sm font-bold tabular-nums">{e.no}</span>
              <button type="button" onClick={() => onPick(e.no)} className="min-w-[9rem] flex-1 text-left">
                <p className="truncate font-medium hover:underline">{e.title ?? `ตอนที่ ${e.no}`}</p>
                <p className="text-xs text-muted-foreground">
                  {e.shots ? `วิดีโอ ${e.clipsDone}/${e.shots} ช็อต` : "ยังไม่มีบท"}
                  {e.durationSec ? ` · ${minutes(e.durationSec)} นาที` : ""}
                </p>
              </button>
              <Badge tone={st.tone}>{st.text}</Badge>
              {e.outputUrl && (
                <a
                  href={e.outputUrl}
                  download={`${p.title} ตอนที่ ${e.no}.mp4`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium hover:bg-accent"
                >
                  <Download className="size-3.5" /> MP4
                </a>
              )}
              {e.hasSubtitles && e.outputUrl && (
                <button
                  type="button"
                  onClick={() => void apiDownload(`/drama/${p.id}/subtitles.srt?episode=${e.no}`, undefined, `drama-${p.id}-ep${e.no}.srt`)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium hover:bg-accent"
                >
                  .srt
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
