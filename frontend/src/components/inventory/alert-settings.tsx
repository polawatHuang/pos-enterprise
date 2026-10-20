"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { NotifySettings } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";

/** LINE OA alerts: who receives them and when the morning digest goes out. */
export function AlertSettingsDialog({ onDone }: { onDone: () => void }) {
  const settings = useQuery({ queryKey: ["notifications", "settings"], queryFn: () => api.get<NotifySettings>("/notifications/settings") });
  if (!settings.data) return <DialogContent title="ตั้งค่าแจ้งเตือนสต๊อก"><Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" /></DialogContent>;
  return <Form initial={settings.data} onDone={onDone} />;
}

function Form({ initial, onDone }: { initial: NotifySettings; onDone: () => void }) {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(initial.line.enabled);
  const [to, setTo] = useState<string[]>(initial.line.to);
  const [manual, setManual] = useState("");
  const [time, setTime] = useState(initial.line.digestTime);
  const [busy, setBusy] = useState<"save" | "test" | "check" | null>(null);
  const toggle = (id: string) => setTo((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));

  const save = async () => {
    setBusy("save");
    try {
      await api.put("/notifications/settings", { line: { enabled, to, digestTime: time } });
      await qc.invalidateQueries({ queryKey: ["notifications", "settings"] });
      toast.success("บันทึกการแจ้งเตือนแล้ว");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };
  const test = async () => {
    setBusy("test");
    try {
      await api.put("/notifications/settings", { line: { enabled, to, digestTime: time } });
      await api.post("/notifications/test-line");
      toast.success("ส่งข้อความทดสอบแล้ว ตรวจใน LINE");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ส่งไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };
  const check = async () => {
    setBusy("check");
    try {
      const r = await api.post<{ out: number; low: number; slow: number }>("/notifications/check-stock");
      toast.success(`ตรวจแล้ว: หมด ${r.out} · ใกล้หมด ${r.low} · ขายไม่ออก ${r.slow} รายการ`);
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ตรวจไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };

  return (
    <DialogContent title="ตั้งค่าแจ้งเตือนสต๊อก" description="ระบบตรวจทุกชั่วโมง: แจ้งในแอป (กระดิ่ง) ทันที และส่ง LINE เมื่อของหมด + สรุปทุกเช้า" className="max-w-lg">
      <div className="grid gap-4">
        <label className="flex items-center gap-3 rounded-xl border border-border p-3">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-4" />
          <span className="flex-1 text-sm">
            <span className="block font-medium">ส่งแจ้งเตือนทาง LINE OA</span>
            <span className="text-xs text-muted-foreground">ใช้ LINE OA ที่เชื่อมไว้ในหน้า Inbox (นับโควตาข้อความ push ของ OA)</span>
          </span>
        </label>
        <div className="space-y-2">
          <Label>ผู้รับ</Label>
          {initial.lineTargets.length ? (
            <ul className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
              {initial.lineTargets.map((t) => (
                <li key={t.id}>
                  <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent">
                    <input type="checkbox" checked={to.includes(t.id)} onChange={() => toggle(t.id)} />
                    {t.name}
                    <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">{t.id.slice(0, 9)}…</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">ให้ผู้จัดการทักแชต LINE OA ของร้าน 1 ครั้ง แล้วชื่อจะขึ้นที่นี่ให้เลือก</p>
          )}
          <div className="flex gap-2">
            <Input value={manual} onChange={(e) => setManual(e.target.value.trim())} placeholder="หรือใส่ LINE userId / groupId (U… / C…)" className="h-9 font-mono text-xs" />
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              disabled={!/^[UCR][0-9a-f]{32}$/.test(manual)}
              onClick={() => {
                setTo((t) => (t.includes(manual) ? t : [...t, manual]));
                setManual("");
              }}
            >
              เพิ่ม
            </Button>
          </div>
          {to.filter((id) => !initial.lineTargets.some((t) => t.id === id)).map((id) => (
            <p key={id} className="flex items-center justify-between rounded-lg bg-muted px-3 py-1.5 font-mono text-xs">
              {id}
              <button className="text-danger" onClick={() => toggle(id)}>
                เอาออก
              </button>
            </p>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Label htmlFor="digest">ส่งสรุปสต๊อกทุกวันเวลา</Label>
          <Input id="digest" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-9 w-28" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" onClick={check} disabled={busy !== null}>
            {busy === "check" ? <Loader2 className="animate-spin" /> : <BellRing />} ตรวจตอนนี้
          </Button>
          <Button variant="outline" onClick={test} disabled={busy !== null || !to.length}>
            {busy === "test" ? <Loader2 className="animate-spin" /> : <Send />} ส่งทดสอบ
          </Button>
          <Button onClick={save} disabled={busy !== null}>
            {busy === "save" && <Loader2 className="animate-spin" />}
            บันทึก
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}
