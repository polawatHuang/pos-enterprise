"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, CloudOff, Film, Loader2, Plus, RefreshCw, ShoppingBag, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { DramaProject, DramaShot } from "@/lib/types";
import { cn } from "@/lib/utils";
import { flushDrafts, useAutosave, type AutosaveStatus } from "@/lib/use-autosave";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Label, NativeSelect, Textarea } from "@/components/ui/primitives";

type Line = { character: string; line: string };
type Draft = {
  scene: string;
  narration: string;
  dialogue: Line[];
  visualPrompt: string;
  camera: string;
  characters: string[];
};

const errorText = (err: unknown) => (err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ");

const draftOf = (s: DramaShot): Draft => ({
  scene: s.scene ?? "",
  narration: s.narration ?? "",
  dialogue: s.dialogue,
  visualPrompt: s.visualPrompt ?? "",
  camera: s.camera ?? "",
  characters: s.characters,
});

/** What the server keeps of a draft (trimmed, empty lines dropped): compared to tell whether it is saved. */
const tidy = (d: Draft): Draft => ({
  scene: d.scene.trim(),
  narration: d.narration.trim(),
  dialogue: d.dialogue.map((x) => ({ character: x.character, line: x.line.trim() })).filter((x) => x.line),
  visualPrompt: d.visualPrompt.trim(),
  camera: d.camera.trim(),
  characters: d.characters,
});

export function SaveState({ status }: { status: AutosaveStatus }) {
  if (status === "idle") return null;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", status === "error" ? "text-danger" : "text-muted-foreground")} aria-live="polite">
      {status === "saving" || status === "pending" ? (
        <>
          <Loader2 className="size-3 animate-spin" /> {status === "saving" ? "กำลังบันทึก…" : "รอบันทึก…"}
        </>
      ) : status === "saved" ? (
        <>
          <Check className="size-3 text-success" /> บันทึกอัตโนมัติแล้ว
        </>
      ) : (
        <>
          <CloudOff className="size-3" /> บันทึกไม่สำเร็จ จะลองใหม่เมื่อแก้อีกครั้ง
        </>
      )}
    </span>
  );
}

/**
 * One shot of the script / storyboard, every field editable and saved automatically: lines
 * (narration, who says what), the picture (scene, English prompt, camera, who is in it), plus
 * "ให้ AI แก้ช็อตนี้" (AI rewrites the picture from a Thai direction, keeping the user's lines),
 * remake this shot now, move, delete and add a shot after it.
 */
