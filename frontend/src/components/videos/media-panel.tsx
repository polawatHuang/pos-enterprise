"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Film, ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api, apiBlob, ApiError } from "@/lib/api";
import type { VideoMedia } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@/components/ui/primitives";
import { isUnreadable, readFilesNow, UNREADABLE_HELP } from "@/lib/files";

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

const MIN_CHUNK = 64 * 1024;
const toBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/**
 * Send a file as small JSON requests and let the server put it back together. Shared hosting
 * (Apache + ModSecurity + Passenger) can drop a large upload body before it reaches the app, while
 * small JSON requests always get through. A failed chunk is retried, then resent in smaller pieces.
 */
async function uploadInChunks(projectId: number, file: File, meta: { label: string; durationMs: number | null }, onProgress: (pct: number) => void) {
  const base = `/videos/${projectId}/media/uploads`;
  const start = await api.post<{ uploadId: string; chunkSize: number }>(base, {
    mime: file.type,
    size: file.size,
    label: meta.label,
    durationMs: meta.durationMs ?? undefined,
  });
  let chunk = start.chunkSize;
  let offset = 0;
  let failures = 0;
  while (offset < file.size) {
    const end = Math.min(offset + chunk, file.size);
    try {
      const r = await api.put<{ received: number }>(`${base}/${start.uploadId}`, { offset, data: await toBase64(file.slice(offset, end)) });
      offset = r.received;
      failures = 0;
      onProgress(Math.floor((offset / file.size) * 100));
    } catch (err) {
      // The server already holds more or fewer bytes than we thought: continue from its count
      if (err instanceof ApiError && err.status === 409 && typeof (err.details as { received?: number })?.received === "number") {
        offset = (err.details as { received: number }).received;
        continue;
      }
      const retriable = !(err instanceof ApiError) || err.status === 0 || err.status >= 500;
      if (!retriable) throw err;
      failures += 1;
      if (failures > 2 && chunk > MIN_CHUNK) {
        chunk = Math.max(MIN_CHUNK, Math.floor(chunk / 2));
        failures = 0;
      } else if (failures > 2) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500 * failures));
    }
  }
  await api.post(`${base}/${start.uploadId}/complete`);
}

export function MediaPanel({ projectId, media, locked, highlight }: { projectId: number; media: VideoMedia[]; locked: boolean; highlight: boolean }) {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState<string | null>(null);
  const [labels, setLabels] = useState<Record<number, string>>({});
  const refresh = () => qc.invalidateQueries({ queryKey: ["videos", "detail", projectId] });

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const picked = Array.from(files).slice(0, MAX_FILES - media.length);
    if (!picked.length) return toast.error(`อัปโหลดได้สูงสุด ${MAX_FILES} ไฟล์`);
    // Read the bytes now, before the input is disabled/re-rendered (Safari may refuse a late read)
    const list = await readFilesNow(picked, (f, err) => toast.error(`${f.name}: ${isUnreadable(err) ? UNREADABLE_HELP : "อ่านไฟล์ไม่สำเร็จ"}`));
    for (const [i, file] of list.entries()) {
      if (!ACCEPT.split(",").includes(file.type)) {
        toast.error(`${file.name}: รองรับ MP4/MOV/WebM และ JPG/PNG/WebP`);
        continue;
      }
      if (file.type.startsWith("video/") && file.size > MAX_VIDEO_MB * 1024 * 1024) {
        toast.error(`${file.name}: คลิปใหญ่เกิน ${MAX_VIDEO_MB} MB — ตัดให้สั้นลง (แนะนำ 3–15 วินาทีต่อคลิป)`);
        continue;
      }
      const prefix = `กำลังอัปโหลด ${i + 1}/${list.length}`;
      setUploading(prefix);
      try {
        const durationMs = file.type.startsWith("video/") ? await videoDurationMs(file) : null;
        await uploadInChunks(projectId, file, { label: file.name.replace(/\.[^.]+$/, "").slice(0, 100), durationMs }, (pct) =>
          setUploading(`${prefix} · ${pct}%`),
        );
      } catch (err) {
        // status 0: the request never got an answer from the app (connection dropped or a firewall refused the file)
        const message =
          err instanceof ApiError && err.status === 0
            ? `อัปโหลดไม่ผ่าน (${(file.size / 1024 / 1024).toFixed(1)} MB) — การเชื่อมต่อหลุดหรือไฟร์วอลล์ของเซิร์ฟเวอร์ปฏิเสธไฟล์ ลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้ดู Plesk Logs`
            : err instanceof Error
              ? err.message
              : "อัปโหลดไม่สำเร็จ";
        toast.error(`${file.name}: ${message}`);
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
