"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, CircleHelp, Loader2, Minus, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { ChecklistItem, ChecklistKey, ChecklistStatus, LifecyclePhase, TrendDetail } from "@/lib/types";
import { cn, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label, NativeSelect } from "@/components/ui/primitives";
import { CHECK_STATUS, PHASE_META, PHASES, phaseLabel } from "./labels";

export function PhaseChip({ phase, className }: { phase: LifecyclePhase | null; className?: string }) {
  if (!phase) return null;
  return (
    <Badge tone={PHASE_META[phase].tone} className={cn("whitespace-nowrap", className)} title={PHASE_META[phase].hint}>
      Phase {phase}
    </Badge>
  );
}

/* ------------------------------------------------------- lifecycle curve */

// Bell curve geometry: phases evenly spaced, peak (A) at index 5
const W = 400;
const H = 150;
const BASE = 118;
const X0 = 24;
const STEP = 39;
const PEAK_X = X0 + 5 * STEP;
const SIGMA = 72;
const AMP = 92;
const curveY = (x: number) => BASE - AMP * Math.exp(-((x - PEAK_X) ** 2) / (2 * SIGMA ** 2));
const phaseX = (i: number) => X0 + i * STEP;
const pathBetween = (x1: number, x2: number) => {
  const pts: string[] = [];
  for (let x = x1; x <= x2 + 0.01; x += 3) pts.push(`${x.toFixed(1)},${curveY(x).toFixed(1)}`);
  return pts;
};

/** Where the product sits on the book's 10-phase bell curve; the 2–4 band is the recommended zone. */
export function LifecycleCurve({ phase }: { phase: LifecyclePhase | null }) {
  const idx = phase ? PHASES.indexOf(phase) : -1;
  const line = pathBetween(4, W - 4);
  const zoneFrom = phaseX(1) - STEP / 2;
  const zoneTo = phaseX(3) + STEP / 2;
  const zone = pathBetween(zoneFrom, zoneTo);
  const mx = idx >= 0 ? phaseX(idx) : null;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={phase ? `วงจรชีวิตสินค้า: อยู่ที่ ${phaseLabel(phase)} (ช่วงที่แนะนำคือ Phase 2–4)` : "วงจรชีวิตสินค้า: ยังประเมินไม่ได้"}
    >
      <path d={`M${zone[0].split(",")[0]},${BASE} L${zone.join(" L")} L${zoneTo.toFixed(1)},${BASE} Z`} fill="var(--success-soft)" />
      <text x={(zoneFrom + zoneTo) / 2} y={BASE - 6} textAnchor="middle" fontSize="10" fill="var(--success)" fontWeight="600">
        ช่วงที่แนะนำ
      </text>
      <line x1={4} x2={W - 4} y1={BASE} y2={BASE} stroke="var(--border)" />
      <polyline points={line.join(" ")} fill="none" stroke="var(--muted-foreground)" strokeWidth="2" strokeLinecap="round" />
      <text x={PEAK_X} y={BASE - AMP - 6} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">
        จุดสูงสุด
      </text>
      <text x={phaseX(1)} y={20} fontSize="10" fill="var(--muted-foreground)">
        ขาขึ้น →
      </text>
      <text x={phaseX(8)} y={20} fontSize="10" fill="var(--muted-foreground)" textAnchor="middle">
        → ขาลง
      </text>
      {PHASES.map((p, i) => (
        <text
          key={p}
          x={phaseX(i)}
          y={BASE + 18}
          textAnchor="middle"
          fontSize="11"
          fontWeight={i === idx ? 700 : 400}
          fill={i === idx ? "var(--foreground)" : "var(--muted-foreground)"}
        >
          {p}
        </text>
      ))}
      {mx != null && (
        <g>
          <line x1={mx} x2={mx} y1={curveY(mx)} y2={BASE} stroke="var(--foreground)" strokeDasharray="3 3" />
          <circle cx={mx} cy={curveY(mx)} r="6" fill="var(--primary)" stroke="var(--card)" strokeWidth="2" />
        </g>
      )}
    </svg>
  );
}

export function LifecycleSection({ t, canEdit }: { t: TrendDetail; canEdit: boolean }) {
  const notes = t.phaseNotes;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">วงจรชีวิตสินค้า</h3>
        {t.phase ? (
          <Badge tone={PHASE_META[t.phase].tone}>{phaseLabel(t.phase)}</Badge>
        ) : (
          <Badge tone="neutral">ยังประเมินไม่ได้</Badge>
        )}
      </div>
      <div className="rounded-xl border border-border p-3">
        <LifecycleCurve phase={t.phase} />
        {t.phase && <p className="mt-1 text-xs text-muted-foreground">{PHASE_META[t.phase].hint}</p>}
        {notes?.reasons?.length ? (
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {notes.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        ) : null}
        {notes?.confidence && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            ความมั่นใจ: {{ high: "สูง", medium: "ปานกลาง", low: "ต่ำ" }[notes.confidence]} · เป็นการประมาณคร่าว ๆ ไม่มีสูตรตายตัว
          </p>
        )}
      </div>
      <BenchmarkEditor t={t} canEdit={canEdit} />
    </section>
  );
}

