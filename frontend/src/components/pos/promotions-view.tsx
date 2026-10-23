"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgePercent, Clock, Layers, Loader2, Pencil, Plus, Power, Store, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Branch, Promotion, PromotionDiscountType, PromotionKind } from "@/lib/types";
import { cn, formatMoney, formatNumber, formatThaiDate } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Label, Segmented, Skeleton } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { PageHeader } from "@/components/layout/page";
import { ErrorNote } from "@/components/dashboard/widgets";
import { ProductPicker } from "@/components/common/product-picker";
import { useCategories } from "@/components/products/product-form";

const PROMOS_KEY = ["pos", "promotions"] as const;

export const KIND: Record<PromotionKind, { label: string; hint: string; icon: typeof Clock }> = {
  time_discount: { label: "ลดราคาตามช่วงเวลา", hint: "สินค้า/หมวดที่เลือกถูกลงในวันและเวลาที่กำหนด เช่น เบเกอรี่ลด 30% หลัง 20:00", icon: Clock },
  multi_buy: { label: "ซื้อหลายชิ้นถูกกว่า", hint: "ซื้อครบจำนวนจากกลุ่มสินค้า (คละได้) ได้ราคาพิเศษ เช่น 2 ชิ้น 39 บาท", icon: Layers },
  bundle: { label: "ซื้อคู่ราคาพิเศษ", hint: "ซื้อสินค้า A คู่กับ B ได้ราคาพิเศษ เช่น กาแฟ + ครัวซองต์ 59 บาท", icon: BadgePercent },
};
const STATUS: Record<Promotion["status"], { label: string; tone: "success" | "primary" | "neutral" | "danger" }> = {
  running: { label: "กำลังใช้", tone: "success" },
  scheduled: { label: "ตั้งเวลาไว้", tone: "primary" },
  ended: { label: "หมดอายุ", tone: "danger" },
  off: { label: "ปิดอยู่", tone: "neutral" },
};
const DAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

function daysText(mask: number) {
  if (mask === 127) return "ทุกวัน";
  if (mask === 0b0111110) return "จันทร์–ศุกร์";
  if (mask === 0b1000001) return "เสาร์–อาทิตย์";
  return DAYS.filter((_, i) => mask & (1 << i)).join(" ");
}
function scheduleText(p: Pick<Promotion, "startsOn" | "endsOn" | "daysMask" | "timeFrom" | "timeTo">) {
  const parts = [daysText(p.daysMask), p.timeFrom && p.timeTo ? `${p.timeFrom}–${p.timeTo} น.` : "ทั้งวัน"];
  if (p.startsOn || p.endsOn) parts.push(`${p.startsOn ? formatThaiDate(p.startsOn) : "วันนี้"} – ${p.endsOn ? formatThaiDate(p.endsOn) : "ไม่กำหนด"}`);
  return parts.join(" · ");
}
const slotText = (s: Promotion["slots"][number]) => [...s.categories.map((c) => `หมวด${c.name}`), ...s.products.map((p) => p.name)].join(", ") || "–";

