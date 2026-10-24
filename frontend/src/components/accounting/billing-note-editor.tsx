"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { AccDocument } from "@/lib/types";
import { cn, formatMoney, formatThaiDate, todayStr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, FieldError, Input, Label, Skeleton, Textarea } from "@/components/ui/primitives";
import { DOC_TYPE_LABEL } from "./labels";

interface Billable {
  customerId: number | null;
  partyName: string | null;
  count: number;
  amount: number;
}
type BillableDoc = AccDocument & { signedAmount: number };

/** ใบวางบิล: pick a customer, tick their unpaid invoices (and credit notes), issue one request for payment. */
export function BillingNoteEditor() {
  const router = useRouter();
  const qc = useQueryClient();
  const [who, setWho] = useState<Billable | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [docDate, setDocDate] = useState(todayStr());
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const customers = useQuery({ queryKey: ["accounting", "billable"], queryFn: () => api.get<Billable[]>("/accounting/documents/billable") });
  const docs = useQuery({
    queryKey: ["accounting", "billable", who?.customerId, who?.partyName],
    queryFn: () =>
      api.get<BillableDoc[]>("/accounting/documents/billable", who?.customerId ? { customerId: who.customerId } : { partyName: who?.partyName ?? "" }),
    enabled: !!who,
  });
  const choose = (c: Billable) => {
    setWho(c);
    setPicked(new Set());
  };
  const chosen = (docs.data ?? []).filter((d) => picked.has(d.id));
  const total = chosen.reduce((s, d) => s + d.signedAmount, 0);
  const toggle = (id: number) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const save = async () => {
    setError(null);
    if (!chosen.some((d) => d.docType !== "credit_note")) return setError("เลือกใบแจ้งหนี้อย่างน้อย 1 ใบ");
    if (total <= 0) return setError("ยอดวางบิลต้องมากกว่า 0");
    setBusy(true);
    try {
      const bn = await api.post<AccDocument>("/accounting/documents/billing-note", {
        docDate,
        dueDate: dueDate || null,
        documentIds: chosen.map((d) => d.id),
        note: note || null,
      });
      void qc.invalidateQueries({ queryKey: ["accounting"] });
      void qc.invalidateQueries({ queryKey: ["documents-hub"] });
      toast.success(`ออกใบวางบิล ${bn.docNo} แล้ว`);
      router.push(`/accounting/documents/${bn.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ออกใบวางบิลไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Link href="/documents" className="mb-2 inline-flex min-h-10 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> ศูนย์เอกสาร
      </Link>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">สร้างใบวางบิล</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        รวมใบแจ้งหนี้ที่ยังค้างของลูกค้ารายเดียวไว้ในใบเดียว (หักใบลดหนี้ได้) ส่งให้ลูกค้านัดจ่าย — ไม่ลงบัญชีจนกว่าจะรับชำระ
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>1. เลือกลูกค้า</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {customers.isPending ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-11" />
                <Skeleton className="h-11" />
              </div>
            ) : !customers.data?.length ? (
              <p className="p-4 text-sm text-muted-foreground">ไม่มีใบแจ้งหนี้ที่ค้างชำระ</p>
            ) : (
              <ul>
                {customers.data.map((c) => {
                  const active = who && who.customerId === c.customerId && who.partyName === c.partyName;
                  return (
                    <li key={`${c.customerId ?? "n"}-${c.partyName}`}>
                      <button
                        type="button"
                        onClick={() => choose(c)}
                        className={cn(
                          "flex min-h-12 w-full items-center justify-between gap-3 border-b border-border px-4 py-2 text-left text-sm last:border-0 hover:bg-muted",
                          active && "bg-primary/10",
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{c.partyName ?? "ไม่ระบุชื่อ"}</span>
                          <span className="text-xs text-muted-foreground">{c.count} ฉบับค้าง</span>
                        </span>
                        <span className="shrink-0 tabular-nums">{formatMoney(c.amount)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>2. เลือกเอกสารที่จะวางบิล</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {!who ? (
              <p className="text-sm text-muted-foreground">เลือกลูกค้าก่อน</p>
            ) : docs.isPending ? (
              <Skeleton className="h-32" />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="w-12 px-3 py-2">
                        <input
                          type="checkbox"
                          className="size-5"
                          aria-label="เลือกทั้งหมด"
                          checked={!!docs.data?.length && picked.size === docs.data.length}
                          onChange={(e) => setPicked(e.target.checked ? new Set(docs.data?.map((d) => d.id)) : new Set())}
                        />
                      </th>
                      <th className="px-3 py-2 font-medium">เอกสาร</th>
                      <th className="px-3 py-2 font-medium">ลงวันที่</th>
                      <th className="px-3 py-2 font-medium">ครบกำหนด</th>
                      <th className="px-3 py-2 text-right font-medium">จำนวนเงิน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.data?.map((d) => (
                      <tr key={d.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40" onClick={() => toggle(d.id)}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            className="size-5"
                            aria-label={`เลือก ${d.docNo}`}
                            checked={picked.has(d.id)}
                            onChange={() => toggle(d.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-medium">{d.docNo}</span>
                          <span className="block text-xs text-muted-foreground">{DOC_TYPE_LABEL[d.docType]}</span>
                        </td>
                        <td className="px-3 py-2">{formatThaiDate(d.docDate)}</td>
                        <td className="px-3 py-2">{d.dueDate ? formatThaiDate(d.dueDate) : "-"}</td>
                        <td className={cn("px-3 py-2 text-right tabular-nums", d.signedAmount < 0 && "text-danger")}>{formatMoney(d.signedAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="bn-date">วันที่วางบิล</Label>
                <Input id="bn-date" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bn-due">นัดชำระ</Label>
                <Input id="bn-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="bn-note">หมายเหตุ</Label>
                <Textarea id="bn-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted p-3">
              <span className="text-sm">
                เลือก {chosen.length} ฉบับ · ยอดวางบิล <b className="text-lg tabular-nums">{formatMoney(total)}</b>
              </span>
              <Button onClick={() => void save()} disabled={busy || !chosen.length}>
                {busy && <Loader2 className="animate-spin" />} ออกใบวางบิล
              </Button>
            </div>
            <FieldError message={error ?? undefined} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
