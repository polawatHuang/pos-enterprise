"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Clapperboard, Film, Loader2, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { DramaCatalog, DramaListItem, DramaProject } from "@/lib/types";
import { formatRelativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { PageHeader } from "@/components/layout/page";

/** ละคร AI: every drama of the shop, newest first; a new one opens straight in the studio. */
export function DramaListView() {
  const router = useRouter();
  const list = useQuery({
    queryKey: ["drama", "list"],
    queryFn: () => api.get<DramaListItem[]>("/drama"),
    refetchInterval: (q) => (q.state.data?.some((d) => d.running) ? 5000 : false),
  });
  const catalog = useQuery({
    queryKey: ["drama", "catalog"],
    queryFn: () => api.get<DramaCatalog>("/drama/catalog"),
    staleTime: 60_000,
  });
  const [creating, setCreating] = useState(false);
  const genreLabel = (id: string) => catalog.data?.genres.find((g) => g.id === id)?.label ?? id;
  const styleLabel = (id: string) => catalog.data?.styles.find((s) => s.id === id)?.label ?? id;

  const create = async () => {
    setCreating(true);
    try {
      const p = await api.post<DramaProject>("/drama", {
        genre: "ghost",
        style: "realistic",
        lengthSec: 60,
        episodesTotal: 1,
        music: true,
      });
      router.push(`/drama/${p.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "สร้างโปรเจกต์ไม่สำเร็จ");
      setCreating(false);
    }
  };

  return (
    <>
      <PageHeader
        title="ละคร AI"
        description="สร้างละครสั้น 9:16 ทั้งแบบตอนเดียวจบและซีรีส์หลายตอน ทุกช็อตเป็นวิดีโอเคลื่อนไหว MiniMax H3 พร้อมเสียงพากย์ จนเป็นไฟล์พร้อมโพสต์"
        actions={
          <Button onClick={() => void create()} disabled={creating}>
            {creating ? <Loader2 className="animate-spin" /> : <Plus />} สร้างละครใหม่
          </Button>
        }
      />
      <div className="relative mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-rose-600 via-fuchsia-700 to-indigo-800 p-6 text-white shadow-lg">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-white/10 blur-2xl" />
        <p className="flex items-center gap-2 text-sm font-medium text-white/80">
          <Sparkles className="size-4" /> Story mode production studio
        </p>
        <h2 className="mt-1 text-2xl font-semibold">เล่าเรื่องให้คนดูติดหนึบใน 6 ขั้น</h2>
        <ol className="mt-3 flex flex-wrap gap-2 text-xs">
          {["ตั้งค่าเรื่อง", "บทบรรยาย", "ตัวละคร", "สร้างปก", "สตอรี่บอร์ด", "รวม/ส่งออก"].map((s, i) => (
            <li key={s} className="rounded-full bg-white/15 px-3 py-1 backdrop-blur">
              {String(i + 1).padStart(2, "0")} {s}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-white/80">
          เลือกได้ตั้งแต่ตอนเดียวจบจนถึงซีรีส์ 30 ตอน · ทุกช็อตเป็นวิดีโอเคลื่อนไหว ไม่ใช่สไลด์ภาพ · กด &quot;ทำออโต้&quot; ครั้งเดียว ระบบทำต่อให้จนจบ
        </p>
      </div>

      {list.isPending ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="aspect-[9/16] rounded-xl" />
          ))}
        </div>
      ) : !list.data?.length ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <Clapperboard className="size-10 text-muted-foreground" />
          <p className="font-medium">ยังไม่มีละคร</p>
          <p className="text-sm text-muted-foreground">เลือกแนวเรื่องและสไตล์ภาพ แล้วให้ AI สร้างละครเรื่องแรกของคุณ</p>
          <Button onClick={() => void create()} disabled={creating}>
            <Plus /> สร้างละครใหม่
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {list.data.map((d) => (
            <Link
              key={d.id}
              href={`/drama/${d.id}`}
              className="group overflow-hidden rounded-xl border border-border bg-card shadow-xs transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="relative aspect-[9/16] bg-gradient-to-br from-slate-800 to-slate-950">
                {d.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.coverUrl} alt="" className="size-full object-cover transition group-hover:scale-105" />
                ) : (
                  <Film className="absolute inset-0 m-auto size-10 text-white/30" />
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-3 pt-10">
                  <p className="line-clamp-2 font-semibold text-white">{d.title}</p>
                  {d.episodesTotal > 1 && (
                    <p className="mt-0.5 text-xs text-white/80">
                      {d.episodesTotal} ตอนจบ · เสร็จ {d.episodesDone}/{d.episodesTotal}
                    </p>
                  )}
                </div>
                <div className="absolute left-2 top-2 flex flex-wrap gap-1">
                  {d.running ? (
                    <Badge tone="primary" className="bg-white/90">
                      <Loader2 className="size-3 animate-spin" /> กำลังสร้าง
                    </Badge>
                  ) : d.done ? (
                    <Badge tone="success" className="bg-white/90">
                      {d.episodesTotal > 1 ? `ครบ ${d.episodesTotal} ตอน` : "พร้อมโพสต์"}
                    </Badge>
                  ) : d.error ? (
                    <Badge tone="danger" className="bg-white/90">
                      ติดปัญหา
                    </Badge>
                  ) : null}
                </div>
              </div>
              <div className="space-y-0.5 p-3 text-xs text-muted-foreground">
                <p className="truncate">
                  {genreLabel(d.genre)} · {styleLabel(d.style)}
                </p>
                <p>
                  {d.episodesTotal > 1 ? `${d.episodesTotal} ตอน × ` : ""}
                  {Math.round(d.lengthSec / 60)} นาที · {formatRelativeTime(d.updatedAt)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
