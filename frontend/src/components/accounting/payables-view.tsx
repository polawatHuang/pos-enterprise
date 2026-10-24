"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Banknote, Loader2, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { PaymentVoucher, Supplier, SupplierBill, TxnMeta } from "@/lib/types";
import { cn, formatMoney, formatThaiDate, todayStr } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge, Card, Input, Label, NativeSelect, Skeleton, TabBar, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { PageHeader } from "@/components/layout/page";
import { ErrorNote } from "@/components/dashboard/widgets";
import { useTaxSettings } from "@/lib/tax";
import { PAYMENT_LABEL } from "./labels";

type Tab = "owed" | "bills" | "vouchers";
const KEY = ["accounting", "payables"] as const;

export const BILL_STATUS: Record<SupplierBill["status"], { label: string; tone: "warning" | "success" | "neutral" }> = {
  unpaid: { label: "ค้างจ่าย", tone: "warning" },
  paid: { label: "จ่ายแล้ว", tone: "success" },
  void: { label: "ยกเลิก", tone: "neutral" },
};

interface Owed {
  supplierId: number;
  supplierName: string;
  count: number;
  amount: number;
  firstDue: string | null;
}

/** เจ้าหนี้: book supplier invoices as they arrive, see who is owed what, pay with a ใบสำคัญจ่าย. */
export function PayablesView() {
  const { can } = useAuth();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab | null) ?? "owed");
  // a goods receipt can open "ตั้งหนี้" with its supplier and value filled in
  const [billFor, setBillFor] = useState<Partial<BillPrefill> | null>(() =>
    params.get("new") === "bill"
      ? {
          supplierId: params.get("supplierId") ?? "",
          stockDocumentId: params.get("stockDocumentId") ?? "",
          purchaseOrderId: params.get("purchaseOrderId") ?? "",
          amount: params.get("amount") ?? "",
        }
      : null,
  );
  const writable = can("accounting:write");

  return (
    <>
      <PageHeader
        title="เจ้าหนี้ & จ่ายเงินผู้ขาย"
        description="บันทึกใบแจ้งหนี้/ใบกำกับภาษีจากผู้ขาย (ตั้งหนี้) แล้วจ่ายรวมทีละผู้ขายด้วยใบสำคัญจ่าย — หักภาษี ณ ที่จ่ายและออก 50 ทวิ ได้ในขั้นตอนเดียว"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/accounting/petty-cash" className={buttonVariants({ variant: "outline" })}>
              <Wallet /> เงินสดย่อย
            </Link>
            {writable && (
              <Button onClick={() => setBillFor({})}>
                <Plus /> บันทึกตั้งหนี้
              </Button>
            )}
          </div>
        }
      />
      <Card>
        <div className="px-4 pt-2">
          <TabBar
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "owed", label: "ค้างจ่าย" },
              { value: "bills", label: "รายการตั้งหนี้" },
              { value: "vouchers", label: "ใบสำคัญจ่าย" },
            ]}
          />
        </div>
        {tab === "owed" && <OwedPanel writable={writable} />}
        {tab === "bills" && <BillsPanel writable={writable} />}
        {tab === "vouchers" && <VouchersPanel />}
      </Card>
      <Dialog open={billFor !== null} onOpenChange={(o) => !o && setBillFor(null)}>
        {billFor && <BillDialog prefill={billFor} onDone={() => setBillFor(null)} />}
      </Dialog>
    </>
  );
}

