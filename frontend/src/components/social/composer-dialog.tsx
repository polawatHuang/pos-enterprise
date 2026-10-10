"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Info, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { api, apiFetch } from "@/lib/api";
import type { CreatorInfo, TikTokOptions, TikTokPrivacy, VideoProject } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect, Segmented, Textarea } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";
import { PlatformChip, useSocialAccounts } from "./accounts-view";
import { useAffiliateLinks } from "./links-view";
import { PLACEMENT_LABEL, PRIVACY_LABEL, SOCIAL, toLocalInput } from "./labels";

/**
 * One composer for all platforms. The TikTok section follows TikTok's Content Posting UX rules:
 * show the creator, privacy chosen by the user (no default), interaction toggles respecting the
 * creator's settings, commercial-content disclosure and the consent line.
 */
export function ComposerDialog({ defaultDate, defaultVideoId, onDone }: { defaultDate?: Date; defaultVideoId?: number; onDone: () => void }) {
  const qc = useQueryClient();
  const accounts = useSocialAccounts();
  const links = useAffiliateLinks();
  const videos = useQuery({ queryKey: ["videos", "list", "ready"], queryFn: () => api.get<VideoProject[]>("/videos", { status: "ready" }) });
  const [selected, setSelected] = useState<number[]>([]);
  const [source, setSource] = useState<"video" | "url">("video");
  const [videoId, setVideoId] = useState<number | "">(defaultVideoId ?? "");
  const [mediaUrl, setMediaUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [linkId, setLinkId] = useState<number | "">("");
  const [when, setWhen] = useState<"now" | "later">("later");
  const [at, setAt] = useState(() => toLocalInput(defaultDate ?? new Date(Date.now() + 60 * 60_000)));
  const [openedAt] = useState(() => Date.now());
  const [aigc, setAigc] = useState(true);
  const [privacy, setPrivacy] = useState<TikTokPrivacy | "">("");
  const [interact, setInteract] = useState({ comment: true, duet: true, stitch: true });
  const [commercial, setCommercial] = useState(false);
  const [brandOrganic, setBrandOrganic] = useState(false);
  const [brandContent, setBrandContent] = useState(false);
  const [saving, setSaving] = useState(false);

  const all = accounts.data?.data ?? [];
  const chosen = all.filter((a) => selected.includes(a.id));
  const firstTikTok = chosen.find((a) => a.platform === "tiktok" && a.status === "connected");
  const hasTikTok = chosen.some((a) => a.platform === "tiktok");
  const creator = useQuery({
    queryKey: ["social", "creator", firstTikTok?.id],
    queryFn: () => api.get<CreatorInfo>(`/social/accounts/${firstTikTok!.id}/creator-info`),
    enabled: Boolean(firstTikTok),
    staleTime: 60_000,
  });
  const video = (videos.data ?? []).find((v) => v.id === videoId);

  const pickVideo = (id: number | "") => {
    setVideoId(id);
    const v = (videos.data ?? []).find((x) => x.id === id);
    if (v && !caption) setCaption(v.postCaption ?? "");
    if (v && !hashtags) setHashtags(v.hashtags ?? "");
  };

  const problems = (() => {
    const list: string[] = [];
    if (!selected.length) list.push("เลือกบัญชีอย่างน้อย 1 บัญชี");
    if (source === "video" && !videoId) list.push("เลือกวิดีโอ");
    if (source === "url" && !/^https:\/\//.test(mediaUrl)) list.push("ใส่ลิงก์ MP4 แบบ https");
    if (hasTikTok && !privacy) list.push("เลือกว่าใครดูโพสต์ TikTok ได้");
    if (hasTikTok && commercial && !brandOrganic && !brandContent) list.push("ระบุประเภทเนื้อหาเชิงพาณิชย์");
    if (when === "later" && new Date(at).getTime() < openedAt - 60_000) list.push("เวลาโพสต์อยู่ในอดีต");
    return list;
  })();

  const submit = async () => {
    if (problems.length) return toast.error(problems[0]);
    setSaving(true);
    const tiktok: TikTokOptions | undefined = hasTikTok
      ? {
          privacyLevel: privacy as TikTokPrivacy,
          disableComment: !interact.comment,
          disableDuet: !interact.duet,
          disableStitch: !interact.stitch,
          brandContent: commercial && brandContent,
          brandOrganic: commercial && brandOrganic,
        }
      : undefined;
    try {
      const r = await apiFetch<{ data: { ids: number[]; warnings: string[] } }>("/social/posts", {
        method: "POST",
        json: {
          accountIds: selected,
          videoProjectId: source === "video" ? videoId || null : null,
          mediaUrl: source === "url" ? mediaUrl : null,
          caption,
          hashtags,
          affiliateLinkId: linkId || null,
          scheduledAt: when === "later" ? new Date(at).toISOString() : null,
          tiktok,
          isAiGenerated: aigc,
        },
      });
      toast.success(when === "now" ? "เข้าคิวโพสต์แล้ว ระบบจะโพสต์ภายในประมาณ 1 นาที" : `ตั้งเวลา ${r.data.ids.length} โพสต์แล้ว`);
      for (const w of r.data.warnings) toast.warning(w);
      await qc.invalidateQueries({ queryKey: ["social"] });
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const link = links.data?.data.find((l) => l.id === linkId);

  return (
    <DialogContent title="สร้างโพสต์" description="โพสต์คลิปเดียวไปหลายช่องทางพร้อมกัน แต่ละโพสต์ได้ลิงก์ affiliate แยกเพื่อติดตามยอดขาย" className="max-w-2xl">
      <div className="space-y-5">
        <section className="space-y-2">
          <Label>โพสต์ไปที่</Label>
          {!all.length ? (
            <p className="text-sm text-muted-foreground">
              ยังไม่มีบัญชี —{" "}
              <Link href="/social/accounts" className="text-primary underline">
                เชื่อมบัญชีโซเชียล
              </Link>
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {all
                .filter((a) => a.isActive || a.status !== "connected")
                .map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggle(a.id)}
                    aria-pressed={selected.includes(a.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
                      selected.includes(a.id) ? "border-primary bg-primary-soft/60 ring-1 ring-primary" : "border-border hover:bg-accent",
                    )}
                  >
                    <PlatformChip platform={a.platform} />
                    <span className="max-w-[160px] truncate">{a.displayName}</span>
                    {a.status !== "connected" && <AlertTriangle className="size-3.5 text-warning" aria-label="ยังไม่ได้เชื่อมต่อ" />}
                  </button>
                ))}
            </div>
          )}
          {chosen.some((a) => a.status !== "connected") && (
            <p className="text-xs text-warning">บัญชีที่มีเครื่องหมาย ⚠ ยังไม่ได้เชื่อมต่อ โพสต์จะรอจนกว่าจะเชื่อมต่อ</p>
          )}
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label>วิดีโอ</Label>
            <Segmented
              label="แหล่งวิดีโอ"
              value={source}
              onChange={setSource}
              options={[
                { value: "video", label: "จาก AI Video" },
                { value: "url", label: "ลิงก์ MP4" },
              ]}
            />
          </div>
          {source === "video" ? (
            <NativeSelect value={videoId} onChange={(e) => pickVideo(e.target.value ? Number(e.target.value) : "")} aria-label="เลือกวิดีโอ">
              <option value="">— เลือกวิดีโอที่สร้างเสร็จแล้ว —</option>
              {(videos.data ?? [])
                .filter((v) => v.status === "ready" && v.outputUrl)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title} {v.durationSec ? `(${v.durationSec} วิ)` : ""}
                  </option>
                ))}
            </NativeSelect>
          ) : (
            <Input value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="https://media.example.com/clip.mp4" aria-label="ลิงก์ไฟล์ MP4" />
          )}
          <p className="text-xs text-muted-foreground">
            แพลตฟอร์มจะดึงไฟล์จากลิงก์นี้เอง ลิงก์ต้องเปิดได้สาธารณะและไม่หมดอายุ (เช่น Cloudflare R2) — TikTok ต้อง verify โดเมนของลิงก์ใน TikTok Developer ก่อน
          </p>
          {video?.durationSec && creator.data?.maxDurationSec && video.durationSec > creator.data.maxDurationSec && (
            <p className="text-xs text-danger">วิดีโอยาวเกินที่บัญชี TikTok นี้โพสต์ได้ ({creator.data.maxDurationSec} วินาที)</p>
          )}
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="cp-caption">แคปชัน</Label>
            <Textarea id="cp-caption" value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} maxLength={2000} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-tags">แฮชแท็ก</Label>
            <Input id="cp-tags" value={hashtags} onChange={(e) => setHashtags(e.target.value)} maxLength={500} placeholder="#รีวิว #ของดีบอกต่อ" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-link">ลิงก์ Affiliate</Label>
            <NativeSelect id="cp-link" value={linkId} onChange={(e) => setLinkId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">ไม่ใส่ลิงก์</option>
              {(links.data?.data ?? [])
                .filter((l) => !l.label?.includes(" · "))
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label ?? l.shortUrl ?? l.originalUrl}
                  </option>
                ))}
            </NativeSelect>
          </div>
          {link && chosen.length > 0 && (
            <ul className="space-y-0.5 text-xs text-muted-foreground sm:col-span-2">
              {[...new Set(chosen.map((a) => a.platform))].map((p) => (
                <li key={p} className="flex items-center gap-1.5">
                  <Info className="size-3.5 shrink-0" /> {SOCIAL[p].label}: {PLACEMENT_LABEL[p === "facebook" ? "caption" : "bio"]}
                  {p !== "facebook" && " (แคปชันของแพลตฟอร์มนี้คลิกลิงก์ไม่ได้ — ใส่ลิงก์ไว้ในโปรไฟล์)"}
                </li>
              ))}
            </ul>
          )}
        </section>

        {hasTikTok && (
          <section className="space-y-3 rounded-xl border border-border p-4">
            <div className="flex items-center gap-2">
              <PlatformChip platform="tiktok" />
              <p className="text-sm font-medium">
                ตั้งค่า TikTok
                {creator.data && (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    · โพสต์ในชื่อ {creator.data.nickname} (@{creator.data.username})
                  </span>
                )}
              </p>
              {creator.isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            </div>
            {creator.isError && <p className="text-xs text-warning">อ่านข้อมูลบัญชี TikTok ไม่ได้: {creator.error instanceof Error ? creator.error.message : ""}</p>}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cp-privacy">ใครดูได้บ้าง *</Label>
              <NativeSelect id="cp-privacy" value={privacy} onChange={(e) => setPrivacy(e.target.value as TikTokPrivacy)}>
                <option value="">— เลือก —</option>
                {(creator.data?.privacyOptions ?? (Object.keys(PRIVACY_LABEL) as TikTokPrivacy[])).map((p) => (
                  <option key={p} value={p} disabled={commercial && brandContent && p === "SELF_ONLY"}>
                    {PRIVACY_LABEL[p]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              {(
                [
                  ["comment", "ให้แสดงความคิดเห็น", creator.data?.commentDisabled],
                  ["duet", "ให้ Duet", creator.data?.duetDisabled],
                  ["stitch", "ให้ Stitch", creator.data?.stitchDisabled],
                ] as const
              ).map(([k, label, off]) => (
                <label key={k} className={cn("flex items-center gap-2", off && "opacity-50")}>
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={!off && interact[k]}
                    disabled={Boolean(off)}
                    onChange={(e) => setInteract({ ...interact, [k]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-sm">
              <label className="flex items-center gap-2 font-medium">
                <input type="checkbox" className="size-4 accent-primary" checked={commercial} onChange={(e) => setCommercial(e.target.checked)} />
                เปิดเผยว่าเป็นเนื้อหาเชิงพาณิชย์
              </label>
              {commercial && (
                <div className="space-y-1.5 pl-6">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" className="size-4 accent-primary" checked={brandOrganic} onChange={(e) => setBrandOrganic(e.target.checked)} />
                    แบรนด์ของคุณเอง (ป้าย &quot;Promotional content&quot;)
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" className="size-4 accent-primary" checked={brandContent} onChange={(e) => setBrandContent(e.target.checked)} />
                    Branded content — โปรโมตสินค้าคนอื่นเพื่อค่าตอบแทน เช่น affiliate (ป้าย &quot;Paid partnership&quot;)
                  </label>
                </div>
              )}
              {link && !commercial && <p className="text-xs text-warning">โพสต์นี้มีลิงก์ affiliate ควรเปิดเผยว่าเป็นเนื้อหาเชิงพาณิชย์</p>}
            </div>
            <p className="text-xs text-muted-foreground">
              การโพสต์ถือว่าคุณยอมรับ{" "}
              {commercial && brandContent && (
                <>
                  <a className="underline" href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer noopener">
                    Branded Content Policy
                  </a>{" "}
                  และ{" "}
                </>
              )}
              <a className="underline" href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer noopener">
                Music Usage Confirmation
              </a>{" "}
              ของ TikTok — วิดีโออาจใช้เวลาหลายนาทีกว่าจะขึ้นบนโปรไฟล์
            </p>
          </section>
        )}

        <section className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label>เวลาโพสต์</Label>
            <Segmented
              label="เวลาโพสต์"
              value={when}
              onChange={setWhen}
              options={[
                { value: "later", label: "ตั้งเวลา" },
                { value: "now", label: "โพสต์ทันที" },
              ]}
            />
          </div>
          {when === "later" && <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="w-auto" aria-label="วันเวลาโพสต์" />}
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={aigc} onChange={(e) => setAigc(e.target.checked)} />
            ติดป้ายเนื้อหาที่สร้างด้วย AI
          </label>
        </section>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          {problems.length > 0 && <p className="mr-auto text-xs text-muted-foreground">{problems[0]}</p>}
          <Button type="button" variant="outline" onClick={onDone}>
            ยกเลิก
          </Button>
          <Button onClick={() => void submit()} disabled={saving || problems.length > 0}>
            {saving ? <Loader2 className="animate-spin" /> : <Send />}
            {when === "now" ? "โพสต์ทันที" : `ตั้งเวลา ${selected.length || ""} โพสต์`}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}
