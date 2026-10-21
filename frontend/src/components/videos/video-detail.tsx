"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Clapperboard,
  Download,
  Film,
  Loader2,
  Mic,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { CaptionStyle, CoverProject, VideoDetail, VideoScene, VideoVisualMode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardHeader, CardTitle, Input, Label, NativeSelect, Skeleton, Textarea } from "@/components/ui/primitives";
import { CAPTION_STYLES, IN_PROGRESS, steps, VIDEO_STATUS, VISUAL_MODES } from "./labels";
import { MediaPanel } from "./media-panel";
import { useVideoMeta } from "./videos-view";

export function VideoDetailView({ id }: { id: number }) {
  const detail = useQuery({
    queryKey: ["videos", "detail", id],
    queryFn: () => api.get<VideoDetail>(`/videos/${id}`),
    refetchInterval: (q) => (q.state.data && IN_PROGRESS.includes(q.state.data.status) ? 4000 : false),
  });
  if (detail.isError) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        {detail.error instanceof Error ? detail.error.message : "โหลดไม่สำเร็จ"} ·{" "}
        <Link href="/videos" className="text-primary underline">
          กลับ
        </Link>
      </div>
    );
  }
  if (!detail.data) return <Skeleton className="h-96" />;
  // Re-mount the editor whenever the server copy changes outside the editor (AI rewrite, generation)
  return <Editor key={`${detail.data.id}-${detail.data.updatedAt}-${detail.data.status}`} v={detail.data} />;
}

