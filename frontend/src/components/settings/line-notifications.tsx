"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CheckCircle2, ChevronRight, Loader2, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Branch, SalesReport, SalesReportSettings } from "@/lib/types";
import { cn, formatMoney, formatNumber, formatThaiDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect, Skeleton } from "@/components/ui/primitives";
import { PageHeader } from "@/components/layout/page";
import { ErrorNote } from "@/components/dashboard/widgets";
import { LineRecipients, type LineTarget } from "@/components/common/line-recipients";

interface SalesReportData {
  settings: SalesReportSettings;
  lastSentOn: string | null;
  lineTargets: LineTarget[];
  lineConnected: boolean;
}

const KEY = ["notifications", "sales-report"] as const;

/** Settings › แจ้งเตือน LINE: the daily sales summary card pushed to LINE OA. */
export function LineNotificationsView() {
  const data = useQuery({ queryKey: KEY, queryFn: () => api.get<SalesReportData>("/notifications/sales-report") });
  return (
    <>
      <PageHeader title="แจ้งเตือน LINE" description="ส่งสรุปยอดขายและรายรับ-รายจ่ายของวันเข้า LINE ทุกวัน แบบรายงานร้านค้าของ LINE MAN" />
      {data.isPending ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : data.isError ? (
        <Card>
          <ErrorNote error={data.error} onRetry={() => data.refetch()} />
        </Card>
      ) : (
        <SalesReportForm key={JSON.stringify(data.data.settings)} initial={data.data} />
      )}
    </>
  );
}