function BenchmarkEditor({ t, canEdit }: { t: TrendDetail; canEdit: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(t.benchmark ? String(t.benchmark.peak) : "");
  const [busy, setBusy] = useState(false);
  if (!t.category) {
    return <p className="text-xs text-muted-foreground">ใส่หมวดหมู่ของสินค้าในแบบฟอร์มเช็กลิสต์ด้านล่าง เพื่อเทียบกับยอดขายสูงสุดของหมวด</p>;
  }
  const save = async (peakSold: number | null) => {
    setBusy(true);
    try {
      await api.put("/scraping/benchmarks", { platform: t.platform, category: t.category, peakSold });
      await qc.invalidateQueries({ queryKey: ["trends"] });
      setEditing(false);
      toast.success(peakSold == null ? "กลับไปคำนวณอัตโนมัติแล้ว" : "บันทึกยอดสูงสุดของหมวดแล้ว");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-xl bg-muted/50 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1">
          ยอดขายสูงสุดของหมวด <span className="font-medium">{t.category}</span>:{" "}
          {t.benchmark ? (
            <>
              <span className="font-semibold tabular-nums">{formatNumber(t.benchmark.peak)}</span> ชิ้น{" "}
              <span className="text-xs text-muted-foreground">({t.benchmark.source === "manual" ? "กรอกเอง" : "คำนวณจากอันดับ 1–2 ที่ระบบเก็บได้"})</span>
            </>
          ) : (
            <span className="text-muted-foreground">ยังไม่มี (ต้องมีสินค้าในหมวดอย่างน้อย 3 รายการ หรือกรอกเอง)</span>
          )}
        </p>
        {canEdit && !editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil /> แก้
          </Button>
        )}
      </div>
      {editing && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(value.replace(/,/g, ""));
            if (!Number.isFinite(n) || n < 1) return toast.error("กรอกจำนวนชิ้นมากกว่า 0");
            void save(Math.round(n));
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="peak">ยอดขายเฉลี่ยของอันดับ 1–2 ในหมวด (ชิ้น)</Label>
            <Input id="peak" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="เช่น 100000" />
          </div>
          <Button size="sm" type="submit" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />} บันทึก
          </Button>
          {t.benchmark?.source === "manual" && (
            <Button size="sm" type="button" variant="outline" disabled={busy} onClick={() => void save(null)}>
              ใช้ค่าอัตโนมัติ
            </Button>
          )}
          <Button size="sm" type="button" variant="ghost" onClick={() => setEditing(false)}>
            ยกเลิก
          </Button>
        </form>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">ดูได้จากหน้า &quot;สินค้ายอดนิยม&quot; ของหมวดในแอป — สินค้าที่ขายได้ราว 25–35% ของตัวเลขนี้อยู่ใน Phase 3</p>
    </div>
  );
}

/* ---------------------------------------------------------------- checklist */

const STATUS_ICON: Record<ChecklistStatus, React.ReactNode> = {
  pass: <Check className="size-3.5" />,
  partial: <Minus className="size-3.5" />,
  fail: <X className="size-3.5" />,
  unknown: <CircleHelp className="size-3.5" />,
};

type FactKey =
  | "category"
  | "categoryRank"
  | "monthlySold"
  | "prevMonthlySold"
  | "rating"
  | "reviewCount"
  | "mediaReviewCount"
  | "positiveReviewPct"
  | "shopRating"
  | "shopResponseRate"
  | "shopShip48Rate"
  | "commissionRate";

const FACTS: { key: FactKey; label: string; hint?: string; text?: boolean }[] = [
  { key: "category", label: "หมวดหมู่", text: true },
  { key: "categoryRank", label: "อันดับในหมวด", hint: "จากหน้าสินค้ายอดนิยม" },
  { key: "monthlySold", label: "ขายเดือนที่แล้ว (ชิ้น)" },
  { key: "prevMonthlySold", label: "ขายเดือนก่อนหน้า (ชิ้น)" },
  { key: "rating", label: "ดาวสินค้า (0–5)" },
  { key: "reviewCount", label: "จำนวนรีวิว" },
  { key: "mediaReviewCount", label: "รีวิวที่มีรูป/วิดีโอ" },
  { key: "positiveReviewPct", label: "รีวิว 4–5 ดาว (%)" },
  { key: "shopRating", label: "คะแนนร้าน (0–5)" },
  { key: "shopResponseRate", label: "อัตราตอบกลับแชต (%)" },
  { key: "shopShip48Rate", label: "จัดส่งภายใน 48 ชม. (%)" },
  { key: "commissionRate", label: "ค่าคอมมิชชัน (%)" },
];

export function ChecklistSection({ t, canEdit }: { t: TrendDetail; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          เช็กลิสต์เลือกสินค้า{" "}
          <span className="tabular-nums text-muted-foreground">
            {t.checklistPassed ?? 0}/{t.checklist.length || 9}
          </span>
        </h3>
        {canEdit && !editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil /> กรอกข้อมูลร้าน/รีวิว
          </Button>
        )}
      </div>
      {editing ? <ChecklistForm t={t} onDone={() => setEditing(false)} /> : <ChecklistList items={t.checklist} />}
    </section>
  );
}

