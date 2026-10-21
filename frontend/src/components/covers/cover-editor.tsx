"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Download, Loader2, RefreshCw, Save, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { api, apiBlob } from "@/lib/api";
import { decodeImage } from "@/lib/image";
import type { CoverDesign, CoverFont, CoverLayout, CoverProject, CoverUserDesign } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, Input, Label, NativeSelect } from "@/components/ui/primitives";
import { PageHeader } from "@/components/layout/page";
import { COVER_FONTS, ensureFont } from "./fonts";
import { COVER_SIZE, composeCover, defaultImagePos } from "./compose";
import { coverErrorText, STYLE_PRESETS } from "./covers-view";

const LAYOUT_LABEL: Record<CoverLayout, string> = {
  "top-title": "หัวข้อด้านบน",
  "bottom-band": "แถบล่าง",
  "split-left": "หัวข้อซ้าย (แนวนอน)",
  "center-burst": "หัวข้อกลางภาพ",
};

async function loadImage(url: string | null): Promise<CanvasImageSource | null> {
  if (!url) return null;
  try {
    return (await decodeImage(await apiBlob(url))).source;
  } catch {
    return null;
  }
}

export function CoverEditor({ id }: { id: number }) {
  const cover = useQuery({
    queryKey: ["covers", id],
    queryFn: () => api.get<CoverProject>(`/covers/${id}`),
    refetchInterval: (q) => (q.state.data?.status === "generating" ? 3000 : false),
  });
  const c = cover.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title="แก้ไขปกคลิป"
        description={c ? `${c.orientation === "portrait" ? "แนวตั้ง 9:16" : "แนวนอน 16:9"} · ${c.style}` : undefined}
        actions={
          <Button variant="outline" asChild>
            <Link href="/covers">
              <ArrowLeft /> ปกทั้งหมด
            </Link>
          </Button>
        }
      />
      {!c ? (
        <Card className="h-96 animate-pulse" />
      ) : c.status === "generating" ? (
        <Card className="grid h-96 place-items-center text-center text-sm text-muted-foreground" role="status" aria-live="polite">
          <div className="space-y-2">
            <Loader2 className="mx-auto size-8 animate-spin text-primary" />
            <p className="font-medium text-foreground">AI กำลังออกแบบและสร้างภาพ…</p>
            <p>ใช้เวลาราว 20–60 วินาที ปิดหน้านี้ได้ ระบบทำงานต่อเบื้องหลัง</p>
          </div>
        </Card>
      ) : c.status === "failed" && !c.backgroundUrl ? (
        <Failed c={c} />
      ) : (
        <Editor key={`${c.id}-${c.updatedAt}-${c.backgroundUrl}`} c={c} />
      )}
    </div>
  );
}

function Failed({ c }: { c: CoverProject }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <Card className="space-y-3 p-6 text-sm">
      <p className="flex items-start gap-2 text-danger">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {c.error ?? "สร้างปกไม่สำเร็จ"}
      </p>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.post(`/covers/${c.id}/regenerate`, { redesign: true });
            await qc.invalidateQueries({ queryKey: ["covers"] });
          } catch (err) {
            toast.error(coverErrorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} ลองใหม่
      </Button>
    </Card>
  );
}