function SalesReportForm({ initial }: { initial: SalesReportData }) {
  const qc = useQueryClient();
  const branches = useQuery({ queryKey: ["org", "branches"], queryFn: () => api.get<Branch[]>("/org/branches") });
  const [enabled, setEnabled] = useState(initial.settings.enabled);
  const [time, setTime] = useState(initial.settings.time);
  const [to, setTo] = useState(initial.settings.to);
  const [branchId, setBranchId] = useState<number | null>(initial.settings.branchId);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const body = { enabled, time, to, branchId };
  const dirty = JSON.stringify(body) !== JSON.stringify({ ...initial.settings, branchId: initial.settings.branchId ?? null });
  const preview = useQuery({
    queryKey: ["notifications", "sales-report", "preview", branchId],
    queryFn: () => api.get<SalesReport>("/notifications/sales-report/preview", { branchId: branchId ?? undefined }),
  });

  const save = async () => {
    setBusy("save");
    try {
      await api.put("/notifications/sales-report", body);
      await qc.invalidateQueries({ queryKey: KEY });
      toast.success(enabled ? `เปิดแล้ว — ส่งสรุปยอดขายทุกวันเวลา ${time} น.` : "ปิดการส่งสรุปยอดขายแล้ว");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };
  const test = async () => {
    setBusy("test");
    try {
      const r = await api.post<{ sent: number }>("/notifications/sales-report/test", { to, branchId, time });
      toast.success(`ส่งรายงานของวันนี้ให้ ${r.sent} คนแล้ว — เปิดดูใน LINE`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ส่งไม่สำเร็จ", { duration: 10_000 });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] [&>*]:min-w-0">
      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="size-5 text-[#00B14F]" /> สรุปยอดขายรายวัน
            </CardTitle>
            <CardDescription>
              ยอดขายสุทธิเทียบเมื่อวาน/สัปดาห์ก่อน, บิล, กำไร, ช่องทางชำระเงิน, ช่วงเวลาขายดี, สาขา, สินค้าขายดี และรายรับ-รายจ่าย
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5">
          {!initial.lineConnected && (
            <p className="rounded-xl bg-warning-soft p-3 text-sm text-warning">
              ยังไม่ได้เชื่อม LINE OA — เชื่อมที่{" "}
              <Link href="/inbox/settings" className="font-medium underline">
                หน้า Inbox › ตั้งค่า
              </Link>{" "}
              หรือ{" "}
              <Link href="/settings/integrations" className="font-medium underline">
                การเชื่อมต่อ API
              </Link>
            </p>
          )}
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border p-4">
            <span className="flex-1">
              <span className="block font-medium">ส่งทุกวันอัตโนมัติ</span>
              <span className="text-xs text-muted-foreground">
                {initial.lastSentOn ? `ส่งล่าสุด ${formatThaiDate(initial.lastSentOn)}` : "ยังไม่เคยส่ง"} · นับโควตาข้อความ push ของ LINE OA (1
                ข้อความต่อผู้รับต่อวัน)
              </span>
            </span>
            <Switch checked={enabled} onChange={setEnabled} label="ส่งทุกวันอัตโนมัติ" />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sr-time">เวลาส่ง</Label>
              <Input id="sr-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-11" />
              <p className="text-xs text-muted-foreground">สรุปตั้งแต่ 00:00 ถึงเวลานี้ เทียบกับเมื่อวานช่วงเวลาเดียวกัน</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sr-branch">สาขา</Label>
              <NativeSelect
                id="sr-branch"
                className="h-11 w-full"
                value={branchId ?? ""}
                onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">ทุกสาขารวมกัน (แยกยอดรายสาขาในการ์ด)</option>
                {branches.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    เฉพาะ {b.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>ผู้รับ</Label>
            <LineRecipients targets={initial.lineTargets} value={to} onChange={setTo} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" className="h-11" onClick={() => void test()} disabled={busy !== null || !to.length}>
              {busy === "test" ? <Loader2 className="animate-spin" /> : <Send />} ส่งทดสอบตอนนี้
            </Button>
            <Button className="h-11" onClick={() => void save()} disabled={busy !== null || !dirty || (enabled && !to.length)}>
              {busy === "save" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} บันทึก
            </Button>
          </div>
          {enabled && !to.length && <p className="text-xs text-danger">เลือกผู้รับอย่างน้อย 1 คนก่อนเปิดใช้</p>}
          <Link href="/inventory" className="flex min-h-11 items-center gap-2 rounded-xl border border-border p-3 text-sm hover:bg-accent">
            <BellRing className="size-4 text-muted-foreground" />
            <span className="flex-1">แจ้งเตือนสต๊อกหมด/ใกล้หมดทาง LINE ตั้งค่าได้ที่หน้าสต๊อกสินค้า › แจ้งเตือน</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <p className="text-sm font-medium">ตัวอย่างการ์ดใน LINE (ข้อมูลจริงของวันนี้)</p>
        {preview.data ? <ReportCard r={preview.data} time={time} /> : <Skeleton className="h-[640px] rounded-2xl" />}
      </div>
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        onChange(!checked);
      }}
      className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors", checked ? "bg-[#00B14F]" : "bg-muted-foreground/30")}
    >
      <span className={cn("absolute top-0.5 size-6 rounded-full bg-white shadow transition-all", checked ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

const GREEN = "#00B14F";

function Change({ label, c }: { label: string; c: { net: number; pct: number | null } }) {
  if (c.pct == null) return <p className="text-xs text-[#8C8C8C]">{label}: ยังไม่มีข้อมูลเปรียบเทียบ</p>;
  const up = c.pct >= 0;
  return (
    <p className="text-xs text-[#8C8C8C]">
      <span className="font-bold" style={{ color: up ? GREEN : "#E53935" }}>
        {up ? "▲" : "▼"} {Math.abs(c.pct).toFixed(1)}%
      </span>{" "}
      {label} ({formatMoney(c.net)})
    </p>
  );
}

/** HTML look-alike of the Flex card the backend sends (daily-sales.js renderFlex). */
function ReportCard({ r, time }: { r: SalesReport; time: string }) {
  const max = Math.max(...r.hours.map((h) => h.amount), 1);
  const peak = r.hours.length ? r.hours.reduce((a, b) => (b.amount > a.amount ? b : a)) : null;
  const lo = r.hours.length ? Math.max(0, Math.min(...r.hours.map((h) => h.hour), Math.max(...r.hours.map((h) => h.hour)) - 5)) : 0;
  const hi = r.hours.length ? Math.min(23, Math.max(Math.max(...r.hours.map((h) => h.hour)), lo + 5)) : -1;
  const maxB = Math.max(...r.branches.map((b) => b.net), 1);
  return (
    <div className="overflow-hidden rounded-2xl bg-white text-[13px] text-[#1F2328] shadow-lg ring-1 ring-black/5" data-testid="line-report-preview">
      <div className="p-4 text-white" style={{ background: GREEN }}>
        <p className="font-bold">{r.branchName ? `${r.shopName} · ${r.branchName}` : r.shopName}</p>
        <p className="text-xs opacity-90">สรุปยอดขาย{r.until ? ` (ถึง ${r.until} น.)` : "ทั้งวัน"}</p>
        <p className="text-xs opacity-90">{formatThaiDate(r.date)}</p>
      </div>
      <div className="space-y-4 p-4">
        <div>
          <p className="text-xs text-[#8C8C8C]">ยอดขายสุทธิ</p>
          <p className="text-3xl font-bold tabular-nums">{formatMoney(r.net)}</p>
          <div className="mt-1 space-y-0.5">
            <Change label={r.until ? "เทียบเมื่อวานเวลาเดียวกัน" : "เทียบเมื่อวาน"} c={r.vsYesterday} />
            <Change label="เทียบสัปดาห์ก่อน" c={r.vsLastWeek} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            ["บิล", formatNumber(r.bills)],
            ["เฉลี่ย/บิล", formatMoney(r.avgBill)],
            ["กำไรขั้นต้น", formatMoney(r.profit)],
          ].map(([l, v]) => (
            <div key={l} className="min-w-0 rounded-[10px] bg-[#F4F6F8] p-2.5">
              <p className="text-[10px] text-[#8C8C8C]">{l}</p>
              <p className="truncate font-bold tabular-nums">{v}</p>
            </div>
          ))}
        </div>
        {!r.bills && <p className="text-center text-[#8C8C8C]">{r.until ? "วันนี้ยังไม่มียอดขาย" : "วันนี้ไม่มียอดขาย"}</p>}
        {r.methods.length > 0 && (
          <section className="space-y-2 border-t border-[#E6E8EB] pt-3">
            <p className="font-bold">ช่องทางชำระเงิน</p>
            {r.methods.map((m) => (
              <div key={m.method}>
                <p className="flex justify-between gap-2">
                  <span>{m.label}</span>
                  <span className="text-xs text-[#8C8C8C] tabular-nums">
                    {formatMoney(m.amount)} {m.share.toFixed(0)}%
                  </span>
                </p>
                <div className="mt-1 h-1.5 rounded-full bg-[#EDEFF2]">
                  <div className="h-1.5 rounded-full" style={{ width: `${Math.max(2, m.share)}%`, background: m.color }} />
                </div>
              </div>
            ))}
          </section>
        )}
        {peak && (
          <section className="space-y-2 border-t border-[#E6E8EB] pt-3">
            <p className="font-bold">
              ช่วงเวลาขายดี · พีค {String(peak.hour).padStart(2, "0")}:00–{String(peak.hour + 1).padStart(2, "0")}:00
            </p>
            <div className="flex h-[76px] items-end gap-0.5">
              {Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((h) => {
                const amount = r.hours.find((x) => x.hour === h)?.amount ?? 0;
                return (
                  <div key={h} className="flex flex-1 flex-col items-center justify-end">
                    <div
                      className="w-full rounded-sm"
                      style={{ height: Math.max(4, Math.round((amount / max) * 56)), background: h === peak.hour ? GREEN : "#A5D6A7" }}
                    />
                    <span className="mt-1 text-[10px] text-[#8C8C8C]">{h}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}
        {r.branches.length > 1 && (
          <section className="space-y-2 border-t border-[#E6E8EB] pt-3">
            <p className="font-bold">แยกตามสาขา</p>
            {r.branches.map((b) => (
              <div key={b.id}>
                <p className="flex justify-between gap-2">
                  <span className="truncate">{b.name}</span>
                  <span className="shrink-0 text-xs text-[#8C8C8C] tabular-nums">
                    {formatMoney(b.net)} · {b.bills} บิล
                  </span>
                </p>
                <div className="mt-1 h-1.5 rounded-full bg-[#EDEFF2]">
                  <div className="h-1.5 rounded-full bg-[#26A69A]" style={{ width: `${Math.max(2, (b.net / maxB) * 100)}%` }} />
                </div>
              </div>
            ))}
          </section>
        )}
        {r.topProducts.length > 0 && (
          <section className="space-y-1.5 border-t border-[#E6E8EB] pt-3">
            <p className="font-bold">สินค้าขายดี</p>
            {r.topProducts.map((t, i) => (
              <p key={t.name} className="flex items-center gap-2">
                <span className="w-3 text-xs font-bold" style={{ color: i === 0 ? GREEN : "#8C8C8C" }}>
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                <span className="text-xs text-[#8C8C8C]">×{formatNumber(t.qty)}</span>
                <span className="w-20 text-right tabular-nums">{formatMoney(t.amount)}</span>
              </p>
            ))}
          </section>
        )}
        <section className="space-y-1 border-t border-[#E6E8EB] pt-3">
          <p className="font-bold">รายรับ-รายจ่ายวันนี้</p>
          <Line l="ยอดขายสุทธิ" v={formatMoney(r.net)} />
          <Line l="รายรับอื่น" v={formatMoney(r.income)} />
          <Line l="รายจ่าย" v={`-${formatMoney(r.expense)}`} red={r.expense > 0} />
          {r.refunds.count > 0 && <Line l={`คืนสินค้า ${r.refunds.count} รายการ`} v={`-${formatMoney(r.refunds.amount)}`} />}
          {r.cancelled.count > 0 && <Line l={`ยกเลิกบิล ${r.cancelled.count} ใบ`} v={formatMoney(r.cancelled.amount)} />}
          <p className="mt-2 flex justify-between rounded-lg bg-[#F4F6F8] p-2.5 font-bold">
            <span>คงเหลือสุทธิ</span>
            <span className="tabular-nums" style={{ color: r.balance >= 0 ? GREEN : "#E53935" }}>
              {formatMoney(r.balance)}
            </span>
          </p>
        </section>
      </div>
      <div className="space-y-2 px-4 pb-4">
        <div className="rounded-md py-2 text-center text-sm font-medium text-white" style={{ background: GREEN }}>
          ดูรายงานเต็ม
        </div>
        <p className="text-center text-[10px] text-[#8C8C8C]">ส่งอัตโนมัติทุกวัน {time} น. · ปิดได้ที่ ตั้งค่า › แจ้งเตือน LINE</p>
      </div>
    </div>
  );
}

function Line({ l, v, red }: { l: string; v: string; red?: boolean }) {
  return (
    <p className="flex justify-between gap-2">
      <span className="text-[#8C8C8C]">{l}</span>
      <span className={cn("tabular-nums", red && "text-[#E53935]")}>{v}</span>
    </p>
  );
}
