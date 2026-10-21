"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed, ExternalLink, KeyRound, Loader2, PlugZap, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { IntegrationEnv, IntegrationStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Skeleton } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { PageHeader } from "@/components/layout/page";

const CATEGORY_LABEL: Record<string, string> = {
  ai: "AI",
  social: "โซเชียล",
  commerce: "มาร์เก็ตเพลส",
  chat: "แชต",
  video: "วิดีโอ AI",
  storage: "พื้นที่เก็บไฟล์",
};

export function IntegrationsStatus() {
  const { data, isPending } = useQuery({
    queryKey: ["integrations", "status"],
    queryFn: () => api.get<IntegrationStatus[]>("/integrations/status"),
  });
  const configured = data?.filter((d) => d.configured).length ?? 0;
  const [editing, setEditing] = useState<string | null>(null);
  const current = data?.find((d) => d.id === editing);

  return (
    <>
      <PageHeader
        title="การเชื่อมต่อ API"
        description="ตั้งคีย์ได้จากหน้านี้ (เข้ารหัสเก็บในฐานข้อมูล) หรือผ่าน environment variables บนเซิร์ฟเวอร์ — ค่าที่ตั้งจากหน้านี้ใช้ก่อน และระบบไม่แสดงค่าคีย์เต็ม"
        actions={data && <Badge tone={configured === data.length ? "success" : "warning"}>{configured}/{data.length} พร้อมใช้งาน</Badge>}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {isPending
          ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)
          : data?.map((it) => (
              <Card key={it.id} className="flex flex-col p-5">
                <div className="flex items-start gap-3">
                  {it.configured ? (
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
                  ) : (
                    <CircleDashed className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0">
                    <h2 className="font-semibold leading-tight">{it.name}</h2>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Badge>{CATEGORY_LABEL[it.category] ?? it.category}</Badge>
                      {it.available === false && <Badge tone="warning">ยังไม่เปิดใช้งาน</Badge>}
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{it.purpose}</p>
                {it.available === false && (
                  <p className="mt-2 rounded-lg bg-warning-soft px-2.5 py-2 text-xs text-warning">
                    ระบบยังไม่ได้เชื่อม API นี้ (รอสิทธิ์ Partner API ของแพลตฟอร์ม) — ใส่คีย์ไว้ก่อนได้ แต่ยังไม่มีฟีเจอร์ที่ใช้งาน
                  </p>
                )}
                <ul className="mt-3 space-y-1">
                  {it.env.map((e) => (
                    <li key={e.name} className="flex items-center gap-2 font-mono text-[11px]">
                      <span className={e.set ? "text-success" : e.optional ? "text-muted-foreground" : "text-danger"}>{e.set ? "●" : "○"}</span>
                      {e.name}
                      {e.optional && <span className="font-sans text-muted-foreground">(ไม่บังคับ)</span>}
                      {e.source === "db" && <span className="font-sans text-primary">· จากหน้าเว็บ</span>}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                  <a href={it.applyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                    ขอ API key <ExternalLink className="size-3.5" />
                  </a>
                  <Button size="sm" variant="outline" onClick={() => setEditing(it.id)}>
                    <KeyRound className="size-4" /> ตั้งค่า
                  </Button>
                </div>
              </Card>
            ))}
      </div>
      <Dialog open={Boolean(current)} onOpenChange={(o) => !o && setEditing(null)}>
        {current && <ConfigDialog key={current.id} integration={current} onClose={() => setEditing(null)} />}
      </Dialog>
    </>
  );
}


function sourceLabel(e: IntegrationEnv) {
  if (e.source === "db") return { text: "จากหน้าเว็บ", cls: "bg-primary-soft text-primary" };
  if (e.source === "env") return { text: "จาก .env", cls: "bg-success-soft text-success" };
  return { text: "ยังไม่ตั้ง", cls: e.optional ? "bg-muted text-muted-foreground" : "bg-danger-soft text-danger" };
}

function ConfigDialog({ integration, onClose }: { integration: IntegrationStatus; onClose: () => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reset, setReset] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"save" | "test" | null>(null);

  const changes: Record<string, string | null> = {};
  for (const [name, v] of Object.entries(draft)) if (v.trim()) changes[name] = v.trim();
  for (const name of reset) changes[name] = null;
  const dirty = Object.keys(changes).length > 0;

  const save = async () => {
    setBusy("save");
    try {
      await api.put("/integrations/config", { values: changes });
      await qc.invalidateQueries({ queryKey: ["integrations"] });
      toast.success("บันทึกคีย์แล้ว มีผลทันที");
      setDraft({});
      setReset(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    try {
      const r = await api.post<{ ms: number; detail: string | null }>(`/integrations/${integration.id}/test`);
      toast.success(`เชื่อมต่อ ${integration.name} สำเร็จ (${r.ms} ms)`, r.detail ? { description: r.detail } : undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ทดสอบไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };

  return (
    <DialogContent title={`ตั้งค่า ${integration.name}`} description="เว้นว่างช่องที่ไม่ต้องการเปลี่ยน · ค่าที่บันทึกจากหน้านี้ใช้แทนค่าใน .env" className="max-w-xl">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) void save();
        }}
      >
        {integration.env.map((e) => {
          const label = sourceLabel(e);
          const resetting = reset.has(e.name);
          const placeholder = resetting
            ? "จะกลับไปใช้ค่าจาก .env"
            : e.hint
              ? e.secret
                ? `${e.hint} — พิมพ์เพื่อเปลี่ยน`
                : e.hint
              : (e.default ?? (e.optional ? "ไม่บังคับ" : "ยังไม่ได้ตั้ง"));
          return (
            <div key={e.name}>
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <label htmlFor={`cfg-${e.name}`} className="font-mono text-xs font-medium">
                  {e.name}
                </label>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", label.cls)}>{label.text}</span>
                {e.source === "db" && (
                  <button
                    type="button"
                    onClick={() =>
                      setReset((s) => {
                        const n = new Set(s);
                        if (n.has(e.name)) n.delete(e.name);
                        else n.add(e.name);
                        return n;
                      })
                    }
                    className={cn("ml-auto inline-flex items-center gap-1 text-xs hover:underline", resetting ? "text-danger" : "text-muted-foreground")}
                  >
                    <RotateCcw className="size-3" />
                    {resetting ? "ยกเลิก" : e.envDefault ? "ใช้ค่าจาก .env" : "ลบค่าที่ตั้งไว้"}
                  </button>
                )}
              </div>
              <Input
                id={`cfg-${e.name}`}
                type={e.secret ? "password" : "text"}
                autoComplete="off"
                spellCheck={false}
                disabled={resetting}
                value={draft[e.name] ?? ""}
                placeholder={placeholder}
                onChange={(ev) => setDraft((d) => ({ ...d, [e.name]: ev.target.value }))}
                className="font-mono text-sm"
              />
            </div>
          );
        })}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          {integration.testable && (
            <Button type="button" variant="outline" onClick={test} disabled={busy !== null || dirty || !integration.configured} className="mr-auto">
              {busy === "test" ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />} ทดสอบการเชื่อมต่อ
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose} disabled={busy !== null}>
            ปิด
          </Button>
          <Button type="submit" disabled={!dirty || busy !== null}>
            {busy === "save" && <Loader2 className="size-4 animate-spin" />} บันทึก
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
