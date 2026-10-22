"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Check, HeartHandshake, Loader2, Plus, Settings2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type {
  Product,
  WelfareEmployee,
  WelfareRequest,
  WelfareSettings,
  WelfareStatus,
  WelfareSummary,
  WelfareWarehouse,
} from "@/lib/types";
import { cn, formatDateTime, formatMoney, formatNumber, todayStr } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Label, NativeSelect, Skeleton, TabBar, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { ErrorNote } from "@/components/dashboard/widgets";
import { PageHeader } from "@/components/layout/page";
import { ProductPicker } from "@/components/common/product-picker";

type Tab = "pending" | "history" | "summary";

const STATUS: Record<WelfareStatus, { label: string; tone: "warning" | "success" | "danger" | "neutral" }> = {
  pending: { label: "รออนุมัติ", tone: "warning" },
  approved: { label: "อนุมัติแล้ว", tone: "success" },
  rejected: { label: "ปฏิเสธ", tone: "danger" },
  cancelled: { label: "ยกเลิก", tone: "neutral" },
};

const thisMonth = () => todayStr().slice(0, 7);
const limitText = (limit: number) => (limit > 0 ? formatMoney(limit) : "ไม่จำกัด");
const errText = (err: unknown) => (err instanceof Error ? err.message : "ไม่สำเร็จ");

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["inventory"] });
    void qc.invalidateQueries({ queryKey: ["products"] });
  };
}

/** เบิกสินค้าสวัสดิการพนักงาน: staff request, a manager approves, stock leaves at cost within a monthly limit. */
export function WelfareView() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("pending");
  const [requestOpen, setRequestOpen] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const pending = useQuery({
    queryKey: ["inventory", "welfare", "list", "pending"],
    queryFn: () => api.get<WelfareRequest[]>("/inventory/welfare", { status: "pending" }),
  });
  const canRequest = can("welfare:request") || can("inventory:write");

  return (
    <>
      <PageHeader
        title="เบิกสินค้าสวัสดิการพนักงาน"
        description="พนักงานขอเบิก → ผู้จัดการอนุมัติ → ตัดสต๊อกตามต้นทุน (ล็อตที่หมดอายุก่อนออกก่อน) และลงบัญชีค่าสวัสดิการพนักงาน"
        actions={
          <>
            {can("settings:manage") && (
              <Button variant="outline" onClick={() => setLimitsOpen(true)}>
                <Settings2 /> วงเงินต่อเดือน
              </Button>
            )}
            {canRequest && (
              <Button onClick={() => setRequestOpen(true)}>
                <Plus /> ขอเบิกสินค้า
              </Button>
            )}
          </>
        }
      />
      <Card>
        <div className="px-4 pt-2">
          <TabBar
            value={tab}
            onChange={setTab}
            tabs={[
              {
                value: "pending",
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    รออนุมัติ
                    {!!pending.data?.length && <Badge tone="warning">{pending.data.length}</Badge>}
                  </span>
                ),
              },
              { value: "history", label: "ประวัติ" },
              { value: "summary", label: "สรุปรายเดือน" },
            ]}
          />
        </div>
        {tab === "pending" ? <Pending query={pending} /> : tab === "history" ? <History /> : <Summary />}
      </Card>
      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        {requestOpen && <RequestDialog onDone={() => setRequestOpen(false)} />}
      </Dialog>
      <Dialog open={limitsOpen} onOpenChange={setLimitsOpen}>
        {limitsOpen && <LimitsDialog onDone={() => setLimitsOpen(false)} />}
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------- pending */

