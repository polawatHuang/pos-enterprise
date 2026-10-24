"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSignature, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { PettyCash } from "@/lib/types";
import { cn, formatMoney, formatThaiDate, todayStr } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge, Card, CardContent, CardHeader, CardTitle, Input, Label, NativeSelect, Skeleton } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { PageHeader } from "@/components/layout/page";
import { ErrorNote } from "@/components/dashboard/widgets";

const KEY = ["accounting", "petty-cash"] as const;

/**
 * เงินสดย่อย: a box of cash for small daily expenses. Top it up from the safe or the bank; each
 * expense paid from it is recorded in รายรับ-รายจ่าย with "เงินสดย่อย" as the payment method.
 */
export function PettyCashView() {
  const { can } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get<PettyCash>("/accounting/payables/petty-cash") });
  const [topup, setTopup] = useState(false);
  const writable = can("accounting:write");

  const substitute = async (id: number) => {
    try {
      const doc = await api.post<{ id: number }>("/accounting/documents/substitute-receipt", { transactionId: id });
      void qc.invalidateQueries({ queryKey: ["accounting"] });
      router.push(`/accounting/documents/${doc.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ออกใบรับรองแทนใบเสร็จไม่สำเร็จ");
    }
  };

  return (
    <>
      <PageHeader
        title="เงินสดย่อย"
        description="ค่าใช้จ่ายเล็กๆ ประจำวัน (ค่าน้ำแข็ง ค่าส่งเอกสาร ค่าวินมอเตอร์ไซค์) — เติมเงินเข้ากล่อง แล้วบันทึกจ่ายในรายรับ-รายจ่ายโดยเลือกช่องทาง “เงินสดย่อย”"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/accounting/transactions" className={buttonVariants({ variant: "outline" })}>
              บันทึกรายจ่าย
            </Link>
            {writable && (
              <Button onClick={() => setTopup(true)}>
                <Plus /> เติมเงินสดย่อย
              </Button>
            )}
          </div>
        }
      />
      {q.isPending ? (
        <Skeleton className="h-64" />
      ) : q.isError ? (
        <ErrorNote onRetry={() => q.refetch()} error={q.error} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>เงินคงเหลือในกล่อง</CardTitle>
            </CardHeader>
            <CardContent>
              <p className={cn("text-3xl font-semibold tabular-nums", q.data.balance < 0 && "text-danger")}>{formatMoney(q.data.balance)}</p>
              <p className="mt-1 text-xs text-muted-foreground">ตามบัญชี 1105 เงินสดย่อย — นับเงินจริงแล้วควรตรงกับยอดนี้</p>
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>จ่ายจากเงินสดย่อย</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!q.data.expenses.length ? (
                <p className="p-6 text-center text-sm text-muted-foreground">ยังไม่มีรายจ่ายจากเงินสดย่อย</p>
              ) : (
                <ul className="divide-y divide-border">
                  {q.data.expenses.map((x) => (
                    <li key={x.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate", x.status === "void" && "line-through")}>{x.description || x.category}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatThaiDate(x.date)} · {x.counterparty ?? x.category}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">{formatMoney(x.paid)}</span>
                      {writable && x.status === "posted" && (
                        <button
                          type="button"
                          onClick={() => void substitute(x.id)}
                          className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-primary"
                          title="ใบรับรองแทนใบเสร็จ (ผู้รับเงินไม่มีใบเสร็จ)"
                          aria-label={`ใบรับรองแทนใบเสร็จ ${x.description ?? ""}`}
                        >
                          <FileSignature className="size-4" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>ประวัติการเติมเงิน</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!q.data.topups.length ? (
                <p className="p-6 text-center text-sm text-muted-foreground">ยังไม่เคยเติมเงินสดย่อย</p>
              ) : (
                <ul className="divide-y divide-border">
                  {q.data.topups.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{t.topupNo}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatThaiDate(t.date)} · จาก{t.fromMethod === "cash" ? "เงินสด" : "บัญชีธนาคาร"} {t.note ? `· ${t.note}` : ""}
                        </span>
                      </span>
                      {t.status === "void" && <Badge tone="neutral">ยกเลิก</Badge>}
                      <span className="shrink-0 font-medium tabular-nums text-success">+{formatMoney(t.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      <Dialog open={topup} onOpenChange={setTopup}>
        {topup && (
          <TopupDialog
            onDone={() => {
              setTopup(false);
              void qc.invalidateQueries({ queryKey: KEY });
              void qc.invalidateQueries({ queryKey: ["documents-hub"] });
            }}
          />
        )}
      </Dialog>
    </>
  );
}

function TopupDialog({ onDone }: { onDone: () => void }) {
  const [date, setDate] = useState(todayStr());
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState("cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post("/accounting/payables/petty-cash/topups", { date, amount: Number(amount), fromMethod: from, note: note || null });
      toast.success("เติมเงินสดย่อยแล้ว");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogContent title="เติมเงินสดย่อย" className="max-w-sm">
      <div className="grid gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="pc-date">วันที่</Label>
          <Input id="pc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pc-amount">จำนวนเงิน</Label>
          <Input id="pc-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pc-from">เบิกจาก</Label>
          <NativeSelect id="pc-from" className="h-10 w-full" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="cash">เงินสด (ตู้เซฟ)</option>
            <option value="transfer">ถอนจากบัญชีธนาคาร</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pc-note">หมายเหตุ</Label>
          <Input id="pc-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button onClick={() => void save()} disabled={busy || !(Number(amount) > 0)}>
          {busy && <Loader2 className="animate-spin" />} บันทึก
        </Button>
      </div>
    </DialogContent>
  );
}