function ChecklistList({ items }: { items: ChecklistItem[] }) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border text-sm">
      {items.map((c) => (
        <li key={c.key} className="flex items-center gap-2 px-3 py-2">
          <span className="min-w-0 flex-1">{c.label}</span>
          {c.manual && <span className="text-[10px] text-muted-foreground">ตรวจเอง</span>}
          <Badge tone={CHECK_STATUS[c.status].tone} className="shrink-0">
            {STATUS_ICON[c.status]} {CHECK_STATUS[c.status].label}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

const MANUAL_KEYS: { key: Exclude<ChecklistKey, "phase">; label: string }[] = [
  { key: "positiveReviews", label: "รีวิวเชิงบวก" },
  { key: "mediaReviews", label: "มีรีวิวภาพ/วิดีโอจริง" },
  { key: "flashSale", label: "มีแฟลชเซลต่อเนื่อง" },
];

function ChecklistForm({ t, onDone }: { t: TrendDetail; onDone: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [vals, setVals] = useState<Record<FactKey, string>>(
    () => Object.fromEntries(FACTS.map((f) => [f.key, t[f.key] == null ? "" : String(t[f.key])])) as Record<FactKey, string>,
  );
  const [flash, setFlash] = useState(t.hasFlashSale == null ? "" : t.hasFlashSale ? "1" : "0");
  const [manual, setManual] = useState<Record<string, string>>(() =>
    Object.fromEntries(MANUAL_KEYS.map((m) => [m.key, t.manualChecks[m.key] == null ? "" : t.manualChecks[m.key] ? "1" : "0"])),
  );

  const submit = async () => {
    const body: Record<string, unknown> = {};
    for (const f of FACTS) {
      const raw = vals[f.key].trim();
      if (f.text) body[f.key] = raw || null;
      else {
        const n = raw === "" ? null : Number(raw.replace(/[,%]/g, ""));
        if (n != null && !Number.isFinite(n)) return toast.error(`${f.label}: ต้องเป็นตัวเลข`);
        body[f.key] = n;
      }
    }
    body.hasFlashSale = flash === "" ? null : flash === "1";
    body.manualChecks = Object.fromEntries(Object.entries(manual).map(([k, v]) => [k, v === "" ? null : v === "1"]));
    setBusy(true);
    try {
      await api.patch(`/scraping/trends/${t.id}`, body);
      await qc.invalidateQueries({ queryKey: ["trends"] });
      toast.success("อัปเดตเช็กลิสต์และคะแนนแล้ว");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-4 rounded-xl border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-xs text-muted-foreground">
        ข้อมูลเหล่านี้ API ส่วนใหญ่ไม่ให้มา ดูได้จากหน้าสินค้าและหน้าร้านในแอป เว้นว่างไว้ถ้ายังไม่รู้ — ถ้ามีหลายสินค้า กรอกรวมในไฟล์ CSV แล้วกด &quot;นำเข้า CSV&quot;
        (มีไฟล์ตัวอย่างให้ดาวน์โหลด)
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {FACTS.map((f) => (
          <div key={f.key} className="flex flex-col gap-1.5">
            <Label htmlFor={`f-${f.key}`}>{f.label}</Label>
            <Input
              id={`f-${f.key}`}
              inputMode={f.text ? undefined : "decimal"}
              value={vals[f.key]}
              placeholder={f.hint}
              onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          </div>
        ))}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-flash">แฟลชเซล</Label>
          <NativeSelect id="f-flash" value={flash} onChange={(e) => setFlash(e.target.value)}>
            <option value="">ไม่ทราบ</option>
            <option value="1">มี</option>
            <option value="0">ไม่มี</option>
          </NativeSelect>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">ข้อที่ตรวจเองจากหน้าสินค้า (มีผลเหนือข้อมูลด้านบน)</p>
        {MANUAL_KEYS.map((m) => (
          <div key={m.key} className="flex flex-wrap items-center gap-2 text-sm">
            <Label htmlFor={`m-${m.key}`} className="min-w-0 flex-1">
              {m.label}
            </Label>
            <NativeSelect id={`m-${m.key}`} className="w-auto" value={manual[m.key]} onChange={(e) => setManual((v) => ({ ...v, [m.key]: e.target.value }))}>
              <option value="">ตามข้อมูล</option>
              <option value="1">ผ่าน</option>
              <option value="0">ไม่ผ่าน</option>
            </NativeSelect>
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          ยกเลิก
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Check />} บันทึกและคำนวณใหม่
        </Button>
      </div>
    </form>
  );
}