function Editor({ v }: { v: VideoDetail }) {
  const router = useRouter();
  const qc = useQueryClient();
  const meta = useVideoMeta();
  const [title, setTitle] = useState(v.title);
  const [scenes, setScenes] = useState<VideoScene[]>(v.scenes);
  const [postCaption, setPostCaption] = useState(v.postCaption ?? "");
  const [hashtags, setHashtags] = useState(v.hashtags ?? "");
  const [visualMode, setVisualMode] = useState<VideoVisualMode>(v.visualMode);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(v.captionStyle);
  const [coverId, setCoverId] = useState<number | null>(v.coverId);
  const covers = useQuery({ queryKey: ["covers"], queryFn: () => api.get<CoverProject[]>("/covers") });
  const portraitCovers = (covers.data ?? []).filter((c) => c.orientation === "portrait" && c.status === "ready");
  const [voiceProvider, setVoiceProvider] = useState(v.voiceProvider);
  const [voiceId, setVoiceId] = useState(v.voiceId ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const locked = IN_PROGRESS.includes(v.status);
  const dirty =
    title !== v.title ||
    JSON.stringify(scenes) !== JSON.stringify(v.scenes) ||
    postCaption !== (v.postCaption ?? "") ||
    hashtags !== (v.hashtags ?? "") ||
    visualMode !== v.visualMode ||
    captionStyle !== v.captionStyle ||
    coverId !== v.coverId ||
    voiceProvider !== v.voiceProvider ||
    voiceId !== (v.voiceId ?? "");
  const total = scenes.reduce((n, s) => n + (Number(s.durationSec) || 0), 0);
  const caps = meta.data?.capabilities;

  const refresh = () => qc.invalidateQueries({ queryKey: ["videos"] });
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "INTEGRATION_NOT_CONFIGURED") toast.error(`ยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์: ${err.message}`);
      else toast.error(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };
  const save = () =>
    api.put(`/videos/${v.id}`, {
      title,
      scenes: scenes.map((s) => ({ ...s, durationSec: Number(s.durationSec) || 4 })),
      postCaption: postCaption || null,
      hashtags: hashtags || null,
      visualMode,
      captionStyle,
      coverId,
      voiceProvider,
      voiceId: voiceId || null,
    });
  const update = (i: number, patch: Partial<VideoScene>) => setScenes((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) =>
    setScenes((list) => {
      const next = [...list];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });

  const generate = () =>
    run(
      "gen",
      async () => {
        if (dirty) await save();
        await api.post(`/videos/${v.id}/generate`);
      },
      "เริ่มสร้างวิดีโอแล้ว ระบบทำงานเบื้องหลัง ปิดหน้านี้ได้",
    );

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link href="/videos" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> AI Video
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{v.title}</h1>
            <Badge tone={VIDEO_STATUS[v.status].tone}>
              {locked && <Loader2 className="size-3 animate-spin" />}
              {VIDEO_STATUS[v.status].label}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {v.productName ?? (v.trendId ? `สินค้าเทรนด์ #${v.trendId}` : "")} · {scenes.length} ฉาก · ประมาณ {total} วินาที
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={locked || busy !== null}
            onClick={() => {
              if (v.scenes.length && !window.confirm("ให้ AI เขียนสคริปต์ใหม่ทั้งหมด? (ที่แก้ไว้จะหาย)")) return;
              void run("ai", () => api.post(`/videos/${v.id}/script`, {}), "AI เขียนสคริปต์ใหม่แล้ว");
            }}
          >
            {busy === "ai" ? <Loader2 className="animate-spin" /> : <Wand2 />} เขียนใหม่ด้วย AI
          </Button>
          <Button variant="outline" disabled={locked || !dirty || busy !== null} onClick={() => void run("save", save, "บันทึกแล้ว")}>
            {busy === "save" ? <Loader2 className="animate-spin" /> : <Save />} บันทึก
          </Button>
          <Button
            variant="ghost"
            disabled={locked || busy !== null}
            aria-label="ลบโปรเจกต์"
            onClick={() => {
              if (!window.confirm("ลบโปรเจกต์วิดีโอนี้?")) return;
              void run("del", async () => {
                await api.del(`/videos/${v.id}`);
                router.push("/videos");
              });
            }}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {v.status === "draft" && v.error && (
            <p className="flex gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> AI เขียนสคริปต์ไม่สำเร็จ: {v.error}
            </p>
          )}
          <Card>
            <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="vt">ชื่อโปรเจกต์</Label>
                <Input id="vt" value={title} onChange={(e) => setTitle(e.target.value)} disabled={locked} maxLength={200} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="vm">ภาพในคลิป</Label>
                <NativeSelect id="vm" value={visualMode} onChange={(e) => setVisualMode(e.target.value as VideoVisualMode)} disabled={locked}>
                  {VISUAL_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.title}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="vcs">ซับ</Label>
                <NativeSelect id="vcs" value={captionStyle} onChange={(e) => setCaptionStyle(e.target.value as CaptionStyle)} disabled={locked}>
                  {CAPTION_STYLES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="vcover">ปกเป็นเฟรมแรก</Label>
                <NativeSelect id="vcover" value={coverId ?? ""} onChange={(e) => setCoverId(e.target.value ? Number(e.target.value) : null)} disabled={locked}>
                  <option value="">ไม่ใช้ปก</option>
                  {portraitCovers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.headline}
                    </option>
                  ))}
                </NativeSelect>
                {!portraitCovers.length && (
                  <Link href="/covers" className="text-[11px] text-primary hover:underline">
                    สร้างปกแนวตั้งที่หน้า AI ปกคลิป
                  </Link>
                )}
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="vp">เสียงพากย์</Label>
                <div className="flex gap-2">
                  <NativeSelect id="vp" value={voiceProvider} onChange={(e) => setVoiceProvider(e.target.value as typeof voiceProvider)} disabled={locked} className="w-auto">
                    <option value="minimax">MiniMax</option>
                    <option value="elevenlabs">ElevenLabs</option>
                  </NativeSelect>
                  <Input
                    value={voiceId}
                    onChange={(e) => setVoiceId(e.target.value)}
                    disabled={locked}
                    placeholder={caps?.voice[voiceProvider].defaultVoiceId ?? "voice id"}
                    aria-label="Voice ID"
                    maxLength={100}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <MediaPanel projectId={v.id} media={v.media} locked={locked} highlight={visualMode === "my_footage"} />

          {v.hooks.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Hook 3 แบบ</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {v.hooks.map((h, i) => {
                  const current = scenes[0]?.voiceover === h.voiceover;
                  return (
                    <div key={i} className={cn("flex flex-wrap items-center gap-2 rounded-lg border p-2.5 text-sm", current ? "border-primary bg-primary-soft/40" : "border-border")}>
                      <Badge tone={current ? "primary" : "neutral"}>{h.angle || `แบบ ${i + 1}`}</Badge>
                      <span className="min-w-0 flex-1">
                        &quot;{h.voiceover}&quot; <span className="text-xs text-muted-foreground">· {h.caption}</span>
                      </span>
                      {current ? (
                        <span className="text-xs font-medium text-primary">ใช้อยู่</span>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={locked || busy !== null}
                            onClick={() => void run(`hook${i}`, () => api.post(`/videos/${v.id}/hook`, { index: i }), "เปลี่ยน hook แล้ว")}
                          >
                            ใช้ hook นี้
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy !== null}
                            onClick={() =>
                              void run(`var${i}`, async () => {
                                const r = await api.post<{ id: number }>(`/videos/${v.id}/variant`, { hookIndex: i });
                                router.push(`/videos/${r.id}`);
                              }, "สร้างอีกเวอร์ชันแล้ว — ใช้ทดสอบว่า hook ไหนได้ผลดีกว่า")
                            }
                          >
                            ทำอีกเวอร์ชัน
                          </Button>
                        </>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {scenes.map((s, i) => (
            <Card key={i} className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{i + 1}</span>
                <span className="text-sm font-medium">{i === 0 ? "Hook" : i === scenes.length - 1 ? "ปิดการขาย (CTA)" : `ฉาก ${i + 1}`}</span>
                <div className="ml-auto flex items-center gap-1">
                  <Input
                    type="number"
                    min={2}
                    max={10}
                    value={s.durationSec}
                    onChange={(e) => update(i, { durationSec: Number(e.target.value) })}
                    disabled={locked}
                    className="h-8 w-16 text-xs"
                    aria-label={`ความยาวฉาก ${i + 1} (วินาที)`}
                  />
                  <span className="text-xs text-muted-foreground">วิ</span>
                  <Button size="sm" variant="ghost" disabled={locked || i === 0} onClick={() => move(i, -1)} aria-label="เลื่อนขึ้น">
                    <ArrowUp />
                  </Button>
                  <Button size="sm" variant="ghost" disabled={locked || i === scenes.length - 1} onClick={() => move(i, 1)} aria-label="เลื่อนลง">
                    <ArrowDown />
                  </Button>
                  <Button size="sm" variant="ghost" disabled={locked || scenes.length <= 1} onClick={() => setScenes(scenes.filter((_, j) => j !== i))} aria-label="ลบฉาก">
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor={`vo-${i}`} className="flex items-center gap-1">
                    <Mic className="size-3.5" /> บทพากย์
                  </Label>
                  <Textarea id={`vo-${i}`} value={s.voiceover} onChange={(e) => update(i, { voiceover: e.target.value })} disabled={locked} rows={2} maxLength={500} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`cap-${i}`}>ข้อความบนจอ</Label>
                  <Input id={`cap-${i}`} value={s.caption} onChange={(e) => update(i, { caption: e.target.value })} disabled={locked} maxLength={80} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`vis-${i}`}>ภาพ (prompt ภาษาอังกฤษ)</Label>
                  <Input id={`vis-${i}`} value={s.visual} onChange={(e) => update(i, { visual: e.target.value })} disabled={locked || visualMode !== "ai_clips"} maxLength={600} />
                </div>
              </div>
              {visualMode === "my_footage" && v.media.length > 0 && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <Label htmlFor={`med-${i}`} className="text-xs text-muted-foreground">
                    ฟุตเทจเปิดฉาก
                  </Label>
                  <NativeSelect
                    id={`med-${i}`}
                    value={s.media ?? ""}
                    onChange={(e) => update(i, { media: e.target.value ? Number(e.target.value) : null })}
                    disabled={locked}
                    className="h-8 w-auto text-xs"
                  >
                    <option value="">อัตโนมัติ</option>
                    {v.media.map((m, j) => (
                      <option key={m.id} value={j + 1}>
                        {j + 1}. {m.label || (m.kind === "video" ? "คลิป" : "รูป")}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}
              {visualMode === "ai_clips" && (
                <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={s.showProduct} onChange={(e) => update(i, { showProduct: e.target.checked })} disabled={locked} className="size-4 accent-primary" />
                  ใช้รูปสินค้าเป็นเฟรมแรกของคลิปนี้
                </label>
              )}
            </Card>
          ))}
          {!locked && scenes.length < 8 && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setScenes([...scenes, { voiceover: "", caption: "", visual: "", showProduct: false, durationSec: 4 }])}
            >
              <Plus /> เพิ่มฉาก
            </Button>
          )}

          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="pc">แคปชันโพสต์</Label>
                <Textarea id="pc" value={postCaption} onChange={(e) => setPostCaption(e.target.value)} disabled={locked} rows={2} maxLength={2000} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ht">แฮชแท็ก</Label>
                <Input id="ht" value={hashtags} onChange={(e) => setHashtags(e.target.value)} disabled={locked} maxLength={500} />
              </div>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Progress v={v} visualMode={visualMode} />
          <Card>
            <CardContent className="space-y-3 p-4 text-sm">
              {caps && <Readiness caps={caps} visualMode={visualMode} voiceProvider={voiceProvider} needsPublic={visualMode === "my_footage" || coverId !== null} />}
              <Button className="w-full" disabled={locked || busy !== null || !scenes.length || scenes.some((s) => !s.voiceover.trim())} onClick={() => void generate()}>
                {busy === "gen" || locked ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {v.status === "ready" || v.status === "parts_ready" ? "สร้างวิดีโอใหม่" : "สร้างวิดีโอ"}
              </Button>
              <p className="text-xs text-muted-foreground">
                ใช้เสียงพากย์ {scenes.length} ช่วง ({scenes.reduce((n, s) => n + s.voiceover.length, 0)} ตัวอักษร)
                {visualMode === "ai_clips" ? ` และคลิป AI ${scenes.length} คลิป (มีค่าใช้จ่ายต่อคลิป)` : ""} — ระบบมีป้าย &quot;สร้างด้วย AI&quot; ในคลิปตามข้อกำหนดของแพลตฟอร์ม
                {visualMode === "my_footage" ? " · ฟุตเทจจริงช่วยให้คลิปดูน่าเชื่อถือ และไม่ติดข้อห้ามคอนเทนต์ AI ล้วน" : ""}
              </p>
            </CardContent>
          </Card>
          <Outputs v={v} />
        </aside>
      </div>
    </div>
  );
}

function Readiness({
  caps,
  visualMode,
  voiceProvider,
  needsPublic,
}: {
  caps: NonNullable<ReturnType<typeof useVideoMeta>["data"]>["capabilities"];
  visualMode: string;
  voiceProvider: "minimax" | "elevenlabs";
  needsPublic: boolean;
}) {
  const rows = [
    ...(needsPublic && caps.publicMedia
      ? [{ label: "ลิงก์ฟุตเทจ/ปกให้ระบบตัดต่อ", ok: caps.publicMedia.configured, missing: caps.publicMedia.missing, required: visualMode === "my_footage", note: "โดเมน HTTPS ของ backend" }]
      : []),
    { label: "เสียงพากย์", ok: caps.voice[voiceProvider].configured, missing: caps.voice[voiceProvider].missing, required: true },
    ...(visualMode === "ai_clips" ? [{ label: "คลิป AI", ok: caps.clips.configured, missing: caps.clips.missing, required: true }] : []),
    { label: "ประกอบคลิป (Shotstack)", ok: caps.compose.configured, missing: caps.compose.missing, required: false, note: "ถ้าไม่มี จะได้ชิ้นส่วนไปตัดต่อเอง" },
    { label: "เก็บไฟล์ถาวร (R2)", ok: caps.storage.configured, missing: caps.storage.missing, required: false, note: "ถ้าไม่มี ลิงก์ไฟล์หมดอายุใน ~24 ชม." },
  ];
  return (
    <ul className="space-y-1.5 text-xs">
      {rows.map((r) => (
        <li key={r.label} className="flex items-start gap-2">
          {r.ok ? <Check className="mt-0.5 size-3.5 shrink-0 text-success" /> : <AlertTriangle className={cn("mt-0.5 size-3.5 shrink-0", r.required ? "text-danger" : "text-warning")} />}
          <span>
            <span className="font-medium">{r.label}</span>
            {!r.ok && <span className="text-muted-foreground"> — ต้องตั้ง {r.missing.join(", ")}{r.note ? ` (${r.note})` : ""}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Progress({ v, visualMode }: { v: VideoDetail; visualMode: VideoVisualMode }) {
  const list = steps(visualMode);
  const current = list.findIndex((s) => s.statuses.includes(v.status));
  const failed = v.status === "failed";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">ความคืบหน้า</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <ol className="flex items-center gap-1">
          {list.map((s, i) => {
            const done = current > i || (current === i && (s.key === "done" || s.key === "script"));
            const active = current === i && !done;
            return (
              <li key={s.key} className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-full text-[10px] font-semibold",
                    done ? "bg-success text-white" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  {done ? <Check className="size-3.5" /> : active ? <Loader2 className="size-3.5 animate-spin" /> : i + 1}
                </span>
                <span className="truncate text-[10px] text-muted-foreground">{s.label}</span>
              </li>
            );
          })}
        </ol>
        {v.stageDetail && <p className="text-xs text-muted-foreground">{v.stageDetail}</p>}
        {v.queue?.stalled && (
          <div className="flex gap-1.5 rounded-lg bg-warning-soft px-2.5 py-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              ตัวประมวลผลงานเบื้องหลังไม่ทำงาน — งานรอมา {Math.round(v.queue.waitingSec / 60)} นาทีแล้ว ยังไม่มีใครเริ่ม ให้ตรวจ Plesk → Scheduled Tasks ว่ามีงานเรียก{" "}
              <code className="font-mono">/internal/cron/tick</code> ทุก 1 นาที และรันสำเร็จ (คู่มือ DEPLOY_PLESK ขั้นที่ 5)
            </span>
          </div>
        )}
        {failed && v.error && (
          <p className="flex gap-1.5 rounded-lg bg-danger-soft px-2.5 py-2 text-xs text-danger">
            <AlertTriangle className="size-3.5 shrink-0" /> {v.error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Outputs({ v }: { v: VideoDetail }) {
  const voices = v.assets.filter((a) => a.kind === "voice" && a.url);
  const clips = v.assets.filter((a) => a.kind === "broll");
  if (!v.outputUrl && !voices.length && !clips.length && !v.hasSubtitles) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">ไฟล์ผลลัพธ์</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0 text-sm">
        {v.outputUrl ? (
          <>
            <Button asChild className="w-full">
              <Link href={`/social?video=${v.id}`}>
                <Send /> ตั้งเวลาโพสต์คลิปนี้
              </Link>
            </Button>
            <video src={v.outputUrl} controls playsInline className="mx-auto aspect-[9/16] w-full max-w-[240px] rounded-lg bg-black" />
            <Button asChild variant="outline" className="w-full">
              <a href={v.outputUrl} target="_blank" rel="noreferrer noopener" download>
                <Download /> ดาวน์โหลด MP4
              </a>
            </Button>
          </>
        ) : v.status === "ready" ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clapperboard className="size-4" /> ข้อมูลเดโม — ไม่มีไฟล์วิดีโอจริง
          </p>
        ) : null}
        {v.hasSubtitles && (
          <Button asChild variant="outline" className="w-full">
            <a href={`/api/videos/${v.id}/subtitles.srt`} download>
              <Download /> ไฟล์ซับ (.srt)
            </a>
          </Button>
        )}
        {voices.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">เสียงพากย์</p>
            {voices.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-xs text-muted-foreground">ฉาก {(a.sceneIndex ?? 0) + 1}</span>
                <audio src={a.url ?? undefined} controls preload="none" className="h-8 w-full min-w-0" />
              </div>
            ))}
          </div>
        )}
        {clips.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">คลิป AI</p>
            {clips.map((a) => (
              <p key={a.id} className="flex items-center gap-2 text-xs">
                <Film className="size-3.5 shrink-0" /> ฉาก {(a.sceneIndex ?? 0) + 1}:{" "}
                {a.status === "ready" && a.url ? (
                  <a href={a.url} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
                    เปิดคลิป
                  </a>
                ) : a.status === "failed" ? (
                  <span className="text-warning">ไม่สำเร็จ (ใช้รูปสินค้าแทน)</span>
                ) : (
                  <span className="text-muted-foreground">กำลังสร้าง…</span>
                )}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