function Editor({ c }: { c: CoverProject }) {
  const router = useRouter();
  const qc = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const design = c.design as CoverDesign;
  const u = design.user ?? {};
  const portrait = c.orientation === "portrait";
  const [headline, setHeadline] = useState(c.headline);
  const [subtext, setSubtext] = useState(c.subtext ?? "");
  const [badge, setBadge] = useState(c.badge ?? "");
  const [font, setFont] = useState<CoverFont>(u.font ?? design.font);
  const [layout, setLayout] = useState<CoverLayout>(u.layout ?? design.layout);
  const [textColor, setTextColor] = useState(u.textColor ?? design.palette.text);
  const [accentColor, setAccentColor] = useState(u.accentColor ?? design.palette.accent);
  const [titleScale, setTitleScale] = useState(u.titleScale ?? 1);
  const [emphasisWord, setEmphasisWord] = useState(u.emphasisWord !== undefined ? (u.emphasisWord ?? "") : (design.emphasisWord ?? ""));
  const pos0 = defaultImagePos(layout, portrait);
  const [imageX, setImageX] = useState(u.imageX ?? pos0.x);
  const [imageY, setImageY] = useState(u.imageY ?? pos0.y);
  const [imageScale, setImageScale] = useState(u.imageScale ?? 0.7);
  const [images, setImages] = useState<{ bg: CanvasImageSource | null; product: CanvasImageSource | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newStyle, setNewStyle] = useState("");
  const hasProduct = c.uploadKind === "product" && Boolean(c.uploadUrl);

  useEffect(() => {
    let alive = true;
    void Promise.all([loadImage(c.backgroundUrl), hasProduct ? loadImage(c.uploadUrl) : Promise.resolve(null)]).then(([bg, product]) => {
      if (alive) setImages({ bg, product });
    });
    return () => {
      alive = false;
    };
  }, [c.backgroundUrl, c.uploadUrl, hasProduct]);

  const input = useMemo(
    () => ({
      orientation: c.orientation,
      headline: headline.trim() || " ",
      subtext: subtext.trim() || null,
      badge: badge.trim() || null,
      layout,
      fontFamily: COVER_FONTS[font].family,
      fontWeight: COVER_FONTS[font].weight,
      textColor,
      strokeColor: design.palette.stroke,
      accentColor,
      bandColor: design.palette.primary,
      titleScale,
      emphasisWord: emphasisWord.trim() || null,
      imageX,
      imageY,
      imageScale,
    }),
    [c.orientation, headline, subtext, badge, layout, font, textColor, accentColor, design.palette, titleScale, emphasisWord, imageX, imageY, imageScale],
  );

  useEffect(() => {
    if (!images || !canvasRef.current) return;
    let alive = true;
    void ensureFont(font).then(() => {
      if (alive && canvasRef.current) composeCover(canvasRef.current, { ...input, background: images.bg, product: images.product });
    });
    return () => {
      alive = false;
    };
  }, [images, input, font]);

  const userDesign = (): CoverUserDesign => ({
    font,
    layout,
    textColor,
    accentColor,
    titleScale,
    emphasisWord: emphasisWord.trim() || null,
    imageX,
    imageY,
    imageScale,
  });

  const save = async () => {
    if (!canvasRef.current) return;
    setBusy("save");
    try {
      await api.patch(`/covers/${c.id}`, { headline: headline.trim() || c.headline, subtext: subtext.trim() || null, badge: badge.trim() || null, user: userDesign() });
      await api.post(`/covers/${c.id}/final`, { image: canvasRef.current.toDataURL("image/jpeg", 0.92) });
      await qc.invalidateQueries({ queryKey: ["covers"] });
      toast.success("บันทึกปกแล้ว");
    } catch (err) {
      toast.error(coverErrorText(err));
    } finally {
      setBusy(null);
    }
  };

  const download = () => {
    canvasRef.current?.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cover-${c.id}-${portrait ? "9x16" : "16x9"}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  };

  const regenerate = async () => {
    setBusy("regen");
    try {
      // Keep the current text/look so it survives the new background
      await api.patch(`/covers/${c.id}`, { headline: headline.trim() || c.headline, subtext: subtext.trim() || null, badge: badge.trim() || null, user: userDesign() });
      await api.post(`/covers/${c.id}/regenerate`, newStyle.trim() ? { style: newStyle.trim() } : {});
      await qc.invalidateQueries({ queryKey: ["covers"] });
    } catch (err) {
      toast.error(coverErrorText(err));
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!window.confirm("ลบปกนี้?")) return;
    try {
      await api.del(`/covers/${c.id}`);
      await qc.invalidateQueries({ queryKey: ["covers"] });
      router.push("/covers");
    } catch (err) {
      toast.error(coverErrorText(err));
    }
  };

  const { width, height } = COVER_SIZE[c.orientation];
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0">
        <div className={cn("mx-auto overflow-hidden rounded-2xl border border-border bg-muted shadow-sm", portrait ? "max-w-sm" : "max-w-3xl")}>
          <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="block h-auto w-full"
            role="img"
            aria-label={`ปกคลิป: ${headline}`}
            data-testid="cover-canvas"
          />
        </div>
        {c.status === "failed" && c.error && <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-danger">สร้างภาพใหม่ไม่สำเร็จ: {c.error}</p>}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button onClick={download} disabled={!images}>
            <Download /> ดาวน์โหลด PNG
          </Button>
          <Button variant="outline" onClick={() => void save()} disabled={!images || busy !== null}>
            {busy === "save" ? <Loader2 className="animate-spin" /> : <Save />} บันทึก
          </Button>
          <Button variant="ghost" onClick={() => void remove()} aria-label="ลบปก">
            <Trash2 />
          </Button>
        </div>
      </div>

      <Card className="h-fit">
        <CardContent className="space-y-4 pt-5 text-sm">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ed-headline">หัวข้อ</Label>
            <Input id="ed-headline" value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={80} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ed-emph">คำเด่น (เปลี่ยนสี)</Label>
            <Input id="ed-emph" value={emphasisWord} onChange={(e) => setEmphasisWord(e.target.value)} maxLength={80} placeholder="คำที่อยู่ในหัวข้อ เช่น ลด 50%" />
          </div>
          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ed-sub">ข้อความรอง</Label>
              <Input id="ed-sub" value={subtext} onChange={(e) => setSubtext(e.target.value)} maxLength={120} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ed-badge">ป้าย</Label>
              <Input id="ed-badge" value={badge} onChange={(e) => setBadge(e.target.value)} maxLength={30} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ed-font">ฟอนต์</Label>
              <NativeSelect id="ed-font" value={font} onChange={(e) => setFont(e.target.value as CoverFont)}>
                {(Object.keys(COVER_FONTS) as CoverFont[]).map((f) => (
                  <option key={f} value={f}>
                    {COVER_FONTS[f].label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ed-layout">ตำแหน่งหัวข้อ</Label>
              <NativeSelect id="ed-layout" value={layout} onChange={(e) => setLayout(e.target.value as CoverLayout)}>
                {(Object.keys(LAYOUT_LABEL) as CoverLayout[])
                  .filter((l) => l !== "split-left" || !portrait)
                  .map((l) => (
                    <option key={l} value={l}>
                      {LAYOUT_LABEL[l]}
                    </option>
                  ))}
              </NativeSelect>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2">
              <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="size-8 cursor-pointer rounded border border-border" aria-label="สีตัวหนังสือ" />
              สีตัวหนังสือ
            </label>
            <label className="flex items-center gap-2">
              <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="size-8 cursor-pointer rounded border border-border" aria-label="สีเน้น" />
              สีเน้น/ป้าย
            </label>
          </div>
          <Slider id="ed-size" label="ขนาดหัวข้อ" value={titleScale} min={0.6} max={1.5} step={0.05} onChange={setTitleScale} />
          {hasProduct && (
            <fieldset className="space-y-2 rounded-xl border border-border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">รูปสินค้า</legend>
              <Slider id="ed-ix" label="ซ้าย ↔ ขวา" value={imageX} min={0} max={1} step={0.01} onChange={setImageX} />
              <Slider id="ed-iy" label="บน ↕ ล่าง" value={imageY} min={0} max={1} step={0.01} onChange={setImageY} />
              <Slider id="ed-is" label="ขนาด" value={imageScale} min={0.3} max={1} step={0.02} onChange={setImageScale} />
            </fieldset>
          )}
          <div className="space-y-2 border-t border-border pt-3">
            <Label htmlFor="ed-style">สร้างภาพพื้นหลังใหม่</Label>
            <NativeSelect id="ed-style" value={newStyle} onChange={(e) => setNewStyle(e.target.value)}>
              <option value="">ใช้ style เดิม ({c.style})</option>
              {STYLE_PRESETS.filter((s) => s !== c.style).map((s) => (
                <option key={s} value={s}>
                  เปลี่ยนเป็น {s}
                </option>
              ))}
            </NativeSelect>
            <Button variant="outline" className="w-full" onClick={() => void regenerate()} disabled={busy !== null}>
              {busy === "regen" ? <Loader2 className="animate-spin" /> : <Wand2 />} สร้างภาพใหม่ (ข้อความเดิม)
            </Button>
            {design.mood && <p className="text-xs text-muted-foreground">ไอเดีย AI: {design.mood}</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Slider({ id, label, value, min, max, step, onChange }: { id: string; label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <Label htmlFor={id} className="w-24 shrink-0 text-xs">
        {label}
      </Label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-primary" />
    </div>
  );
}
