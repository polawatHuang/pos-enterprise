"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ExternalLink, ListMusic, Loader2, Search } from "lucide-react";
import { api } from "@/lib/api";
import type { VoiceOption } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";

const GROUPS: { key: VoiceOption["group"]; label: string }[] = [
  { key: "system", label: "เสียงสำเร็จรูปของ MiniMax" },
  { key: "cloned", label: "เสียงที่โคลนไว้" },
  { key: "generated", label: "เสียงที่ออกแบบไว้" },
];
const VOICE_DOCS = "https://platform.minimax.io/docs";

/**
 * MiniMax voice field: type a voice id, or pick one from the account's voice list.
 * Empty = the default voice set in การเชื่อมต่อ API (MINIMAX_VOICE_ID).
 */
export function MinimaxVoicePicker({
  value,
  onChange,
  disabled,
  configured,
  defaultVoiceId,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  configured: boolean;
  defaultVoiceId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const voices = useQuery({
    queryKey: ["videos", "voices", "minimax"],
    queryFn: () => api.get<VoiceOption[]>("/videos/voices?provider=minimax"),
    enabled: configured,
    staleTime: 10 * 60_000,
    retry: false,
    meta: { silent: true },
  });
  const byId = useMemo(() => new Map((voices.data ?? []).map((v) => [v.id, v])), [voices.data]);
  const effective = value || defaultVoiceId || "";
  const current = byId.get(effective);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          disabled={disabled}
          placeholder={defaultVoiceId ? `ค่าเริ่มต้น: ${defaultVoiceId}` : "voice id"}
          aria-label="Voice ID"
          maxLength={100}
          className="font-mono"
        />
        {configured && !voices.isError && (
          <Button type="button" variant="outline" className="shrink-0" disabled={disabled || voices.isPending} onClick={() => setOpen(true)}>
            {voices.isPending ? <Loader2 className="size-4 animate-spin" /> : <ListMusic className="size-4" />} เลือกเสียง
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {current ? (
          <>
            {value ? "" : "ใช้ค่าเริ่มต้น · "}
            {current.name}
            {current.description && ` · ${current.description}`}
          </>
        ) : voices.isError ? (
          <>
            โหลดรายการเสียงไม่ได้ ({voices.error.message}) พิมพ์ voice id เองได้ ·{" "}
            <a href={VOICE_DOCS} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
              ดูรหัสเสียงของ MiniMax <ExternalLink className="size-3" />
            </a>
          </>
        ) : !effective ? (
          'ยังไม่ได้เลือกเสียง: กด "เลือกเสียง" หรือตั้ง MINIMAX_VOICE_ID ที่หน้าการเชื่อมต่อ API'
        ) : voices.data && value ? (
          "ไม่พบรหัสนี้ในบัญชี MiniMax ตรวจตัวสะกดอีกครั้ง"
        ) : null}
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        {open && voices.data && (
          <VoiceList
            voices={voices.data}
            selected={value}
            defaultVoiceId={defaultVoiceId}
            onPick={(id) => {
              onChange(id);
              setOpen(false);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function VoiceList({
  voices,
  selected,
  defaultVoiceId,
  onPick,
}: {
  voices: VoiceOption[];
  selected: string;
  defaultVoiceId: string | null;
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? voices.filter((v) => `${v.id} ${v.name} ${v.description}`.toLowerCase().includes(needle)) : voices;

  return (
    <DialogContent title="เลือกเสียงพากย์ MiniMax" description="ค้นด้วยคำว่า Thai เพื่อหาเสียงภาษาไทย · โคลนเสียงตัวเองได้ที่เว็บ MiniMax" className="max-w-lg">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหาชื่อหรือรหัสเสียง เช่น Thai"
          className="pl-9"
          aria-label="ค้นหาเสียง"
        />
      </div>
      <div className="-mx-1 max-h-[60vh] space-y-3 overflow-y-auto px-1">
        <VoiceRow
          title="ใช้ค่าเริ่มต้นของระบบ"
          detail={defaultVoiceId ? `MINIMAX_VOICE_ID = ${defaultVoiceId}` : "ยังไม่ได้ตั้ง MINIMAX_VOICE_ID"}
          active={!selected}
          onClick={() => onPick("")}
        />
        {GROUPS.map((g) => {
          const list = shown.filter((v) => v.group === g.key);
          if (!list.length) return null;
          return (
            <section key={g.key}>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                {g.label} ({list.length})
              </p>
              <ul className="space-y-1">
                {list.map((v) => (
                  <li key={v.id}>
                    <VoiceRow title={v.name} code={v.id} detail={v.description} active={selected === v.id} onClick={() => onPick(v.id)} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {!shown.length && <p className="py-8 text-center text-sm text-muted-foreground">ไม่พบเสียงที่ตรงกับ &quot;{q}&quot;</p>}
      </div>
    </DialogContent>
  );
}

function VoiceRow({ title, code, detail, active, onClick }: { title: string; code?: string; detail?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted",
        active ? "border-primary bg-primary-soft" : "border-border",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {code && code !== title && <span className="block truncate font-mono text-[11px] text-muted-foreground">{code}</span>}
        {detail && <span className="block text-xs text-muted-foreground">{detail}</span>}
      </span>
      {active && <Check className="mt-0.5 size-4 shrink-0 text-primary" />}
    </button>
  );
}