function OwedPanel({ writable }: { writable: boolean }) {
  const owed = useQuery({ queryKey: [...KEY, "owed"], queryFn: () => api.get<Owed[]>("/accounting/payables/bills/owed") });
  const [supplier, setSupplier] = useState<Owed | null>(null);
  const today = todayStr();
  if (owed.isPending) return <Skeleton className="m-4 h-40" />;
  if (owed.isError) return <ErrorNote onRetry={() => owed.refetch()} error={owed.error} />;
  if (!owed.data.length) return <p className="p-12 text-center text-sm text-muted-foreground">ไม่มียอดค้างจ่ายผู้ขาย</p>;
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {owed.data.map((o) => (
          <li key={o.supplierId}>
            <button
              type="button"
              onClick={() => setSupplier(o)}
              className={cn(
                "flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-muted",
                supplier?.supplierId === o.supplierId && "bg-primary/10",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{o.supplierName}</span>
                <span className={cn("text-xs text-muted-foreground", o.firstDue && o.firstDue < today && "text-danger")}>
                  {o.count} ฉบับ{o.firstDue ? ` · ครบกำหนด ${formatThaiDate(o.firstDue)}` : ""}
                </span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{formatMoney(o.amount)}</span>
            </button>
          </li>
        ))}
      </ul>
      {supplier ? (
        <PayPanel key={supplier.supplierId} supplier={supplier} writable={writable} />
      ) : (
        <p className="self-center text-center text-sm text-muted-foreground">เลือกผู้ขายเพื่อดูรายการและจ่ายเงิน</p>
      )}
    </div>
  );
}

function PayPanel({ supplier, writable }: { supplier: Owed; writable: boolean }) {
  const bills = useQuery({
    queryKey: [...KEY, "bills", "unpaid", supplier.supplierId],
    queryFn: () => api.get<SupplierBill[]>("/accounting/payables/bills", { status: "unpaid", supplierId: supplier.supplierId }),
  });
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [paying, setPaying] = useState(false);
  const chosen = (bills.data ?? []).filter((b) => picked.has(b.id));
  const total = chosen.reduce((s, b) => s + b.signedTotal, 0);
  const toggle = (id: number) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  if (bills.isPending) return <Skeleton className="h-40" />;
  return (
    <div className="grid gap-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="w-12 px-3 py-2">
                <input
                  type="checkbox"
                  className="size-5"
                  aria-label="เลือกทั้งหมด"
                  checked={!!bills.data?.length && picked.size === bills.data.length}
                  onChange={(e) => setPicked(e.target.checked ? new Set(bills.data?.map((b) => b.id)) : new Set())}
                />
              </th>
              <th className="px-3 py-2 font-medium">รายการ</th>
              <th className="px-3 py-2 font-medium">ครบกำหนด</th>
              <th className="px-3 py-2 text-right font-medium">ยอด</th>
            </tr>
          </thead>
          <tbody>
            {bills.data?.map((b) => (
              <tr key={b.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40" onClick={() => toggle(b.id)}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    className="size-5"
                    aria-label={`เลือก ${b.billNo}`}
                    checked={picked.has(b.id)}
                    onChange={() => toggle(b.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </td>
                <td className="px-3 py-2">
                  <span className="font-medium">{b.supplierDocNo || b.billNo}</span>
                  <span className="block text-xs text-muted-foreground">
                    {b.kind === "credit_note" ? "ใบลดหนี้จากผู้ขาย" : "ใบแจ้งหนี้"} · {b.billNo} · {formatThaiDate(b.billDate)}
                  </span>
                </td>
                <td className="px-3 py-2">{b.dueDate ? formatThaiDate(b.dueDate) : "-"}</td>
                <td className={cn("px-3 py-2 text-right tabular-nums", b.signedTotal < 0 && "text-danger")}>{formatMoney(b.signedTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted p-3">
        <span className="text-sm">
          เลือก {chosen.length} ฉบับ · ยอด <b className="text-lg tabular-nums">{formatMoney(total)}</b>
        </span>
        {writable && (
          <Button onClick={() => setPaying(true)} disabled={!chosen.some((b) => b.kind === "bill") || total <= 0}>
            <Banknote /> จ่ายเงิน
          </Button>
        )}
      </div>
      <Dialog open={paying} onOpenChange={setPaying}>
        {paying && <PayDialog supplier={supplier} bills={chosen} />}
      </Dialog>
    </div>
  );
}

function PayDialog({ supplier, bills }: { supplier: Owed; bills: SupplierBill[] }) {
  const router = useRouter();
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: ["accounting", "meta"], queryFn: () => api.get<TxnMeta>("/accounting/transactions/meta") });
  const [payDate, setPayDate] = useState(todayStr());
  const [method, setMethod] = useState("transfer");
  const [payeeType, setPayeeType] = useState<"company" | "individual">("company");
  const [whtCode, setWhtCode] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const wht = meta.data?.whtTypes.find((w) => w.code === whtCode);
  const gross = bills.reduce((s, b) => s + b.signedTotal, 0);
  const base = bills.reduce((s, b) => s + (b.kind === "credit_note" ? -b.amount : b.amount), 0);
  const whtAmount = wht ? Math.round(base * wht.rate) / 100 : 0;

  const pay = async () => {
    setBusy(true);
    try {
      const pv = await api.post<PaymentVoucher>("/accounting/payables/vouchers", {
        supplierId: supplier.supplierId,
        payDate,
        paymentMethod: method,
        billIds: bills.map((b) => b.id),
        payeeType,
        ...(wht ? { whtRate: wht.rate, whtIncomeType: wht.code } : {}),
        reference: reference || null,
      });
      void qc.invalidateQueries({ queryKey: ["accounting"] });
      void qc.invalidateQueries({ queryKey: ["documents-hub"] });
      toast.success(`จ่ายเงินแล้ว ${pv.pvNo}`);
      router.push(`/accounting/payables/vouchers/${pv.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "จ่ายเงินไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent title={`จ่ายเงิน ${supplier.supplierName}`} description={`${bills.length} รายการ · ระบบออกใบสำคัญจ่ายและลงบัญชีให้`} className="max-w-md">
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="pv-date">วันที่จ่าย</Label>
            <Input id="pv-date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pv-method">จ่ายโดย</Label>
            <NativeSelect id="pv-method" className="h-10 w-full" value={method} onChange={(e) => setMethod(e.target.value)}>
              {["transfer", "cash", "cheque", "promptpay", "petty_cash"].map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_LABEL[m] ?? m}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pv-wht">หักภาษี ณ ที่จ่าย</Label>
          <NativeSelect id="pv-wht" className="h-10 w-full" value={whtCode} onChange={(e) => setWhtCode(e.target.value)}>
            <option value="">ไม่หัก</option>
            {meta.data?.whtTypes.map((w) => (
              <option key={w.code} value={w.code}>
                {w.label} {w.rate}%
              </option>
            ))}
          </NativeSelect>
        </div>
        {wht && (
          <div className="space-y-1.5">
            <Label htmlFor="pv-payee">ผู้รับเงินเป็น</Label>
            <NativeSelect id="pv-payee" className="h-10 w-full" value={payeeType} onChange={(e) => setPayeeType(e.target.value as "company" | "individual")}>
              <option value="company">นิติบุคคล (ภ.ง.ด.53)</option>
              <option value="individual">บุคคลธรรมดา (ภ.ง.ด.3)</option>
            </NativeSelect>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="pv-ref">เลขที่เช็ค / อ้างอิงการโอน</Label>
          <Input id="pv-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-y-1 rounded-lg bg-muted p-3 text-sm tabular-nums">
          <dt>ยอดตามใบแจ้งหนี้</dt>
          <dd className="text-right">{formatMoney(gross)}</dd>
          {wht && (
            <>
              <dt>
                หัก ณ ที่จ่าย {wht.rate}% (จาก {formatMoney(base)})
              </dt>
              <dd className="text-right text-danger">-{formatMoney(whtAmount)}</dd>
            </>
          )}
          <dt className="font-semibold">จ่ายจริง</dt>
          <dd className="text-right text-lg font-semibold">{formatMoney(gross - whtAmount)}</dd>
        </dl>
        <Button onClick={() => void pay()} disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} ยืนยันจ่ายเงิน
        </Button>
      </div>
    </DialogContent>
  );
}

function BillsPanel({ writable }: { writable: boolean }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const bills = useQuery({
    queryKey: [...KEY, "bills", status],
    queryFn: () => api.get<SupplierBill[]>("/accounting/payables/bills", { status: status || undefined }),
  });
  const voidBill = async (b: SupplierBill) => {
    const reason = window.prompt(`ยกเลิก ${b.billNo} — เหตุผล`);
    if (!reason) return;
    try {
      await api.post(`/accounting/payables/bills/${b.id}/void`, { reason });
      toast.success("ยกเลิกและกลับรายการบัญชีแล้ว");
      void qc.invalidateQueries({ queryKey: KEY });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ยกเลิกไม่สำเร็จ");
    }
  };
  return (
    <div className="p-4">
      <NativeSelect aria-label="สถานะ" className="mb-3 h-10" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">ทุกสถานะ</option>
        <option value="unpaid">ค้างจ่าย</option>
        <option value="paid">จ่ายแล้ว</option>
        <option value="void">ยกเลิก</option>
      </NativeSelect>
      {bills.isPending ? (
        <Skeleton className="h-40" />
      ) : bills.isError ? (
        <ErrorNote onRetry={() => bills.refetch()} error={bills.error} />
      ) : !bills.data.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground">ยังไม่มีรายการตั้งหนี้</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-cards w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">เลขที่</th>
                <th className="px-3 py-2.5 font-medium">ผู้ขาย</th>
                <th className="px-3 py-2.5 font-medium">วันที่</th>
                <th className="px-3 py-2.5 text-right font-medium">ยอด</th>
                <th className="px-3 py-2.5 font-medium">สถานะ</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {bills.data.map((b) => (
                <tr key={b.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2.5">
                    <span className="font-medium">{b.billNo}</span>
                    <span className="block text-xs text-muted-foreground">
                      {b.kind === "credit_note" ? "ใบลดหนี้" : "ใบแจ้งหนี้"} {b.supplierDocNo ?? ""}
                      {b.grNo && (
                        <Link href={`/inventory/documents/${b.stockDocumentId}`} className="ml-1 text-primary hover:underline">
                          {b.grNo}
                        </Link>
                      )}
                    </span>
                  </td>
                  <td data-label="ผู้ขาย" className="px-3 py-2.5">
                    {b.supplierName}
                  </td>
                  <td data-label="วันที่" className="px-3 py-2.5 text-muted-foreground">
                    {formatThaiDate(b.billDate)}
                  </td>
                  <td data-label="ยอด" className={cn("px-3 py-2.5 text-right tabular-nums", b.signedTotal < 0 && "text-danger")}>
                    {formatMoney(b.signedTotal)}
                  </td>
                  <td data-label="สถานะ" className="px-3 py-2.5">
                    <Badge tone={BILL_STATUS[b.status].tone}>{BILL_STATUS[b.status].label}</Badge>
                    {b.voucherId && (
                      <Link href={`/accounting/payables/vouchers/${b.voucherId}`} className="ml-1.5 text-xs text-primary hover:underline">
                        {b.voucherNo}
                      </Link>
                    )}
                  </td>
                  <td className="cards-hide px-3 py-2.5 text-right">
                    {writable && b.status === "unpaid" && (
                      <button
                        type="button"
                        onClick={() => void voidBill(b)}
                        className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-danger-soft hover:text-danger"
                        title="ยกเลิก"
                        aria-label={`ยกเลิก ${b.billNo}`}
                      >
                        <Ban className="size-4" />
                      </button>
                    )}
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

function VouchersPanel() {
  const list = useQuery({ queryKey: [...KEY, "vouchers"], queryFn: () => api.get<PaymentVoucher[]>("/accounting/payables/vouchers") });
  if (list.isPending) return <Skeleton className="m-4 h-40" />;
  if (list.isError) return <ErrorNote onRetry={() => list.refetch()} error={list.error} />;
  if (!list.data.length) return <p className="p-12 text-center text-sm text-muted-foreground">ยังไม่มีใบสำคัญจ่าย</p>;
  return (
    <div className="overflow-x-auto p-4">
      <table className="table-cards w-full min-w-[680px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-3 py-2.5 font-medium">เลขที่</th>
            <th className="px-3 py-2.5 font-medium">ผู้ขาย</th>
            <th className="px-3 py-2.5 font-medium">วันที่จ่าย</th>
            <th className="px-3 py-2.5 text-right font-medium">หัก ณ ที่จ่าย</th>
            <th className="px-3 py-2.5 text-right font-medium">จ่ายจริง</th>
          </tr>
        </thead>
        <tbody>
          {list.data.map((v) => (
            <tr key={v.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2.5">
                <Link
                  href={`/accounting/payables/vouchers/${v.id}`}
                  className={cn("font-medium text-primary hover:underline", v.status === "void" && "line-through")}
                >
                  {v.pvNo}
                </Link>
                <span className="block text-xs text-muted-foreground">{PAYMENT_LABEL[v.paymentMethod] ?? v.paymentMethod}</span>
              </td>
              <td data-label="ผู้ขาย" className="px-3 py-2.5">
                {v.supplierName}
              </td>
              <td data-label="วันที่จ่าย" className="px-3 py-2.5 text-muted-foreground">
                {formatThaiDate(v.payDate)}
              </td>
              <td data-label="หัก ณ ที่จ่าย" className="px-3 py-2.5 text-right tabular-nums">
                {v.whtAmount ? formatMoney(v.whtAmount) : "-"}
              </td>
              <td data-label="จ่ายจริง" className="px-3 py-2.5 text-right font-medium tabular-nums">
                {formatMoney(v.netPaid)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface BillPrefill {
  supplierId: string;
  stockDocumentId: string;
  purchaseOrderId: string;
  amount: string;
}

function BillDialog({ prefill, onDone }: { prefill: Partial<BillPrefill>; onDone: () => void }) {
  const qc = useQueryClient();
  const suppliers = useQuery({ queryKey: ["purchasing", "suppliers"], queryFn: () => api.get<Supplier[]>("/purchasing/suppliers") });
  const meta = useQuery({
    queryKey: [...KEY, "meta"],
    queryFn: () => api.get<{ accounts: { code: string; name: string }[] }>("/accounting/payables/meta"),
  });
  const [kind, setKind] = useState<"bill" | "credit_note">("bill");
  const [supplierId, setSupplierId] = useState(prefill.supplierId ?? "");
  const [docNo, setDocNo] = useState("");
  const [billDate, setBillDate] = useState(todayStr());
  const [dueDate, setDueDate] = useState("");
  const [account, setAccount] = useState("1300");
  const [amount, setAmount] = useState(prefill.amount ?? "");
  const [vatMode, setVatMode] = useState<"exclusive" | "inclusive" | "none">(prefill.amount ? "exclusive" : "inclusive");
  const [claimable, setClaimable] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { tax } = useTaxSettings();
  const total = useMemo(() => {
    const a = Number(amount) || 0;
    return vatMode === "exclusive" ? a * (1 + tax.vatRate / 100) : a;
  }, [amount, vatMode, tax.vatRate]);

  const save = async () => {
    setBusy(true);
    try {
      const b = await api.post<SupplierBill>("/accounting/payables/bills", {
        kind,
        supplierId: Number(supplierId),
        supplierDocNo: docNo || null,
        billDate,
        dueDate: dueDate || null,
        accountCode: account,
        amount: Number(amount),
        vatMode,
        vatClaimable: claimable,
        stockDocumentId: prefill.stockDocumentId ? Number(prefill.stockDocumentId) : null,
        purchaseOrderId: prefill.purchaseOrderId ? Number(prefill.purchaseOrderId) : null,
        note: note || null,
      });
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ["documents-hub"] });
      toast.success(`บันทึก ${b.billNo} แล้ว ยอด ${formatMoney(b.total)}`);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent
      title={kind === "bill" ? "บันทึกตั้งหนี้จากผู้ขาย" : "บันทึกใบลดหนี้จากผู้ขาย"}
      description="กรอกตามใบแจ้งหนี้ / ใบกำกับภาษีที่ได้รับ ระบบลงบัญชีเจ้าหนี้และภาษีซื้อให้"
      className="max-w-lg"
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-2">
          {(["bill", "credit_note"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn("min-h-10 rounded-lg border text-sm", kind === k ? "border-primary bg-primary/10 font-medium" : "border-border")}
            >
              {k === "bill" ? "ใบแจ้งหนี้ / ใบกำกับภาษี" : "ใบลดหนี้จากผู้ขาย"}
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bill-sup">ผู้ขาย</Label>
          <NativeSelect id="bill-sup" className="h-10 w-full" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">เลือกผู้ขาย</option>
            {suppliers.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="bill-no">เลขที่เอกสารของผู้ขาย</Label>
            <Input id="bill-no" value={docNo} onChange={(e) => setDocNo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bill-acc">บันทึกเป็น</Label>
            <NativeSelect id="bill-acc" className="h-10 w-full" value={account} onChange={(e) => setAccount(e.target.value)}>
              {(meta.data?.accounts ?? [{ code: "1300", name: "ซื้อสินค้าเข้าสต๊อก" }]).map((a) => (
                <option key={a.code} value={a.code}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bill-date">ลงวันที่</Label>
            <Input id="bill-date" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bill-due">ครบกำหนดจ่าย</Label>
            <Input id="bill-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bill-amount">จำนวนเงิน</Label>
            <Input id="bill-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bill-vat">ภาษีมูลค่าเพิ่ม</Label>
            <NativeSelect id="bill-vat" className="h-10 w-full" value={vatMode} onChange={(e) => setVatMode(e.target.value as typeof vatMode)}>
              <option value="inclusive">ยอดนี้รวม VAT แล้ว</option>
              <option value="exclusive">บวก VAT เพิ่ม</option>
              <option value="none">ไม่มี VAT</option>
            </NativeSelect>
          </div>
        </div>
        {vatMode !== "none" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" checked={claimable} onChange={(e) => setClaimable(e.target.checked)} />
            มีใบกำกับภาษีเต็มรูป (ขอคืนภาษีซื้อได้)
          </label>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="bill-note">หมายเหตุ</Label>
          <Textarea id="bill-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <p className="text-sm">
          ยอดรวมประมาณ <b className="tabular-nums">{formatMoney(total)}</b>
        </p>
        <Button onClick={() => void save()} disabled={busy || !supplierId || !(Number(amount) > 0)}>
          {busy && <Loader2 className="animate-spin" />} บันทึก
        </Button>
      </div>
    </DialogContent>
  );
}
