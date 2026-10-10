"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clapperboard, Loader2, Plus, Sparkles, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, api } from "@/lib/api";
import type { Product, VideoMeta, VideoProject } from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Label, NativeSelect, Skeleton, TabBar, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { PageHeader } from "@/components/layout/page";
import { ProductPicker } from "@/components/common/product-picker";
import { IN_PROGRESS, LENGTHS, VIDEO_STATUS } from "./labels";

type Tab = "all" | "in_progress" | "ready" | "draft";

export const useVideoMeta = () => useQuery({ queryKey: ["videos", "meta"], queryFn: () => api.get<VideoMeta>("/videos/meta"), staleTime: 60_000 });

export function VideosView() {
  const params = useSearchParams();
  const trendParam = Number(params.get("trend")) || null;
  const [tab, setTab] = useState<Tab>("all");
  const [creating, setCreating] = useState(Boolean(trendParam));
  const list = useQuery({
    queryKey: ["videos", "list", tab],
    queryFn: () => api.get<VideoProject[]>("/videos", { status: tab }),
    refetchInterval: (q) => (q.state.data?.some((v) => IN_PROGRESS.includes(v.status)) ? 5000 : false),
  });

  return (
    <div>
      <PageHeader
        title="AI Video"
        description="ให้ AI เขียนสคริปต์รีวิว พากย์เสียง สร้างภาพ และประกอบเป็นคลิปแนวตั้ง 9:16 พร้อมซับ จากข้อมูลสินค้าจริง"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> สร้างวิดีโอ
          </Button>
        }
      />
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "all", label: "ทั้งหมด" },
          { value: "in_progress", label: "กำลังสร้าง" },
          { value: "ready", label: "พร้อมใช้" },
          { value: "draft", label: "ร่าง/ไม่สำเร็จ" },
        ]}
      />
      <div className="mt-4">
        {list.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        ) : !list.data?.length ? (
          <Card className="grid place-items-center gap-2 py-16 text-center text-sm text-muted-foreground">
            <Clapperboard className="size-8" />
            ยังไม่มีวิดีโอ — เริ่มจากเลือกสินค้าหรือสินค้าเทรนด์
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.data.map((v) => (
              <Link key={v.id} href={`/videos/${v.id}`}>
                <Card className="flex h-full gap-3 p-4 transition-shadow hover:shadow-md">
                  <div className="grid aspect-[9/16] w-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
                    {v.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- product images on arbitrary hosts
                      <img src={v.imageUrl} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <Clapperboard className="size-5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="line-clamp-2 text-sm font-medium">{v.title}</p>
                    <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      {v.trendId && <TrendingUp className="size-3" />}
                      {v.productName ?? (v.trendId ? "จากสินค้าเทรนด์" : "—")}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={VIDEO_STATUS[v.status].tone}>
                        {IN_PROGRESS.includes(v.status) && <Loader2 className="size-3 animate-spin" />}
                        {VIDEO_STATUS[v.status].label}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {v.scenes.length} ฉาก{v.durationSec ? ` · ${v.durationSec} วิ` : ""} · {formatRelativeTime(v.updatedAt)}
                      </span>
                    </div>
                    {v.stageDetail && IN_PROGRESS.includes(v.status) && <p className="truncate text-[11px] text-muted-foreground">{v.stageDetail}</p>}
                    {v.status === "failed" && v.error && <p className="line-clamp-1 text-[11px] text-danger">{v.error}</p>}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
      <Dialog open={creating} onOpenChange={setCreating}>
        {creating && <CreateDialog trendId={trendParam} onDone={() => setCreating(false)} />}
      </Dialog>
    </div>
  );
}

function CreateDialog({ trendId, onDone }: { trendId: number | null; onDone: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const meta = useVideoMeta();
  const [product, setProduct] = useState<Product | null>(null);
  const [tone, setTone] = useState("friendly");
  const [lengthSec, setLength] = useState(30);
  const [audience, setAudience] = useState("");
  const [notes, setNotes] = useState("");
  const [visualMode, setVisualMode] = useState<"product_images" | "ai_clips">("product_images");
  const [saving, setSaving] = useState(false);
  const caps = meta.data?.capabilities;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product && !trendId) return toast.error("เลือกสินค้าก่อน");
    setSaving(true);
    try {
      const r = await apiFetch<{ data: VideoProject; warning?: string }>("/videos", {
        method: "POST",
        json: {
          ...(trendId && !product ? { trendId } : { productId: product?.id }),
          tone,
          lengthSec,
          audience: audience || undefined,
          notes: notes || undefined,
          visualMode,
        },
      });
      if (r.warning) toast.warning(`สร้างโปรเจกต์แล้ว แต่ AI เขียนสคริปต์ไม่สำเร็จ: ${r.warning}`);
      else toast.success("AI เขียนสคริปต์เสร็จแล้ว ตรวจและแก้ไขก่อนสร้างวิดีโอ");
      await qc.invalidateQueries({ queryKey: ["videos"] });
      router.push(`/videos/${r.data.id}`);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "สร้างไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent title="สร้างวิดีโอรีวิวสินค้า" description="AI จะเขียนสคริปต์จากข้อมูลสินค้าที่มีในระบบ คุณแก้ไขได้ก่อนสร้างเสียงและภาพ" className="max-w-xl">
      <form onSubmit={submit} className="space-y-4">
        {caps && !caps.script.configured && (
          <p className="flex gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> ยังไม่ได้ตั้งค่า AI บนเซิร์ฟเวอร์ (MINIMAX_API_KEY)
          </p>
        )}
        <div className="space-y-1.5">
          <Label>สินค้า</Label>
          {product ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="truncate">{product.name}</span>
              <Button type="button" size="sm" variant="ghost" onClick={() => setProduct(null)}>
                เปลี่ยน
              </Button>
            </div>
          ) : trendId ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <TrendingUp className="size-4 text-primary" /> สินค้าเทรนด์ #{trendId}
              </span>
            </div>
          ) : (
            <ProductPicker onPick={setProduct} />
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="v-tone">โทน</Label>
            <NativeSelect id="v-tone" value={tone} onChange={(e) => setTone(e.target.value)}>
              {Object.entries(meta.data?.tones ?? { friendly: "เป็นกันเอง" }).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="v-len">ความยาว</Label>
            <NativeSelect id="v-len" value={lengthSec} onChange={(e) => setLength(Number(e.target.value))}>
              {LENGTHS.map((n) => (
                <option key={n} value={n}>
                  ~{n} วินาที
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="v-aud">กลุ่มเป้าหมาย (ไม่บังคับ)</Label>
          <Input id="v-aud" value={audience} onChange={(e) => setAudience(e.target.value)} maxLength={200} placeholder="เช่น นักศึกษา, แม่บ้าน, คนทำงานออฟฟิศ" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="v-notes">สิ่งที่อยากให้เน้น (ไม่บังคับ)</Label>
          <Textarea id="v-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} placeholder="เช่น เน้นโปรลด 20% สิ้นเดือนนี้" />
        </div>
        <div className="space-y-1.5">
          <Label>ภาพในคลิป</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["product_images", "รูปสินค้า + เคลื่อนไหว", "เร็ว ประหยัด ใช้รูปสินค้าในระบบ"],
                ["ai_clips", "คลิป AI (Hailuo)", "สวยกว่า มีค่าใช้จ่ายต่อฉาก ใช้เวลาหลายนาที"],
              ] as const
            ).map(([value, title, hint]) => (
              <button
                key={value}
                type="button"
                onClick={() => setVisualMode(value)}
                className={cn(
                  "rounded-lg border p-3 text-left text-sm transition-colors",
                  visualMode === value ? "border-primary bg-primary-soft/50 ring-1 ring-primary" : "border-border hover:bg-accent",
                )}
                aria-pressed={visualMode === value}
              >
                <p className="font-medium">{title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={saving || (!product && !trendId)}>
            {saving ? <Loader2 className="animate-spin" /> : <Sparkles />} {saving ? "AI กำลังเขียนสคริปต์…" : "ให้ AI เขียนสคริปต์"}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