export function PromotionsView() {
  const { can } = useAuth();
  const manage = can("pos:manage");
  const promos = useQuery({ queryKey: PROMOS_KEY, queryFn: () => api.get<Promotion[]>("/pos/promotions") });
  const [editing, setEditing] = useState<Promotion | "new" | null>(null);
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: PROMOS_KEY });
    void qc.invalidateQueries({ queryKey: ["pos", "catalog"] });
    void qc.invalidateQueries({ queryKey: ["pos", "quote"] });
  };

  const toggle = async (p: Promotion) => {
    try {
      await api.patch(`/pos/promotions/${p.id}`, { isActive: !p.isActive });
      toast.success(p.isActive ? `ปิดโปร "${p.name}" แล้ว` : `เปิดโปร "${p.name}" แล้ว`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    }
  };
  const remove = async (p: Promotion) => {
    if (!window.confirm(`ลบโปร "${p.name}"?`)) return;
    try {
      await api.del(`/pos/promotions/${p.id}`);
      toast.success("ลบโปรโมชั่นแล้ว");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ลบไม่สำเร็จ", { duration: 8000 });
    }
  };

  const list = promos.data ?? [];
  const order: Promotion["status"][] = ["running", "scheduled", "off", "ended"];
  const sorted = [...list].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));

  return (
    <>
      <PageHeader
        title="โปรโมชั่น"
        description="ลดราคาตามช่วงเวลา ซื้อหลายชิ้นถูกกว่า และซื้อคู่ราคาพิเศษ — แต่ละสาขาตั้งโปรของตัวเองได้ · ลดซ้อนกันเป็นชั้น: ลดตามเวลา → ลดใกล้หมดอายุ → ราคาชุด/ซื้อคู่ (คิดจากราคาที่ลดแล้ว) → ส่วนลดท้ายบิล/โค้ด/แต้ม"
        actions={
          manage && (
            <Button onClick={() => setEditing("new")} className="w-full sm:w-auto">
              <Plus className="size-4" /> สร้างโปรโมชั่น
            </Button>
          )
        }
      />
      {promos.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : promos.isError ? (
        <Card>
          <ErrorNote error={promos.error} onRetry={() => promos.refetch()} />
        </Card>
      ) : !list.length ? (
        <Card className="grid place-items-center gap-3 p-10 text-center">
          <BadgePercent className="size-10 text-muted-foreground" />
          <p className="font-medium">ยังไม่มีโปรโมชั่น</p>
          <p className="max-w-md text-sm text-muted-foreground">ลองสร้าง &quot;2 ชิ้น 39 บาท&quot; หรือ &quot;เบเกอรี่ลด 30% หลัง 20:00&quot; — ป้ายโปรจะขึ้นบนหน้าขาย และระบบแนะนำให้พนักงานชวนลูกค้าซื้อเพิ่ม</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((p) => {
            const K = KIND[p.kind];
            return (
              <Card key={p.id} className={cn("flex flex-col p-5", (p.status === "off" || p.status === "ended") && "opacity-70")}>
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-danger-soft text-danger">
                    <K.icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold leading-tight">{p.name}</h2>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
                      <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-semibold text-white">{p.label}</span>
                    </div>
                  </div>
                </div>
                <dl className="mt-3 space-y-1.5 text-sm">
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0 text-muted-foreground">{p.kind === "bundle" ? "A" : "สินค้า"}</dt>
                    <dd className="min-w-0">
                      {p.kind === "multi_buy" ? `${p.slots[0]?.qty} ชิ้นจาก: ` : ""}
                      {p.slots[0] ? slotText(p.slots[0]) : "–"}
                    </dd>
                  </div>
                  {p.kind === "bundle" && p.slots[1] && (
                    <div className="flex gap-2">
                      <dt className="w-14 shrink-0 text-muted-foreground">B</dt>
                      <dd className="min-w-0">{slotText(p.slots[1])}</dd>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0 text-muted-foreground">เวลา</dt>
                    <dd>{scheduleText(p)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0 text-muted-foreground">สาขา</dt>
                    <dd>{p.branches.length ? p.branchNames.join(", ") : "ทุกสาขา"}</dd>
                  </div>
                </dl>
                <p className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                  ใช้ไป {formatNumber(p.orders)} บิล · ลดให้ลูกค้ารวม {formatMoney(p.discountTotal)}
                </p>
                {manage && p.editable && (
                  <div className="mt-auto flex flex-wrap justify-end gap-2 pt-4">
                    <Button size="sm" variant="ghost" className="mr-auto text-danger" onClick={() => void remove(p)}>
                      <Trash2 className="size-4" /> ลบ
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void toggle(p)}>
                      <Power className="size-4" /> {p.isActive ? "ปิด" : "เปิด"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                      <Pencil className="size-4" /> แก้ไข
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing !== null && (
          <PromotionDialog
            key={editing === "new" ? "new" : editing.id}
            promo={editing === "new" ? null : editing}
            onDone={() => {
              setEditing(null);
              refresh();
            }}
          />
        )}
      </Dialog>
    </>
  );
}

/**
 * Products this promotion would sell below cost. Picked products only (a whole category has no
 * single cost). A set is checked against the dearest-to-buy product of each slot.
 */
export function belowCost(kind: PromotionKind, type: PromotionDiscountType, value: number, slots: SlotState[]) {
  if (!(value > 0)) return [];
  const known = (s: SlotState) => s.products.filter((p) => (p.cost ?? 0) > 0);
  const out: { name: string; cost: number; net: number; perPiece: boolean }[] = [];
  if (kind === "bundle") {
    const worst = slots.map((s) => known(s).sort((a, b) => b.cost! - a.cost!)[0]);
    if (worst.some((p) => !p)) return [];
    const cost = worst.reduce((sum, p, i) => sum + p!.cost! * slots[i].qty, 0);
    const list = worst.reduce((sum, p, i) => sum + p!.price * slots[i].qty, 0);
    const net = type === "set_price" ? value : type === "percent" ? list * (1 - value / 100) : list - value;
    if (net < cost - 1e-9) out.push({ name: worst.map((p) => p!.name).join(" + "), cost, net, perPiece: false });
    return out;
  }
  const n = kind === "multi_buy" ? Math.max(1, slots[0]?.qty ?? 1) : 1;
  for (const p of known(slots[0] ?? { qty: 1, products: [], categoryIds: [] })) {
    const net = type === "set_price" ? value / n : type === "percent" ? p.price * (1 - value / 100) : p.price - value / n;
    if (net < p.cost! - 1e-9) out.push({ name: p.name, cost: p.cost!, net: Math.round(net * 100) / 100, perPiece: true });
  }
  return out;
}

interface SlotState {
  qty: number;
  products: { id: number; name: string; price: number; cost?: number }[];
  categoryIds: number[];
}
const emptySlot = (qty = 1): SlotState => ({ qty, products: [], categoryIds: [] });

function PromotionDialog({ promo, onDone }: { promo: Promotion | null; onDone: () => void }) {
  const { user, can } = useAuth();
  const allBranches = can("settings:manage") || !user?.branchId;
  const branches = useQuery({ queryKey: ["org", "branches"], queryFn: () => api.get<Branch[]>("/org/branches") });
  const categories = useCategories();
  const [kind, setKind] = useState<PromotionKind>(promo?.kind ?? "multi_buy");
  const [name, setName] = useState(promo?.name ?? "");
  const [discountType, setDiscountType] = useState<PromotionDiscountType>(promo?.discountType ?? "set_price");
  const [value, setValue] = useState(promo ? String(promo.value) : "");
  const [slots, setSlots] = useState<SlotState[]>(
    promo?.slots.map((s) => ({ qty: s.qty, products: s.products, categoryIds: s.categoryIds })) ?? [emptySlot(2)],
  );
  const [startsOn, setStartsOn] = useState(promo?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(promo?.endsOn ?? "");
  const [daysMask, setDaysMask] = useState(promo?.daysMask ?? 127);
  const [allDay, setAllDay] = useState(!promo?.timeFrom);
  const [timeFrom, setTimeFrom] = useState(promo?.timeFrom ?? "17:00");
  const [timeTo, setTimeTo] = useState(promo?.timeTo ?? "20:00");
  // a new promotion starts on the user's own branch; reaching every branch is a deliberate choice
  const [branchIds, setBranchIds] = useState<number[]>(promo?.branches ?? (user?.branchId ? [user.branchId] : []));
  const [busy, setBusy] = useState(false);
  const [belowCostOk, setBelowCostOk] = useState(false);

  const changeKind = (k: PromotionKind) => {
    setKind(k);
    if (k === "bundle") setSlots((s) => [s[0] ?? emptySlot(), s[1] ?? emptySlot()].map((x) => ({ ...x, qty: Math.max(1, Math.min(x.qty, 9)) })));
    else setSlots((s) => [{ ...(s[0] ?? emptySlot()), qty: k === "multi_buy" ? Math.max(2, s[0]?.qty ?? 2) : 1 }]);
    if (k === "time_discount" && discountType === "set_price") setDiscountType("percent");
  };

  const v = Number(value);
  const problem =
    !name.trim()
      ? "ใส่ชื่อโปรโมชั่น"
      : !(v > 0)
        ? "ใส่มูลค่าส่วนลด"
        : discountType === "percent" && v > 100
          ? "ส่วนลดเปอร์เซ็นต์ต้องไม่เกิน 100"
          : slots.some((s) => !s.products.length && !s.categoryIds.length)
            ? kind === "bundle"
              ? "เลือกสินค้าฝั่ง A และ B"
              : "เลือกสินค้าหรือหมวดที่ร่วมโปร"
            : !daysMask
              ? "เลือกอย่างน้อย 1 วัน"
              : !allDay && timeFrom === timeTo
                ? "เวลาเริ่มและสิ้นสุดต้องไม่เท่ากัน"
                : startsOn && endsOn && endsOn < startsOn
                  ? "วันสิ้นสุดต้องไม่ก่อนวันเริ่ม"
                  : null;

  const losses = belowCost(kind, discountType, Number(value), slots);
  const save = async () => {
    setBusy(true);
    const body = {
      name: name.trim(),
      kind,
      discountType,
      value: v,
      startsOn: startsOn || null,
      endsOn: endsOn || null,
      daysMask,
      timeFrom: allDay ? null : timeFrom,
      timeTo: allDay ? null : timeTo,
      branchIds,
      isActive: promo?.isActive ?? true,
      slots: slots.map((s) => ({ qty: s.qty, productIds: s.products.map((p) => p.id), categoryIds: s.categoryIds })),
    };
    try {
      if (promo) await api.put(`/pos/promotions/${promo.id}`, body);
      else await api.post("/pos/promotions", body);
      toast.success(promo ? "บันทึกโปรโมชั่นแล้ว" : "สร้างโปรโมชั่นแล้ว — หน้าขายใช้ได้ทันที");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      setBusy(false);
    }
  };

  const valueLabel =
    discountType === "percent" ? "ลดกี่ %" : discountType === "amount_off" ? (kind === "time_discount" ? "ลดชิ้นละกี่บาท" : "ลดกี่บาท (ต่อชุด)") : kind === "time_discount" ? "ราคาพิเศษต่อชิ้น (บาท)" : "ราคาชุด (บาท)";

  return (
    <DialogContent title={promo ? `แก้ไขโปร ${promo.name}` : "สร้างโปรโมชั่น"} className="max-w-2xl">
      <div className="grid gap-5 [&>*]:min-w-0">
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(KIND) as PromotionKind[]).map((k) => {
            const K = KIND[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => changeKind(k)}
                className={cn(
                  "flex items-start gap-2 rounded-xl border p-3 text-left text-sm transition-colors",
                  kind === k ? "border-primary bg-primary/5 ring-2 ring-primary/15" : "border-border hover:border-primary/50",
                )}
              >
                <K.icon className={cn("mt-0.5 size-4 shrink-0", kind === k ? "text-primary" : "text-muted-foreground")} />
                <span>
                  <span className="block font-medium">{K.label}</span>
                  <span className="text-xs text-muted-foreground">{K.hint}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pr-name">ชื่อโปร (แสดงบนหน้าขายและใบเสร็จ)</Label>
          <Input
            id="pr-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={191}
            placeholder={kind === "time_discount" ? "เช่น เบเกอรี่ลดหลังสองทุ่ม" : kind === "multi_buy" ? "เช่น น้ำดื่ม 2 ขวด 25.-" : "เช่น กาแฟคู่ครัวซองต์"}
          />
        </div>

        {slots.map((s, i) => (
          <SlotEditor
            key={i}
            title={kind === "bundle" ? (i === 0 ? "สินค้าฝั่ง A" : "สินค้าฝั่ง B (ซื้อคู่กับ A)") : "สินค้าที่ร่วมโปร"}
            showQty={kind !== "time_discount"}
            minQty={kind === "multi_buy" ? 2 : 1}
            qtyLabel={kind === "multi_buy" ? "ต้องซื้อครบกี่ชิ้น (คละได้)" : "จำนวนชิ้น"}
            slot={s}
            categories={categories.data ?? []}
            onChange={(next) => setSlots((all) => all.map((x, j) => (j === i ? next : x)))}
          />
        ))}

        <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-end">
          <div className="space-y-1.5">
            <Label>ส่วนลดแบบ</Label>
            <Segmented
              label="ส่วนลดแบบ"
              value={discountType}
              onChange={setDiscountType}
              options={[
                { value: "set_price", label: kind === "time_discount" ? "ราคาพิเศษ" : "ราคาชุด" },
                { value: "percent", label: "ลด %" },
                { value: "amount_off", label: "ลดบาท" },
              ]}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pr-value">{valueLabel}</Label>
            <Input id="pr-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={discountType === "percent" ? "เช่น 20" : "เช่น 39"} />
          </div>
        </div>

        <fieldset className="space-y-3 rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-medium">ช่วงเวลา</legend>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => {
              const on = !!(daysMask & (1 << i));
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDaysMask((m) => m ^ (1 << i))}
                  className={cn("size-10 rounded-full border text-sm font-medium", on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground")}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="size-4 accent-primary" />
            ทั้งวัน (ตลอดเวลาเปิดร้าน)
          </label>
          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pr-from">ตั้งแต่</Label>
                <Input id="pr-from" type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pr-to">ถึง (ไม่รวม)</Label>
                <Input id="pr-to" type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">ข้ามเที่ยงคืนได้ เช่น 22:00 ถึง 02:00</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pr-start">เริ่มวันที่</Label>
              <Input id="pr-start" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-end">ถึงวันที่</Label>
              <Input id="pr-end" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-2 rounded-xl border border-border p-3">
          <legend className="flex items-center gap-1 px-1 text-sm font-medium">
            <Store className="size-4" /> สาขาที่ใช้โปรนี้
          </legend>
          {allBranches ? (
            <>
              <p className="text-xs text-muted-foreground">ไม่เลือกเลย = ใช้ทุกสาขา</p>
              <div className="flex flex-wrap gap-2">
                {branches.data
                  ?.filter((b) => b.isActive)
                  .map((b) => {
                    const on = branchIds.includes(b.id);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setBranchIds((ids) => (on ? ids.filter((x) => x !== b.id) : [...ids, b.id]))}
                        className={cn("min-h-10 rounded-lg border px-3 text-sm", on ? "border-primary bg-primary/10 text-primary" : "border-border")}
                      >
                        {b.name}
                      </button>
                    );
                  })}
              </div>
            </>
          ) : (
            <p className="text-sm">
              สาขาของคุณ ({branches.data?.find((b) => b.id === user?.branchId)?.name ?? "–"}) — โปรที่ใช้หลายสาขาให้เจ้าของร้านหรือแอดมินสร้าง
            </p>
          )}
        </fieldset>

        {!problem && losses.length > 0 && (
          <div role="alert" className="space-y-2 rounded-xl border-2 border-danger bg-danger/5 p-3 text-sm">
            <p className="font-medium text-danger">โปรนี้ขายต่ำกว่าทุน</p>
            <ul className="list-disc pl-5">
              {losses.map((l) => (
                <li key={l.name}>
                  {l.name}: ทุน {formatMoney(l.cost)} แต่ขายได้ {formatMoney(l.net)}{l.perPiece ? " ต่อชิ้น" : " ต่อชุด"} (ขาดทุน {formatMoney(l.cost - l.net)})
                </li>
              ))}
            </ul>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="size-5" checked={belowCostOk} onChange={(e) => setBelowCostOk(e.target.checked)} />
              ตั้งใจขายต่ำกว่าทุน (เช่น ล้างสต๊อก)
            </label>
          </div>
        )}
        {problem && <p className="text-sm text-muted-foreground">{problem}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onDone} disabled={busy}>
            ยกเลิก
          </Button>
          <Button onClick={() => void save()} disabled={!!problem || busy || (losses.length > 0 && !belowCostOk)}>
            {busy && <Loader2 className="animate-spin" />} {promo ? "บันทึก" : "สร้างโปรโมชั่น"}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}

function SlotEditor({
  title,
  showQty,
  minQty,
  qtyLabel,
  slot,
  categories,
  onChange,
}: {
  title: string;
  showQty: boolean;
  minQty: number;
  qtyLabel: string;
  slot: SlotState;
  categories: { id: number; name: string; productCount: number }[];
  onChange: (s: SlotState) => void;
}) {
  return (
    <fieldset className="space-y-3 rounded-xl border border-border p-3">
      <legend className="px-1 text-sm font-medium">{title}</legend>
      {showQty && (
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`${title}-qty`}>{qtyLabel}</Label>
          <Input
            id={`${title}-qty`}
            inputMode="numeric"
            value={slot.qty}
            onChange={(e) => onChange({ ...slot, qty: Math.max(minQty, Math.min(99, Math.floor(Number(e.target.value) || minQty))) })}
            className="w-20 text-center"
          />
        </div>
      )}
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">ทั้งหมวด</p>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => {
            const on = slot.categoryIds.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ ...slot, categoryIds: on ? slot.categoryIds.filter((x) => x !== c.id) : [...slot.categoryIds, c.id] })}
                className={cn("min-h-9 rounded-full border px-3 text-xs", on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}
              >
                {c.name} ({c.productCount})
              </button>
            );
          })}
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">หรือเลือกสินค้าทีละรายการ (สแกนบาร์โค้ดได้)</p>
        {slot.products.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {slot.products.map((p) => (
              <li key={p.id} className="flex min-h-9 items-center gap-1 rounded-full bg-muted py-1 pl-3 pr-1 text-xs">
                {p.name} <span className="text-muted-foreground">{formatMoney(p.price)}</span>
                <button
                  type="button"
                  className="grid size-7 place-items-center rounded-full hover:bg-card"
                  aria-label={`เอา ${p.name} ออก`}
                  onClick={() => onChange({ ...slot, products: slot.products.filter((x) => x.id !== p.id) })}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <ProductPicker exclude={slot.products.map((p) => p.id)} onPick={(p) => onChange({ ...slot, products: [...slot.products, { id: p.id, name: p.name, price: p.price, cost: p.cost }] })} />
      </div>
    </fieldset>
  );
}
