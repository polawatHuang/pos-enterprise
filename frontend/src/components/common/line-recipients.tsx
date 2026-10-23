"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";

export interface LineTarget {
  id: string;
  name: string;
}

const LINE_ID = /^[UCR][0-9a-f]{32}$/;

/**
 * Who receives LINE OA pushes: people who chatted with the shop's OA (pick yourself after sending
 * it one message), or a pasted userId / groupId.
 */
export function LineRecipients({ targets, value, onChange }: { targets: LineTarget[]; value: string[]; onChange: (to: string[]) => void }) {
  const [manual, setManual] = useState("");
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="space-y-2">
      {targets.length ? (
        <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
          {targets.map((t) => (
            <li key={t.id}>
              <label className="flex min-h-10 items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent">
                <input type="checkbox" checked={value.includes(t.id)} onChange={() => toggle(t.id)} className="size-4" />
                <span className="min-w-0 truncate">{t.name}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">{t.id.slice(0, 9)}…</span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">แอดเพื่อน LINE OA ของร้าน แล้วพิมพ์ทักมา 1 ครั้ง ชื่อจะขึ้นที่นี่ให้เลือก</p>
      )}
      <div className="flex gap-2">
        <Input value={manual} onChange={(e) => setManual(e.target.value.trim())} placeholder="หรือใส่ LINE userId / groupId (U… / C…)" className="h-10 min-w-0 font-mono text-xs" />
        <Button
          variant="outline"
          className="h-10"
          disabled={!LINE_ID.test(manual)}
          onClick={() => {
            if (!value.includes(manual)) onChange([...value, manual]);
            setManual("");
          }}
        >
          เพิ่ม
        </Button>
      </div>
      {value
        .filter((id) => !targets.some((t) => t.id === id))
        .map((id) => (
          <p key={id} className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-1.5 font-mono text-xs">
            <span className="min-w-0 truncate">{id}</span>
            <button className="min-h-8 shrink-0 text-danger" onClick={() => toggle(id)}>
              เอาออก
            </button>
          </p>
        ))}
    </div>
  );
}