function Pending({ query }: { query: UseQueryResult<WelfareRequest[]> }) {
  const { user, can } = useAuth();
  const refresh = useRefresh();
  const [busy, setBusy] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<WelfareRequest | null>(null);

  const act = async (r: WelfareRequest, action: "approve" | "cancel") => {
    setBusy(r.id);
    try {
      await api.post(`/inventory/welfare/${r.id}/${action}`);
      toast.success(action === "approve" ? `อนุมัติ ${r.requestNo} แล้ว ตัดสต๊อก ${formatMoney(r.totalCost)}` : `ยกเลิก ${r.requestNo} แล้ว`);
      refresh();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(null);
    }
  };

  if (query.isPending) return <Skeleton className="m-4 h-40" />;
  if (query.isError) return <ErrorNote onRetry={() => query.refetch()} error={query.error} />;
  if (!query.data?.length)
    return (
      <div className="grid place-items-center gap-2 p-12 text-center">
        <HeartHandshake className="size-10 text-muted-foreground" />
        <p className="font-medium">ไม่มีคำขอที่รออนุมัติ</p>
        <p className="text-sm text-muted-foreground">กด &quot;ขอเบิกสินค้า&quot; เพื่อเบิกสินค้าสวัสดิการ ผู้จัดการจะอนุมัติก่อนตัดสต๊อก</p>
      </div>
    );

  return (
    <div className="grid gap-3 p-4 md:grid-cols-2">
      {query.data.map((r) => {
        const own = r.employeeId === user?.id || r.requestedBy === user?.id;
        const canApprove = can("inventory:approve") && (!own || can("settings:manage"));
        const canCancel = own;
        return (
          <div key={r.id} className="flex flex-col gap-3 rounded-xl border border-border p-3" data-testid="welfare-pending">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{r.employeeName}</p>
                <p className="text-xs text-muted-foreground">
                  {r.requestNo} · {r.warehouseName} · ขอเมื่อ {formatDateTime(r.requestedAt)}
                  {r.requestedByName && r.requestedBy !== r.employeeId ? ` · โดย ${r.requestedByName}` : ""}
                </p>
              </div>
              <span className="shrink-0 text-right font-semibold tabular-nums">{formatMoney(r.totalCost)}</span>
            </div>
            <ItemList items={r.items} />
            {r.note && <p className="rounded-lg bg-muted px-3 py-2 text-xs">{r.note}</p>}
            {(canApprove || canCancel || can("inventory:approve")) && (
              <div className="flex flex-wrap gap-2">
                {canApprove && (
                  <Button className="h-10 flex-1" disabled={busy === r.id} onClick={() => void act(r, "approve")}>
                    {busy === r.id ? <Loader2 className="animate-spin" /> : <Check />} อนุมัติ
                  </Button>
                )}
                {can("inventory:approve") && (
                  <Button variant="outline" className="h-10 flex-1 text-danger" disabled={busy === r.id} onClick={() => setRejecting(r)}>
                    <X /> ปฏิเสธ
                  </Button>
                )}
                {canCancel && (
                  <Button variant="ghost" className="h-10" disabled={busy === r.id} onClick={() => void act(r, "cancel")}>
                    ยกเลิกคำขอ
                  </Button>
                )}
              </div>
            )}
            {own && can("inventory:approve") && !can("settings:manage") && (
              <p className="text-xs text-muted-foreground">คำขอของคุณเอง — ต้องให้ผู้จัดการคนอื่นอนุมัติ</p>
            )}
          </div>
        );
      })}
      <Dialog open={rejecting !== null} onOpenChange={(o) => !o && setRejecting(null)}>
        {rejecting && (
          <RejectDialog
            request={rejecting}
            onDone={() => {
              setRejecting(null);
              refresh();
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function ItemList({ items }: { items: WelfareRequest["items"] }) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border text-sm">
      {items.map((i) => (
        <li key={i.id} className="flex items-center gap-2 px-3 py-2">
          <span className="min-w-0 flex-1 truncate">{i.name}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {formatNumber(i.quantity)} {i.unit}
          </span>
          <span className="w-24 shrink-0 text-right tabular-nums">{formatMoney(i.lineCost)}</span>
        </li>
      ))}
    </ul>
  );
}

function RejectDialog({ request, onDone }: { request: WelfareRequest; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/inventory/welfare/${request.id}/reject`, { reason: reason.trim() });
      toast.success(`ปฏิเสธ ${request.requestNo} แล้ว`);
      onDone();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogContent title={`ปฏิเสธ ${request.requestNo}`} description={`${request.employeeName} · ${formatMoney(request.totalCost)}`} className="max-w-sm">
      <div className="grid gap-3">
        <Label htmlFor="welfare-reject-reason">เหตุผล</Label>
        <Textarea id="welfare-reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} placeholder="เช่น เกินสิทธิ์ประจำเดือน" />
        <Button variant="danger" className="h-11" onClick={save} disabled={busy || !reason.trim()}>
          {busy && <Loader2 className="animate-spin" />}
          ยืนยันปฏิเสธ
        </Button>
      </div>
    </DialogContent>
  );
}

/* ------------------------------------------------------------- history */

function History() {
  const [month, setMonth] = useState(thisMonth());
  const [status, setStatus] = useState<"" | WelfareStatus>("");
  const list = useQuery({
    queryKey: ["inventory", "welfare", "list", month, status],
    queryFn: () => api.get<WelfareRequest[]>("/inventory/welfare", { month: month || undefined, status: status || undefined }),
  });
  const total = (list.data ?? []).filter((r) => r.status === "approved").reduce((s, r) => s + r.totalCost, 0);
  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-10 w-44" aria-label="เดือน" />
        <NativeSelect aria-label="สถานะ" className="h-10" value={status} onChange={(e) => setStatus(e.target.value as "" | WelfareStatus)}>
          <option value="">ทุกสถานะ</option>
          {(Object.keys(STATUS) as WelfareStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS[s].label}
            </option>
          ))}
        </NativeSelect>
        {list.data && (
          <p className="text-sm sm:ml-auto">
            อนุมัติแล้วรวม <span className="font-semibold">{formatMoney(total)}</span>
          </p>
        )}
      </div>
      {list.isPending ? (
        <Skeleton className="h-40" />
      ) : list.isError ? (
        <ErrorNote onRetry={() => list.refetch()} error={list.error} />
      ) : !list.data?.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground">ไม่มีรายการเบิกในช่วงนี้</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-cards w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">เลขที่ / พนักงาน</th>
                <th className="py-2 pr-3 font-medium">สินค้า</th>
                <th className="py-2 pr-3 text-right font-medium">มูลค่าทุน</th>
                <th className="py-2 pr-3 font-medium">ขอเมื่อ</th>
                <th className="py-2 pr-3 font-medium">อนุมัติ/ปิดเมื่อ</th>
                <th className="py-2 font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={r.id} className="border-b border-border align-top last:border-0">
                  <td className="py-2 pr-3">
                    <p className="font-medium">{r.employeeName}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.requestNo} · {r.warehouseName}
                    </p>
                  </td>
                  <td data-label="สินค้า" className="py-2 pr-3">
                    <ul className="text-right sm:text-left">
                      {r.items.map((i) => (
                        <li key={i.id}>
                          {i.name} <span className="text-muted-foreground">× {formatNumber(i.quantity)}</span>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td data-label="มูลค่าทุน" className="py-2 pr-3 text-right tabular-nums">
                    {formatMoney(r.totalCost)}
                  </td>
                  <td data-label="ขอเมื่อ" className="py-2 pr-3 whitespace-nowrap">
                    {formatDateTime(r.requestedAt)}
                  </td>
                  <td data-label={r.status === "rejected" ? "ปฏิเสธเมื่อ" : "อนุมัติเมื่อ"} className="py-2 pr-3">
                    {r.approvedAt ? (
                      <span>
                        <span className="whitespace-nowrap">{formatDateTime(r.approvedAt)}</span>
                        {r.approvedByName && <span className="block text-xs text-muted-foreground">{r.approvedByName}</span>}
                      </span>
                    ) : (
                      "–"
                    )}
                  </td>
                  <td data-label="สถานะ" className="py-2">
                    <span className="flex flex-col items-end gap-1 sm:items-start">
                      <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                      {r.rejectReason && <span className="text-xs text-muted-foreground">{r.rejectReason}</span>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- summary */

function Summary() {
  const [month, setMonth] = useState(thisMonth());
  const report = useQuery({
    queryKey: ["inventory", "welfare", "summary", month],
    queryFn: () => api.get<WelfareSummary>("/inventory/welfare/summary", { month: month || undefined }),
  });
  const d = report.data;
  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-10 w-44" aria-label="เดือน" />
        {d && (
          <p className="text-sm">
            อนุมัติแล้ว <span className="font-semibold">{formatMoney(d.totalApproved)}</span>
            {d.totalPending > 0 && <span className="text-muted-foreground"> · รออนุมัติ {formatMoney(d.totalPending)}</span>}
            <span className="text-muted-foreground"> · วงเงินมาตรฐาน {limitText(d.defaultLimit)}</span>
          </p>
        )}
      </div>
      {report.isPending ? (
        <Skeleton className="h-40" />
      ) : report.isError ? (
        <ErrorNote onRetry={() => report.refetch()} error={report.error} />
      ) : !d?.employees.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground">ไม่มีข้อมูล</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-cards w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">พนักงาน</th>
                <th className="py-2 pr-3 text-right font-medium">อนุมัติแล้ว</th>
                <th className="py-2 pr-3 text-right font-medium">รออนุมัติ</th>
                <th className="py-2 pr-3 font-medium">ใช้ไป / วงเงิน</th>
                <th className="py-2 text-right font-medium">คงเหลือ</th>
              </tr>
            </thead>
            <tbody>
              {d.employees.map((e) => {
                const pct = e.limit > 0 ? Math.min((e.used / e.limit) * 100, 100) : 0;
                return (
                  <tr key={e.employeeId} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3">
                      <p className="font-medium">{e.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {e.branchName ?? "ไม่ระบุสาขา"} · {e.requests} คำขอ
                      </p>
                    </td>
                    <td data-label="อนุมัติแล้ว" className="py-2 pr-3 text-right tabular-nums">
                      {formatMoney(e.approved)}
                    </td>
                    <td data-label="รออนุมัติ" className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {formatMoney(e.pending)}
                    </td>
                    <td data-label="ใช้ไป / วงเงิน" className="py-2 pr-3">
                      <span className="flex min-w-40 flex-col items-end gap-1 sm:items-stretch">
                        <span className="tabular-nums">
                          {formatMoney(e.used)} / {limitText(e.limit)}
                        </span>
                        {e.limit > 0 && (
                          <span className="block h-1.5 w-32 overflow-hidden rounded-full bg-muted sm:w-full" aria-hidden>
                            <span
                              className={cn("block h-full rounded-full", e.overLimit || pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-success")}
                              style={{ width: `${pct}%` }}
                            />
                          </span>
                        )}
                      </span>
                    </td>
                    <td data-label="คงเหลือ" className={cn("py-2 text-right tabular-nums", e.overLimit && "text-danger")}>
                      {e.remaining == null ? "ไม่จำกัด" : formatMoney(e.remaining)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- request */

interface Line {
  product: Product;
  quantity: string;
}

function RequestDialog({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  const refresh = useRefresh();
  const employees = useQuery({
    queryKey: ["inventory", "welfare", "employees"],
    queryFn: () => api.get<WelfareEmployee[]>("/inventory/welfare/employees"),
  });
  const warehouses = useQuery({
    queryKey: ["inventory", "welfare", "warehouses"],
    queryFn: () => api.get<WelfareWarehouse[]>("/inventory/welfare/warehouses"),
  });
  const [employeeId, setEmployeeId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);

  // Defaults: yourself when you are on the list, and the warehouse of your branch
  const empId = employeeId || String(employees.data?.find((e) => e.id === user?.id)?.id ?? employees.data?.[0]?.id ?? "");
  const whId = warehouseId || String(warehouses.data?.find((w) => w.branchId === user?.branchId)?.id ?? warehouses.data?.[0]?.id ?? "");
  const employee = employees.data?.find((e) => String(e.id) === empId);
  const total = useMemo(() => lines.reduce((s, l) => s + Math.round((Number(l.quantity) || 0) * l.product.cost * 100) / 100, 0), [lines]);
  const over = employee?.remaining != null && total > employee.remaining + 1e-9;
  const valid = !!empId && !!whId && lines.length > 0 && lines.every((l) => Number(l.quantity) > 0);

  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post<WelfareRequest>("/inventory/welfare", {
        employeeId: Number(empId),
        warehouseId: Number(whId),
        note: note.trim() || undefined,
        items: lines.map((l) => ({ productId: l.product.id, quantity: Number(l.quantity) })),
      });
      toast.success(`ส่งคำขอ ${r.requestNo} แล้ว รอผู้จัดการอนุมัติ`);
      refresh();
      onDone();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent title="ขอเบิกสินค้าสวัสดิการ" description="คิดมูลค่าตามต้นทุนสินค้า สต๊อกจะถูกตัดเมื่อผู้จัดการอนุมัติ" className="max-w-xl">
      {employees.isError || warehouses.isError ? (
        <ErrorNote
          onRetry={() => {
            void employees.refetch();
            void warehouses.refetch();
          }}
          error={employees.error ?? warehouses.error}
        />
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="welfare-employee">พนักงาน</Label>
              <NativeSelect
                id="welfare-employee"
                className="h-11 w-full"
                value={empId}
                onChange={(e) => setEmployeeId(e.target.value)}
                disabled={employees.isPending || (employees.data?.length ?? 0) <= 1}
              >
                {employees.data?.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.branchName ? ` (${e.branchName})` : ""}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="welfare-warehouse">เบิกจากคลัง</Label>
              <NativeSelect
                id="welfare-warehouse"
                className="h-11 w-full"
                value={whId}
                onChange={(e) => setWarehouseId(e.target.value)}
                disabled={warehouses.isPending}
              >
                {warehouses.data?.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          {employee && (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs">
              วงเงินเดือนนี้ {limitText(employee.limit)} · ใช้ไปแล้ว (รวมที่รออนุมัติ) {formatMoney(employee.usedThisMonth)}
              {employee.remaining != null && (
                <>
                  {" "}
                  · คงเหลือ <span className="font-semibold">{formatMoney(employee.remaining)}</span>
                </>
              )}
            </p>
          )}
          <div className="space-y-2">
            <Label>เพิ่มสินค้า</Label>
            <ProductPicker exclude={lines.map((l) => l.product.id)} onPick={(p) => setLines((ls) => [...ls, { product: p, quantity: "1" }])} />
          </div>
          {lines.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {lines.map((l, i) => (
                <li key={l.product.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="truncate font-medium">{l.product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      ทุน {formatMoney(l.product.cost)}/{l.product.unit} · คงเหลือรวม {formatNumber(l.product.onHand)}
                    </p>
                  </div>
                  <Input
                    className="h-10 w-20 text-center"
                    inputMode="decimal"
                    value={l.quantity}
                    onChange={(e) => update(i, { quantity: e.target.value })}
                    aria-label={`จำนวน ${l.product.name}`}
                  />
                  <span className="w-24 text-right tabular-nums">{formatMoney((Number(l.quantity) || 0) * l.product.cost)}</span>
                  <button
                    type="button"
                    onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                    className="grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-danger"
                    aria-label={`ลบ ${l.product.name}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-2">
            <Label htmlFor="welfare-note">หมายเหตุ</Label>
            <Input id="welfare-note" className="h-10" value={note} onChange={(e) => setNote(e.target.value)} maxLength={255} placeholder="ไม่บังคับ" />
          </div>
          <div className={cn("flex items-center justify-between rounded-lg border px-3 py-2", over ? "border-danger/50 bg-danger-soft/30" : "border-border")}>
            <span className="text-sm">มูลค่ารวม (ต้นทุน)</span>
            <span className="text-right">
              <span className={cn("block text-lg font-semibold tabular-nums", over && "text-danger")}>{formatMoney(total)}</span>
              {employee?.remaining != null && (
                <span className={cn("text-xs", over ? "text-danger" : "text-muted-foreground")}>
                  {over ? `เกินวงเงินคงเหลือ ${formatMoney(total - employee.remaining)}` : `คงเหลือหลังเบิก ${formatMoney(employee.remaining - total)}`}
                </span>
              )}
            </span>
          </div>
          <Button className="h-11" onClick={submit} disabled={busy || !valid || over}>
            {busy && <Loader2 className="animate-spin" />}
            ส่งคำขอเบิก
          </Button>
        </div>
      )}
    </DialogContent>
  );
}

/* -------------------------------------------------------------- limits */

function LimitsDialog({ onDone }: { onDone: () => void }) {
  const refresh = useRefresh();
  const settings = useQuery({ queryKey: ["inventory", "welfare", "settings"], queryFn: () => api.get<WelfareSettings>("/inventory/welfare/settings") });
  const [defaultLimit, setDefaultLimit] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const d = settings.data;
  const def = defaultLimit ?? String(d?.defaultLimit ?? 0);
  const valueOf = (u: WelfareSettings["users"][number]) => overrides[u.userId] ?? (u.limit == null ? "" : String(u.limit));
  const bad = (v: string) => v.trim() !== "" && !(Number(v) >= 0);

  const save = async () => {
    if (!d) return;
    setBusy(true);
    try {
      await api.put("/inventory/welfare/limits", {
        defaultLimit: Number(def) || 0,
        users: d.users
          .filter((u) => u.userId in overrides)
          .map((u) => ({ userId: u.userId, limit: overrides[u.userId].trim() === "" ? null : Number(overrides[u.userId]) })),
      });
      toast.success("บันทึกวงเงินสวัสดิการแล้ว");
      refresh();
      onDone();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent title="วงเงินสวัสดิการต่อเดือน" description="คิดตามต้นทุน รวมคำขอที่อนุมัติแล้วและที่รออนุมัติในเดือนนั้น · 0 = ไม่จำกัด" className="max-w-lg">
      {settings.isPending ? (
        <Skeleton className="h-40" />
      ) : settings.isError ? (
        <ErrorNote onRetry={() => settings.refetch()} error={settings.error} />
      ) : (
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="welfare-default-limit">วงเงินมาตรฐานทุกคน (บาท/เดือน)</Label>
            <Input id="welfare-default-limit" className="h-11" inputMode="decimal" value={def} onChange={(e) => setDefaultLimit(e.target.value)} />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">กำหนดรายคน</p>
            <p className="text-xs text-muted-foreground">เว้นว่าง = ใช้วงเงินมาตรฐาน</p>
            <ul className="max-h-[45dvh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {d?.users.map((u) => (
                <li key={u.userId} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{u.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{u.branchName ?? u.email}</span>
                  </span>
                  <Input
                    className={cn("h-10 w-28 text-right", bad(valueOf(u)) && "border-danger")}
                    inputMode="decimal"
                    placeholder={limitText(Number(def) || 0)}
                    value={valueOf(u)}
                    onChange={(e) => setOverrides((o) => ({ ...o, [u.userId]: e.target.value }))}
                    aria-label={`วงเงิน ${u.name}`}
                  />
                </li>
              ))}
            </ul>
          </div>
          <Button className="h-11" onClick={save} disabled={busy || bad(def) || d?.users.some((u) => bad(valueOf(u)))}>
            {busy && <Loader2 className="animate-spin" />}
            บันทึก
          </Button>
        </div>
      )}
    </DialogContent>
  );
}
