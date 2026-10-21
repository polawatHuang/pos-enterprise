"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, RectangleHorizontal, RectangleVertical, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { api, apiBlob, ApiError } from "@/lib/api";
import type { CoverOrientation, CoverProject } from "@/lib/types";
import { downscaleToDataUrl } from "@/lib/image";
import { cn, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardHeader, CardTitle, Input, Label, Skeleton } from "@/components/ui/primitives";
import { PageHeader } from "@/components/layout/page";

export const STYLE_PRESETS = ["ป๊อปสดใส", "มินิมอล", "หรูหรา", "สตรีทแฟชั่น", "น่ารักพาสเทล", "ลดราคาแรง", "นีออนกลางคืน", "ธรรมชาติอบอุ่น"];
const MAX_SIDE = 1600;

export const coverErrorText = (err: unknown) =>
  err instanceof ApiError && err.code === "INTEGRATION_NOT_CONFIGURED" ? `ยังไม่ได้ตั้งค่า MiniMax บนเซิร์ฟเวอร์: ${err.message}` : err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ";

/** Downscale in the browser (≤1600px) so uploads stay small; PNG keeps transparency for cut-out products. */
const fileToDataUrl = (file: File) =>
  downscaleToDataUrl(file, { maxSide: MAX_SIDE, type: file.type === "image/png" ? "png" : "jpeg", quality: 0.88 });

/** Thumbnail from an auth-protected API image URL. */
export function ApiImage({ src, alt = "", className }: { src: string; alt?: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    apiBlob(src)
      .then((b) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(b);
        setUrl(objectUrl);
      })
      .catch(() => setUrl(null));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);
  // eslint-disable-next-line @next/next/no-img-element -- blob URL of an authenticated API image
  return url ? <img src={url} alt={alt} className={className} /> : <div className={cn("animate-pulse bg-muted", className)} />;
}

