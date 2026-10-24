"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, FileText, Loader2, Printer, Search, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { PosOrder, PosOrderRow } from "@/lib/types";
import { formatDateTime, formatMoney } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label, Textarea } from "@/components/ui/primitives";
import { useTaxSettings } from "@/lib/tax";
import { DialogContent } from "@/components/ui/overlays";
import { METHOD_LABEL } from "./receipt";
import { ReturnView } from "./return-view";
import { SHIFT_KEY } from "./shift";
import { ApprovalCancelled, withApproval } from "./manager-approval";

function StatusBadge({ b }: { b: PosOrderRow }) {
  if (b.status === "cancelled") return <Badge tone="danger">ยกเลิก</Badge>;
  if (b.status === "refunded") return <Badge tone="warning">คืนทั้งบิล</Badge>;
  if (b.refundedAmount > 0) return <Badge tone="warning">คืนบางส่วน {formatMoney(b.refundedAmount)}</Badge>;
  return <Badge tone="success">สำเร็จ</Badge>;
}

export function BillsDialog({ onReprint }: { onReprint: (o: PosOrder) => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const query = q.trim();
  const bills = useQuery({
    queryKey: ["pos", "orders", query],
    queryFn: () => api.get<PosOrderRow[]>("/pos/orders", { scope: "shift", q: query.length >= 2 ? query : undefined, limit: 50 }),
  });
  const [voiding, setVoiding] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState<PosOrder | null>(null);
  const { tax } = useTaxSettings();
  const [taxFor, setTaxFor] = useState<number | null>(null);
  const [buyer, setBuyer] = useState({ name: "", taxId: "", branchNo: "00000", address: "" });
  const [taxBusy, setTaxBusy] = useState(false);

  /** Issue the full tax invoice: from what the customer sent (pending) or typed here. */
  const issueTax = async (id: number, typed = false) => {
    setTaxBusy(true);
    try {
      const r = await api.post<{ docNo: string }>(`/pos/orders/${id}/tax-invoice`, typed ? buyer : {});
      toast.success(`ออกใบกำกับภาษีเลขที่ ${r.docNo} แล้ว`);
      setTaxFor(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ออกใบกำกับภาษีไม่สำเร็จ");
    } finally {
      setTaxBusy(false);
    }
  };

  const reprint = async (id: number) => onReprint(await api.get<PosOrder>(`/pos/orders/${id}`));
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["pos"] });
    void qc.invalidateQueries({ queryKey: SHIFT_KEY });
    void qc.invalidateQueries({ queryKey: ["inventory"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const startReturn = async (id: number) => {
    try {
      setReturning(await api.get<PosOrder>(`/pos/orders/${id}`));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เปิดบิลไม่สำเร็จ");
    }
  };

  const doVoid = async (id: number) => {
    setBusy(true);
    try {
      await withApproval("void", (h) => api.post(`/pos/orders/${id}/void`, { reason }, h));
      toast.success("ยกเลิกบิลและคืนสต๊อกแล้ว");
      setVoiding(null);
      setReason("");
      refresh();
    } catch (err) {
      if (!(err instanceof ApprovalCancelled)) toast.error(err instanceof Error ? err.message : "ยกเลิกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  if (returning) {
    return (
      <DialogContent title="คืนสินค้า / คืนเงิน" className="max-w-2xl">
        <ReturnView
          order={returning}
          onBack={() => setReturning(null)}
          onDone={(r) => {
            refresh();
            setReturning(null);
            onReprint(r.order);
          }}
          onChanged={(o) => {
            refresh();
            setReturning(o);
          }}
        />
      </DialogContent>
    );
  }

  return (
    <DialogContent title={query.length >= 2 ? "ค้นหาบิล" : "บิลในกะนี้"} className="max-w-2xl">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาบิล: ยอดเงิน, ชื่อสินค้า, เบอร์สมาชิก หรือเลขบิล" className="pl-9" />
      </div>
      {bills.isPending ? (
        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
      ) : bills.data?.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{query.length >= 2 ? "ไม่พบบิลที่ค้นหา" : "ยังไม่มีบิลในกะนี้"}</p>
      ) : (
        <ul className="divide-y divide-border">
          {bills.data?.map((b) => (
            <li key={b.id} className="py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-medium">{b.orderNo}</span>
                <StatusBadge b={b} />
                <span className="text-muted-foreground">
                  {formatDateTime(b.orderedAt)} · {b.items} ชิ้น · {METHOD_LABEL[b.method ?? ""] ?? b.method}
                </span>
                {b.customerName && <span className="text-muted-foreground">· {b.customerName}</span>}
                <span className="ml-auto font-semibold tabular-nums">{formatMoney(b.total)}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void reprint(b.id)}>
                  <Printer /> พิมพ์ซ้ำ
                </Button>
                {(b.status === "completed" || b.refundedAmount > 0) && (
                  <Button variant="outline" size="sm" onClick={() => void startReturn(b.id)}>
                    <Undo2 /> {b.status === "completed" ? "คืนสินค้า" : "ประวัติการคืน"}
                  </Button>
                )}
                {tax.vatRegistered && b.status === "completed" && b.refundedAmount === 0 && b.taxRequest !== "issued" && (
                  <Button
                    variant={b.taxRequest === "pending" ? "default" : "outline"}
                    size="sm"
                    disabled={taxBusy}
                    onClick={() => (b.taxRequest === "pending" ? void issueTax(b.id) : setTaxFor(taxFor === b.id ? null : b.id))}
                  >
                    <FileText /> {b.taxRequest === "pending" ? "ออกใบกำกับ (ลูกค้าขอแล้ว)" : "ใบกำกับภาษีเต็มรูป"}
                  </Button>
                )}
                {b.taxRequest === "issued" && <Badge tone="success">ออกใบกำกับแล้ว</Badge>}
                {b.status === "completed" && b.refundedAmount === 0 && (
                  <Button variant="ghost" size="sm" className="text-danger" onClick={() => setVoiding(voiding === b.id ? null : b.id)}>
                    <Ban /> ยกเลิกบิล
                  </Button>
                )}
              </div>
              {taxFor === b.id && (
                <form
                  className="mt-2 grid gap-2 rounded-xl border border-border p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void issueTax(b.id, true);
                  }}
                >
                  <p className="text-xs text-muted-foreground">กรอกข้อมูลผู้ซื้อ (หรือให้ลูกค้าสแกน QR ท้ายใบเสร็จแล้วกรอกเอง)</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor={`tb-name-${b.id}`}>ชื่อ</Label>
                      <Input id={`tb-name-${b.id}`} value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`tb-tax-${b.id}`}>เลขผู้เสียภาษี 13 หลัก</Label>
                      <Input id={`tb-tax-${b.id}`} inputMode="numeric" value={buyer.taxId} onChange={(e) => setBuyer({ ...buyer, taxId: e.target.value.replace(/\D/g, "").slice(0, 13) })} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`tb-addr-${b.id}`}>ที่อยู่</Label>
                    <Textarea id={`tb-addr-${b.id}`} rows={2} value={buyer.address} onChange={(e) => setBuyer({ ...buyer, address: e.target.value })} />
                  </div>
                  <Button type="submit" size="sm" className="h-10 w-fit" disabled={taxBusy || !buyer.name.trim() || buyer.taxId.length !== 13 || !buyer.address.trim()}>
                    {taxBusy && <Loader2 className="animate-spin" />} ออกใบกำกับภาษี
                  </Button>
                </form>
              )}
              {voiding === b.id && (
                <div className="mt-2 flex gap-2">
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผลที่ยกเลิก" className="h-9" autoFocus />
                  <Button variant="danger" size="sm" className="h-9" disabled={!reason.trim() || busy} onClick={() => void doVoid(b.id)}>
                    ยืนยัน
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!can("pos:manage") && <p className="mt-3 text-xs text-muted-foreground">คืนสินค้าและยกเลิกบิลได้ โดยให้ผู้จัดการกรอก PIN ยืนยันบนเครื่องนี้</p>}
    </DialogContent>
  );
}