export function ShotEditor({
  p,
  shot,
  onSaved,
  storyboard = true,
  compact = false,
}: {
  p: DramaProject;
  shot: DramaShot;
  onSaved: (d: DramaProject) => void;
  /** show the picture fields open (the storyboard dialog) instead of folded */
  storyboard?: boolean;
  compact?: boolean;
}) {
  const server = draftOf(shot);
  const [draft, setDraft] = useState<Draft>(server);
  // a newer copy from the server (AI rewrite, another tab) replaces the draft only when nothing is unsaved here
  const last = useRef(server);
  const serverKey = JSON.stringify(server);
  useEffect(() => {
    const prev = last.current;
    last.current = JSON.parse(serverKey) as Draft;
    setDraft((d) => (JSON.stringify(tidy(d)) === JSON.stringify(tidy(prev)) ? last.current : d));
  }, [serverKey]);

  const running = Boolean(p.runTarget);
  const [busy, setBusy] = useState<string | null>(null);
  const autosave = useAutosave({
    value: tidy(draft),
    saved: tidy(server),
    save: async (d) =>
      onSaved(
        await api.put<DramaProject>(`/drama/${p.id}/shots/${shot.id}`, {
          ...d,
          narration: d.narration || null,
          camera: d.camera || null,
          scene: d.scene || null,
        }),
      ),
    onError: (err) => toast.error(`บันทึกช็อต ${shot.seq} ไม่สำเร็จ: ${errorText(err)}`),
  });
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const act = async (key: string, fn: () => Promise<DramaProject>, ok?: string) => {
    setBusy(key);
    try {
      await flushDrafts();
      onSaved(await fn());
      if (ok) toast.success(ok);
      return true;
    } catch (err) {
      toast.error(errorText(err));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const [aiOpen, setAiOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [keepLines, setKeepLines] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [addWhat, setAddWhat] = useState("");

  const made = shot.imageStatus === "done" || Boolean(shot.clipUrl);
  const shots = p.shots.filter((s) => s.episodeNo === shot.episodeNo);
  const first = shots[0]?.id === shot.id;
  const lastShot = shots.at(-1)?.id === shot.id;

  return (
    <Card className={cn("p-4", compact && "border-0 p-0 shadow-none")}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="grid size-7 place-items-center rounded-lg bg-muted text-xs font-bold tabular-nums">{shot.seq}</span>
        <Input
          value={draft.scene}
          onChange={(e) => set({ scene: e.target.value })}
          maxLength={255}
          placeholder="ชื่อฉาก"
          aria-label={`ชื่อฉากของช็อต ${shot.seq}`}
          className="h-8 min-w-0 flex-1 border-transparent bg-transparent px-1 font-medium shadow-none hover:border-input focus-visible:border-ring"
        />
        {shot.isProduct && (
          <Badge tone="warning">
            <ShoppingBag className="size-3" /> ไทอินสินค้า
          </Badge>
        )}
        <SaveState status={autosave.status} />
        <div className="flex items-center">
          <Button
            size="sm"
            variant="ghost"
            aria-label="เลื่อนขึ้น"
            disabled={running || first || busy !== null}
            onClick={() =>
              void act("up", () =>
                api.post<DramaProject>(`/drama/${p.id}/shots/${shot.id}/move`, {
                  by: -1,
                }),
              )
            }
          >
            <ArrowUp />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="เลื่อนลง"
            disabled={running || lastShot || busy !== null}
            onClick={() =>
              void act("down", () =>
                api.post<DramaProject>(`/drama/${p.id}/shots/${shot.id}/move`, {
                  by: 1,
                }),
              )
            }
          >
            <ArrowDown />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="ลบช็อต"
            disabled={running || shots.length <= 1 || busy !== null}
            onClick={() => {
              if (window.confirm(`ลบช็อต ${shot.seq}? ภาพ คลิป และเสียงของช็อตนี้จะหายไป`))
                void act("del", () => api.del<DramaProject>(`/drama/${p.id}/shots/${shot.id}`), `ลบช็อต ${shot.seq} แล้ว`);
            }}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">ผู้บรรยาย</Label>
          <Textarea rows={2} value={draft.narration} maxLength={1000} onChange={(e) => set({ narration: e.target.value })} placeholder="(ไม่มีคำบรรยาย)" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">บทพูดตัวละคร</Label>
          {draft.dialogue.map((d, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <NativeSelect
                value={d.character}
                onChange={(e) =>
                  set({
                    dialogue: draft.dialogue.map((x, j) => (j === i ? { ...x, character: e.target.value } : x)),
                  })
                }
                aria-label="ผู้พูด"
                className="h-9 w-28 shrink-0 bg-amber-50 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-100"
              >
                {p.characters.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
              <Input
                value={d.line}
                maxLength={500}
                onChange={(e) =>
                  set({
                    dialogue: draft.dialogue.map((x, j) => (j === i ? { ...x, line: e.target.value } : x)),
                  })
                }
                className="h-9"
              />
              <Button size="sm" variant="ghost" aria-label="ลบบทพูด" onClick={() => set({ dialogue: draft.dialogue.filter((_, j) => j !== i) })}>
                <X />
              </Button>
            </div>
          ))}
          {draft.dialogue.length < 4 && p.characters.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() =>
                set({
                  dialogue: [
                    ...draft.dialogue,
                    {
                      character: draft.characters[0] ?? p.characters[0].key,
                      line: "",
                    },
                  ],
                })
              }
            >
              <Plus /> เพิ่มบทพูด
            </Button>
          )}
        </div>
      </div>

      <details className="mt-3 rounded-lg border border-border/70 p-3" open={storyboard}>
        <summary className="cursor-pointer select-none text-sm font-medium">
          สตอรี่บอร์ด: ภาพและกล้อง
          {made && <span className="ml-2 text-xs font-normal text-muted-foreground">แก้แล้วกด &quot;สร้างช็อตนี้ใหม่&quot; เพื่อใช้ภาพใหม่</span>}
        </summary>
        <div className="mt-3 space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">คำสั่งภาพ (ภาษาอังกฤษดีที่สุด — หรือพิมพ์ไทยแล้วกด &quot;ให้ AI แก้ช็อตนี้&quot;)</Label>
            <Textarea rows={3} value={draft.visualPrompt} maxLength={2000} onChange={(e) => set({ visualPrompt: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">กล้อง</Label>
              <Input
                value={draft.camera}
                maxLength={255}
                onChange={(e) => set({ camera: e.target.value })}
                placeholder="เช่น slow push in, close-up"
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">ตัวละครในภาพ (ตัวแรกใช้หน้าตาเป็นต้นแบบ)</Label>
              <div className="flex flex-wrap gap-1.5">
                {p.characters.map((c) => {
                  const on = draft.characters.includes(c.key);
                  return (
                    <button
                      key={c.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        set({
                          characters: on ? draft.characters.filter((k) => k !== c.key) : [...draft.characters, c.key],
                        })
                      }
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs",
                        on ? "border-rose-500 bg-rose-600 text-white" : "border-border bg-card hover:bg-accent",
                      )}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          {aiOpen && (
            <div className="space-y-2 rounded-lg bg-muted/50 p-3">
              <Label className="text-xs">อยากให้ช็อตนี้เป็นอย่างไร (ภาษาไทยได้)</Label>
              <Textarea
                rows={2}
                value={instruction}
                maxLength={1000}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="เช่น ให้มะลิแอบมองผ่านประตูตอนกลางคืน หน้าตกใจ ฝนตก — เว้นว่าง = ให้ภาพตรงกับบทพูดและเนื้อเรื่อง"
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={keepLines} onChange={(e) => setKeepLines(e.target.checked)} className="size-4 accent-rose-600" />
                ใช้บทพูดและคำบรรยายของฉันตามเดิม (AI แก้เฉพาะภาพ)
              </label>
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setAiOpen(false)}>
                  ยกเลิก
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() =>
                    void act("ai", () => api.post<DramaProject>(`/drama/${p.id}/shots/${shot.id}/rewrite`, { instruction, keepLines }), "AI แก้ช็อตแล้ว").then(
                      (ok) => ok && setAiOpen(false),
                    )
                  }
                >
                  {busy === "ai" ? <Loader2 className="animate-spin" /> : <Sparkles />} แก้บทภาพ
                </Button>
                <Button
                  size="sm"
                  disabled={busy !== null || running}
                  className="bg-gradient-to-r from-rose-600 to-fuchsia-600 text-white"
                  onClick={() =>
                    void act(
                      "ai",
                      () => api.post<DramaProject>(`/drama/${p.id}/shots/${shot.id}/rewrite`, { instruction, keepLines, regenerate: true }),
                      "AI แก้ช็อตแล้ว กำลังสร้างภาพและคลิปใหม่",
                    ).then((ok) => ok && setAiOpen(false))
                  }
                >
                  <Film /> แก้แล้วสร้างใหม่เลย
                </Button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {!aiOpen && (
              <Button size="sm" variant="outline" onClick={() => setAiOpen(true)} disabled={busy !== null}>
                <Sparkles /> ให้ AI แก้ช็อตนี้
              </Button>
            )}
            {made && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null || running}
                onClick={() =>
                  void act(
                    "regen",
                    () =>
                      api.put<DramaProject>(`/drama/${p.id}/shots/${shot.id}`, {
                        ...tidy(draft),
                        narration: draft.narration.trim() || null,
                        regenerate: true,
                      }),
                    `กำลังสร้างภาพและคลิปช็อต ${shot.seq} ใหม่ตามสตอรี่บอร์ด`,
                  )
                }
              >
                {busy === "regen" ? <Loader2 className="animate-spin" /> : <RefreshCw />} สร้างช็อตนี้ใหม่
              </Button>
            )}
          </div>
        </div>
      </details>

      <div className="mt-2">
        {addOpen ? (
          <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
            <Label className="text-xs">ช็อตใหม่ต่อจากช็อต {shot.seq}: เกิดอะไรขึ้น (ภาษาไทยได้ AI จะเขียนภาพให้ต่อเนื่อง)</Label>
            <Textarea rows={2} value={addWhat} maxLength={1000} onChange={(e) => setAddWhat(e.target.value)} placeholder="เช่น ภาพบ้านเก่าจากมุมสูง ฟ้าแลบ" />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setAddOpen(false)}>
                ยกเลิก
              </Button>
              <Button
                size="sm"
                disabled={busy !== null || running || !addWhat.trim()}
                onClick={() =>
                  void act(
                    "add",
                    () =>
                      api.post<DramaProject>(`/drama/${p.id}/shots`, {
                        episode: shot.episodeNo,
                        after: shot.id,
                        instruction: addWhat.trim(),
                      }),
                    "เพิ่มช็อตแล้ว กด ทำออโต้ เพื่อสร้างภาพและคลิป",
                  ).then((ok) => {
                    if (ok) {
                      setAddOpen(false);
                      setAddWhat("");
                    }
                  })
                }
              >
                {busy === "add" ? <Loader2 className="animate-spin" /> : <Plus />} เพิ่มช็อต
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-muted-foreground"
            disabled={running || shots.length >= 40}
            onClick={() => setAddOpen(true)}
          >
            <Plus /> เพิ่มช็อตต่อจากนี้
          </Button>
        )}
      </div>
      {running && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          กำลังทำออโต้: แก้บทได้ตามปกติ (บันทึกอัตโนมัติ) — เพิ่ม ลบ ย้าย หรือสร้างช็อตใหม่ได้หลังหยุดออโต้
        </p>
      )}
    </Card>
  );
}