export function CoversView() {
  const covers = useQuery({
    queryKey: ["covers"],
    queryFn: () => api.get<CoverProject[]>("/covers"),
    refetchInterval: (q) => (q.state.data?.some((c) => c.status === "generating") ? 4000 : false),
  });
  return (
    <div className="space-y-6">
      <PageHeader title="AI ปกคลิป" description="บอก style และข้อความ แนบรูปถ้ามี แล้วให้ AI สร้างปกคลิปแนวตั้งหรือแนวนอน — ตัวหนังสือไทยระบบวางให้ สะกดถูกและแก้ได้ทุกเมื่อ" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
        <CreateForm />
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>ปกที่สร้างไว้</CardTitle>
          </CardHeader>
          <CardContent>
            {covers.isPending ? (
              <Skeleton className="h-48" />
            ) : !covers.data?.length ? (
              <p className="py-10 text-center text-sm text-muted-foreground">ยังไม่มีปก — เริ่มจากฟอร์มด้านซ้าย</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {covers.data.map((c) => (
                  <li key={c.id}>
                    <Link href={`/covers/${c.id}`} className="group block">
                      <div className={cn("relative overflow-hidden rounded-xl border border-border bg-muted", c.orientation === "portrait" ? "aspect-[9/16]" : "aspect-video")}>
                        {c.finalUrl || c.backgroundUrl ? (
                          <ApiImage src={(c.finalUrl ?? c.backgroundUrl)!} className="size-full object-cover transition-transform group-hover:scale-105" />
                        ) : (
                          <div className="grid size-full place-items-center text-muted-foreground">
                            {c.status === "generating" ? <Loader2 className="size-6 animate-spin" /> : <X className="size-6" />}
                          </div>
                        )}
                        <Badge
                          tone={c.status === "ready" ? (c.finalUrl ? "success" : "primary") : c.status === "failed" ? "danger" : "warning"}
                          className="absolute left-2 top-2"
                        >
                          {c.status === "ready" ? (c.finalUrl ? "บันทึกแล้ว" : "พร้อมแก้") : c.status === "failed" ? "ไม่สำเร็จ" : "กำลังสร้าง"}
                        </Badge>
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-sm font-medium">{c.headline}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.style} · {formatDateTime(c.createdAt)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CreateForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const [orientation, setOrientation] = useState<CoverOrientation>("portrait");
  const [style, setStyle] = useState("");
  const [headline, setHeadline] = useState("");
  const [subtext, setSubtext] = useState("");
  const [badge, setBadge] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [imageKind, setImageKind] = useState<"product" | "person">("product");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    // HEIC (iPhone) is converted to JPEG when the browser can decode it (Safari)
    if (!/^image\/(png|jpeg|webp|heic|heif)$/.test(file.type)) return toast.error("รองรับรูป PNG, JPEG, WebP หรือ HEIC");
    if (file.size > 20 * 1024 * 1024) return toast.error("รูปใหญ่เกิน 20 MB");
    try {
      setImage(await fileToDataUrl(file));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "อ่านรูปไม่สำเร็จ");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!style.trim()) return toast.error("เลือกหรือพิมพ์ style");
    setBusy(true);
    try {
      const r = await api.post<{ id: number }>("/covers", {
        orientation,
        style: style.trim(),
        headline: headline.trim(),
        subtext: subtext.trim() || null,
        badge: badge.trim() || null,
        image,
        imageKind,
      });
      await qc.invalidateQueries({ queryKey: ["covers"] });
      router.push(`/covers/${r.id}`);
    } catch (err) {
      toast.error(coverErrorText(err));
      setBusy(false);
    }
  };

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Sparkles className="size-4 text-primary" /> สร้างปกใหม่
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <Label>รูปแบบ</Label>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="รูปแบบปก">
              {(
                [
                  ["portrait", "แนวตั้ง 9:16", "TikTok · Reels · Shorts", RectangleVertical],
                  ["landscape", "แนวนอน 16:9", "YouTube · Facebook", RectangleHorizontal],
                ] as const
              ).map(([value, label, hint, Icon]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={orientation === value}
                  onClick={() => setOrientation(value)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border p-3 text-left text-sm transition-colors",
                    orientation === value ? "border-primary bg-primary-soft/60" : "border-border hover:bg-accent",
                  )}
                >
                  <Icon className={cn("size-6 shrink-0", orientation === value ? "text-primary" : "text-muted-foreground")} />
                  <span className="min-w-0">
                    <span className="block font-medium">{label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cv-style">Style</Label>
            <div className="flex flex-wrap gap-1.5">
              {STYLE_PRESETS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStyle(s)}
                  className={cn("rounded-full border px-3 py-1 text-xs", style === s ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent")}
                >
                  {s}
                </button>
              ))}
            </div>
            <Input id="cv-style" value={style} onChange={(e) => setStyle(e.target.value)} maxLength={200} placeholder="หรือพิมพ์เอง เช่น โทนส้มสด แสงสตูดิโอ ดูพรีเมียม" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cv-headline">หัวข้อบนปก *</Label>
            <Input id="cv-headline" value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={80} required placeholder="เช่น ลด 50% วันนี้วันเดียว" />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cv-sub">ข้อความรอง</Label>
              <Input id="cv-sub" value={subtext} onChange={(e) => setSubtext(e.target.value)} maxLength={120} placeholder="เช่น ส่งฟรีทั่วไทย" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cv-badge">ป้าย</Label>
              <Input id="cv-badge" value={badge} onChange={(e) => setBadge(e.target.value)} maxLength={30} placeholder="เช่น HOT" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cv-file">แนบรูป (ไม่บังคับ)</Label>
            {image ? (
              <div className="flex items-center gap-3 rounded-xl border border-border p-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
                <img src={image} alt="รูปที่แนบ" className="size-16 rounded-lg object-cover" />
                <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="radio" name="cv-kind" checked={imageKind === "product"} onChange={() => setImageKind("product")} className="accent-primary" />
                    รูปสินค้า — วางลงบนปก
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="cv-kind" checked={imageKind === "person"} onChange={() => setImageKind("person")} className="accent-primary" />
                    รูปคน — ให้ AI ใช้เป็นตัวละครในภาพ
                  </label>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => setImage(null)} aria-label="ลบรูป">
                  <X />
                </Button>
              </div>
            ) : (
              <label
                htmlFor="cv-file"
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  void onFile(e.dataTransfer.files?.[0]);
                }}
                className={cn(
                  "flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground hover:bg-accent",
                  dragging ? "border-primary bg-primary-soft/40" : "border-border",
                )}
              >
                <ImagePlus className="size-6" />
                ลากรูปมาวาง หรือกดเลือกไฟล์
                <span className="text-xs">PNG พื้นใส (ตัดพื้นหลังแล้ว) จะสวยที่สุดสำหรับรูปสินค้า</span>
              </label>
            )}
            <input
              id="cv-file"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
              className="sr-only"
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>

          <Button type="submit" className="w-full" disabled={busy || !headline.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} สร้างปกด้วย AI
          </Button>
          <p className="text-center text-xs text-muted-foreground">ใช้ MiniMax ออกแบบและสร้างภาพ ใช้เวลาราว 20–60 วินาที</p>
        </form>
      </CardContent>
    </Card>
  );
}
