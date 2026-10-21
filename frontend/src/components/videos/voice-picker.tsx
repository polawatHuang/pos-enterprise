"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, ExternalLink, Loader2, Mic, Search } from "lucide-react";
import { api, ApiError } from "@/lib/api";
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
const isThai = (v: VoiceOption) => /thai|ไทย/i.test(`${v.id} ${v.name} ${v.description}`);

/** Why the list could not load, in words the shop owner can act on. */
function listError(err: Error) {
  if (err instanceof ApiError && err.code === "ROUTE_NOT_FOUND") return "backend ยังเป็นเวอร์ชันเก่า: deploy backend จาก main แล้วกด Restart App";
  if (err instanceof ApiError && err.code === "INTEGRATION_NOT_CONFIGURED") return "ยังไม่ได้ตั้ง MINIMAX_API_KEY";
  return `โหลดรายการเสียงไม่ได้ (${err.message})`;
}

/**
 * MiniMax voice field: a select-style button that opens the account's voice list.
 * Typing an id is the fallback when the list cannot load (or from the bottom of the list).
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

  if (!configured || voices.isError) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          disabled={disabled}
          placeholder={defaultVoiceId ? `ค่าเริ่มต้น: ${defaultVoiceId}` : "voice id"}
          aria-label="Voice ID"
          maxLength={100}
          className="font-mono"
        />
        <p className="text-[11px] text-muted-foreground">
          {!configured ? "ยังไม่ได้ตั้ง MINIMAX_API_KEY" : listError(voices.error!)} ·{" "}
          {!configured || (voices.error instanceof ApiError && voices.error.code === "INTEGRATION_NOT_CONFIGURED") ? (
            <Link href="/settings/integrations" className="text-primary hover:underline">
              ไปหน้าการเชื่อมต่อ API
            </Link>
          ) : (
            <a href={VOICE_DOCS} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
              หรือพิมพ์รหัสจากเอกสาร MiniMax <ExternalLink className="size-3" />
            </a>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled || voices.isPending}
        aria-label="เลือกเสียงพากย์"
        className="flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm shadow-xs transition-colors hover:bg-muted focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {voices.isPending ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Mic className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className={cn("min-w-0 flex-1 truncate", !effective && "text-muted-foreground")}>
          {voices.isPending
            ? "กำลังโหลดรายการเสียง…"
            : current
              ? `${current.name}${value ? "" : " (ค่าเริ่มต้น)"}`
              : effective
                ? `${effective}${value ? "" : " (ค่าเริ่มต้น)"}`
                : "เลือกเสียงพากย์…"}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {current?.description ? (
        <p className="truncate text-[11px] text-muted-foreground">{current.description}</p>
      ) : effective && voices.data && !current ? (
        <p className="text-[11px] text-warning">ไม่พบรหัส {effective} ในบัญชี MiniMax ลองเลือกเสียงใหม่</p>
      ) : null}
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
  const [manual, setManual] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? voices.filter((v) => `${v.id} ${v.name} ${v.description}`.toLowerCase().includes(needle)) : voices;
  // Thai voices first: this is a Thai shop and MiniMax lists hundreds of voices
  const sections = [
    { key: "thai", label: "แนะนำ: เสียงภาษาไทย", list: shown.filter(isThai) },
    ...GROUPS.map((g) => ({ key: g.key, label: g.label, list: shown.filter((v) => v.group === g.key && !isThai(v)) })),
  ];

  return (
    <DialogContent
      title="เลือกเสียงพากย์"
      description="รายการเสียงทั้งหมดในบัญชี MiniMax ของร้าน · โคลนเสียงตัวเองได้ที่เว็บ MiniMax แล้วจะขึ้นในรายการนี้"
      className="max-w-lg"
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อเสียง" className="pl-9" aria-label="ค้นหาเสียง" />
      </div>
      <div className="-mx-1 max-h-[55vh] space-y-3 overflow-y-auto px-1">
        {defaultVoiceId && !needle && (
          <VoiceRow title="ใช้เสียงเริ่มต้นของร้าน" detail={byName(voices, defaultVoiceId)} active={!selected} onClick={() => onPick("")} />
        )}
        {sections.map((g) =>
          g.list.length ? (
            <section key={g.key}>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                {g.label} ({g.list.length})
              </p>
              <ul className="space-y-1">
                {g.list.map((v) => (
                  <li key={v.id}>
                    <VoiceRow title={v.name} code={v.id} detail={v.description} active={selected === v.id} onClick={() => onPick(v.id)} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null,
        )}
        {!shown.length && <p className="py-8 text-center text-sm text-muted-foreground">ไม่พบเสียงที่ตรงกับ &quot;{q}&quot;</p>}
      </div>
      <form
        className="flex gap-2 border-t border-border pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) onPick(manual.trim());
        }}
      >
        <Input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="หรือใส่รหัสเสียงเอง (voice id)"
          className="h-9 font-mono text-xs"
          maxLength={100}
          aria-label="ใส่รหัสเสียงเอง"
        />
        <Button type="submit" size="sm" variant="outline" disabled={!manual.trim()}>
          ใช้รหัสนี้
        </Button>
      </form>
    </DialogContent>
  );
}

const byName = (voices: VoiceOption[], id: string) => {
  const v = voices.find((x) => x.id === id);
  return v ? `${v.name} (${id})` : id;
};

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
