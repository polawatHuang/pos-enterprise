"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Film, ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api, apiBlob, apiFetch } from "@/lib/api";
import type { VideoMedia } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@/components/ui/primitives";

const ACCEPT = "video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp";
const MAX_FILES = 10;
const MAX_VIDEO_MB = 60;

/** Read a clip's length in the browser (the renderer needs it to pick different moments). */
function videoDurationMs(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : null);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    el.src = url;
  });
}

function Preview({ m }: { m: VideoMedia }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    apiBlob(m.url)
      .then((b) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(b);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [m.url]);
  if (!url) return <div className="size-full animate-pulse bg-muted" />;
  return m.kind === "video" ? (
    <video src={url} muted playsInline preload="metadata" className="size-full object-cover" />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- blob URL of an authenticated upload
    <img src={url} alt={m.label ?? ""} className="size-full object-cover" />
  );
}

export function MediaPanel({ projectId, media, locked, highlight }: { projectId: number; media: VideoMedia[]; locked: boolean; highlight: boolean }) {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState<string | null>(null);
  const [labels, setLabels] = useState<Record<number, string>>({});
  const refresh = () => qc.invalidateQueries({ queryKey: ["videos", "detail", projectId] });

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, MAX_FILES - media.length);
    if (!list.length) return toast.error(`อัปโหลดได้สูงสุด ${MAX_FILES} ไฟล์`);
    for (const [i, file] of list.entries()) {
      if (!ACCEPT.split(",").includes(file.type)) {
        toast.error(`${file.name}: รองรับ MP4/MOV/WebM และ JPG/PNG/WebP`);
        continue;
      }
      if (file.type.startsWith("video/") && file.size > MAX_VIDEO_MB * 1024 * 1024) {
        toast.error(`${file.name}: คลิปใหญ่เกิน ${MAX_VIDEO_MB} MB — ตัดให้สั้นลง (แนะนำ 3–15 วินาทีต่อคลิป)`);
        continue;
      }
      setUploading(`กำลังอัปโหลด ${i + 1}/${list.length}`);
      try {
        const durationMs = file.type.startsWith("video/") ? await videoDurationMs(file) : null;
        await apiFetch(`/videos/${projectId}/media`, {
          method: "POST",
          body: file,
          headers: { "Content-Type": file.type },
          query: { label: file.name.replace(/\.[^.]+$/, "").slice(0, 100), durationMs: durationMs ?? undefined },
        });
      } catch (err) {
        toast.error(`${file.name}: ${err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ"}`);
      }
    }
    setUploading(null);
    await refresh();
  };

  const saveLabel = async (m: VideoMedia) => {
    const label = labels[m.id];
    if (label === undefined || label === (m.label ?? "")) return;
    try {
      await api.patch(`/videos/${projectId}/media/${m.id}`, { label: label.trim() || null });
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    }
  };

  const remove = async (m: VideoMedia) => {
    if (!window.confirm("ลบไฟล์นี้?")) return;
    try {
      await api.del(`/videos/${projectId}/media/${m.id}`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
    }
  };

  return (
    <Card className={cn(highlight && !media.length && "border-primary")}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">ฟุตเทจของฉัน ({media.length}/{MAX_FILES})</CardTitle>
        <CardDescription>
          ถ่ายสินค้าจริงสั้นๆ คลิปละ 3–15 วินาที เช่น แกะกล่อง ถือโชว์ ใช้งานจริง แล้วตั้งชื่อว่าคลิปเป็นภาพอะไร — AI จะเลือกใช้ให้ตรงกับแต่ละฉากเมื่อกด &quot;เขียนใหม่ด้วย AI&quot;
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {media.length > 0 && (
          <ul className="grid gap-2 sm:grid-cols-2">
            {media.map((m, i) => (
              <li key={m.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
                <span className="relative size-14 shrink-0 overflow-hidden rounded-md bg-muted">
                  <Preview m={m} />
                  <span className="absolute left-0.5 top-0.5 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">{i + 1}</span>
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    {m.kind === "video" ? <Film className="size-3" /> : <ImageIcon className="size-3" />}
                    {m.kind === "video" ? `คลิป${m.durationMs ? ` ${(m.durationMs / 1000).toFixed(1)} วิ` : ""}` : "รูป"} · {(m.sizeBytes / 1024 / 1024).toFixed(1)} MB
                  </p>
                  <Input
                    value={labels[m.id] ?? m.label ?? ""}
                    onChange={(e) => setLabels((l) => ({ ...l, [m.id]: e.target.value }))}
                    onBlur={() => void saveLabel(m)}
                    disabled={locked}
                    maxLength={100}
                    placeholder="เป็นภาพอะไร เช่น แกะกล่อง"
                    aria-label={`ชื่อฟุตเทจ ${i + 1}`}
                    className="h-8 text-xs"
                  />
                </div>
                <Button size="sm" variant="ghost" disabled={locked} onClick={() => void remove(m)} aria-label={`ลบฟุตเทจ ${i + 1}`}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {!locked && media.length < MAX_FILES && (
          <label
            className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground hover:bg-accent"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void upload(e.dataTransfer.files);
            }}
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {uploading ?? "อัปโหลดคลิป/รูป (ลากมาวางได้ เลือกหลายไฟล์ได้)"}
            <input type="file" accept={ACCEPT} multiple className="sr-only" disabled={uploading !== null} onChange={(e) => void upload(e.target.files).then(() => (e.target.value = ""))} />
          </label>
        )}
      </CardContent>
    </Card>
  );
}
