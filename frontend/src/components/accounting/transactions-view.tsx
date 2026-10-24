"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, ChevronRight, FileCheck2, FileSignature, Loader2, Plus, Search, ShoppingBag, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api, apiFetch, ApiError } from "@/lib/api";
import type { ReceiptExtraction, Transaction, TxnType } from "@/lib/types";
import { formatMoney, formatThaiDate, monthRange } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, NativeSelect, Pagination, Segmented, Skeleton } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/overlays";
import { PageHeader } from "@/components/layout/page";
import { fileToPayload, prefillFromExtraction, TransactionDialog, type TxnPrefill, useTxnMeta } from "./transaction-dialog";
import { SaleDetailDialog } from "./sale-detail";

type Meta = { page: number; pageSize: number; total: number; income: number; expense: number };

const CHANNEL_LABEL: Record<string, string> = {
  pos: "หน้าร้าน (POS)",
  shopee: "Shopee",
  tiktok: "TikTok Shop",
  facebook: "Facebook",
  instagram: "Instagram",
  line: "LINE",
  website: "เว็บไซต์",
  other: "อื่นๆ",
};

export function TransactionsView() {
  const { can } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const meta = useTxnMeta();
  const fileRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<TxnType | "all">("all");
  const [saleId, setSaleId] = useState<number | null>(null);
  const [range, setRange] = useState(monthRange(0));
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<TxnPrefill | null>(null);
  const [reading, setReading] = useState(false);

  const query = { type: type === "all" ? undefined : type, from: range.from, to: range.to, category, q, page, pageSize: 25 };
  const list = useQuery({
    queryKey: ["accounting", "transactions", query],
    queryFn: () => apiFetch<{ data: Transaction[]; meta: Meta }>("/accounting/transactions", { query }),
    placeholderData: keepPreviousData,
  });
  const writable = can("accounting:write");
  // "ยอดขาย" = the order rows merged in from POS/online sales
  const allCategories = [{ name: "ยอดขาย" }, ...(meta.data?.categories.expense ?? []), ...(meta.data?.categories.income ?? [])];

  const readReceipt = async (file: File) => {
    setReading(true);
    try {
      const payload = await fileToPayload(file);
      const x = await api.post<ReceiptExtraction>("/accounting/ai/extract-receipt", payload);
      setDialog(prefillFromExtraction(x));
    } catch (err) {
      if (err instanceof ApiError && err.code === "INTEGRATION_NOT_CONFIGURED") {
        toast.error(`ยังไม่ได้ตั้งค่า AI บนเซิร์ฟเวอร์ (${err.message}) — กรอกข้อมูลเองได้ตามปกติ`);
        setDialog({ type: "expense" });
      } else toast.error(err instanceof Error ? err.message : "อ่านใบเสร็จไม่สำเร็จ");
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const voidTxn = async (t: Transaction) => {
    const reason = window.prompt(`ยกเลิกรายการ "${t.description}" — ระบุเหตุผล`);
    if (!reason) return;
    try {
      await api.post(`/accounting/transactions/${t.id}/void`, { reason });
      toast.success("ยกเลิกและกลับรายการบัญชีแล้ว");
      void qc.invalidateQueries({ queryKey: ["accounting"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ยกเลิกไม่สำเร็จ");
    }
  };

  const certificate = async (t: Transaction) => {
    if (t.whtCertificateId) return router.push(`/accounting/documents/${t.whtCertificateId}`);
    try {
      const doc = await api.post<{ id: number }>("/accounting/documents/wht-certificate", { transactionId: t.id });
      void qc.invalidateQueries({ queryKey: ["accounting"] });
      router.push(`/accounting/documents/${doc.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ออกหนังสือรับรองไม่สำเร็จ");
    }
  };

  const substitute = async (t: Transaction) => {
    if (t.substituteReceiptId) return router.push(`/accounting/documents/${t.substituteReceiptId}`);
    try {
      const doc = await api.post<{ id: number }>("/accounting/documents/substitute-receipt", { transactionId: t.id });
      void qc.invalidateQueries({ queryKey: ["accounting"] });
      router.push(`/accounting/documents/${doc.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ออกใบรับรองแทนใบเสร็จไม่สำเร็จ");
    }
  };

  const m = list.data?.meta;
  return (
    <>
      <PageHeader
        title="รายรับ-รายจ่าย"
        description="ทุกรายการลงบัญชีคู่อัตโนมัติ และใช้คำนวณ ภ.พ.30 / ภ.ง.ด.3 / ภ.ง.ด.53"
        actions={
          writable && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && void readReceipt(e.target.files[0])}
              />
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={reading}>
                {reading ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {reading ? "AI กำลังอ่าน..." : "AI อ่านใบเสร็จ"}
              </Button>
              <Button onClick={() => setDialog({})}>
                <Plus /> บันทึกรายการ
              </Button>
            </>
          )
        }
      />

      <section className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm text-muted-foreground">รายรับ (ก่อน VAT)</p>
          <p className="mt-1 text-2xl font-semibold text-success">{m ? formatMoney(m.income) : "–"}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-muted-foreground">รายจ่าย (ก่อน VAT)</p>
          <p className="mt-1 text-2xl font-semibold text-danger">{m ? formatMoney(m.expense) : "–"}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-muted-foreground">สุทธิ</p>
          <p className="mt-1 text-2xl font-semibold">{m ? formatMoney(m.income - m.expense) : "–"}</p>
          <p className="mt-1 text-xs text-muted-foreground">รวมยอดขายหน้าร้านและออนไลน์ทุกออร์เดอร์</p>
        </Card>
      </section>

      <Card className="mt-4">
        <div className="flex flex-col gap-3 border-b border-border p-4 xl:flex-row xl:items-center">
          <Segmented<TxnType | "all">
            label="ประเภท"
            value={type}
            onChange={(v) => {
              setType(v);
              setPage(1);
            }}
            options={[
              { value: "all", label: "ทั้งหมด" },
              { value: "income", label: "รายรับ" },
              { value: "expense", label: "รายจ่าย" },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              aria-label="ตั้งแต่"
              value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              className="h-9 w-40"
            />
            <span className="text-muted-foreground">–</span>
            <Input type="date" aria-label="ถึง" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="h-9 w-40" />
            <NativeSelect aria-label="หมวด" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">ทุกหมวด</option>
              {allCategories.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="relative w-full xl:ml-auto xl:max-w-xs">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหารายละเอียด / คู่ค้า" className="h-9 pl-9" aria-label="ค้นหา" />
          </div>
        </div>
        {list.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-cards w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">วันที่</th>
                  <th className="px-4 py-3 font-medium">รายการ</th>
                  <th className="px-4 py-3 font-medium">หมวด</th>
                  <th className="px-4 py-3 text-right font-medium">ก่อน VAT</th>
                  <th className="px-4 py-3 text-right font-medium">VAT</th>
                  <th className="px-4 py-3 text-right font-medium">หัก ณ ที่จ่าย</th>
                  <th className="px-4 py-3 text-right font-medium">สุทธิ</th>
                  <th className="w-24 px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {list.data?.data.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-14 text-center text-muted-foreground">
                      ไม่มีรายการในช่วงนี้
                    </td>
                  </tr>
                )}
                {list.data?.data.map((t) => (
                  <tr
                    key={`${t.source}-${t.id}`}
                    className={`border-b border-border last:border-0 hover:bg-muted/40 ${t.source === "sale" ? "cursor-pointer" : ""}`}
                    onClick={t.source === "sale" ? () => setSaleId(t.id) : undefined}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatThaiDate(t.txnDate)}</td>
                    <td data-label="รายการ" className="max-w-72 px-4 py-3">
                      <p className="truncate font-medium">
                        {t.source === "sale" && <ShoppingBag className="mr-1 inline size-3.5 text-success" aria-hidden />}
                        {t.description} {t.aiExtracted && <Sparkles className="inline size-3.5 text-primary" aria-label="กรอกโดย AI" />}
                      </p>
                      {t.source === "sale" ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {CHANNEL_LABEL[t.channel ?? ""] ?? t.channel} · {t.itemCount} รายการ
                          {t.counterparty ? ` · ${t.counterparty}` : ""}
                          {t.status === "void" ? " · ยกเลิกแล้ว" : ""}
                        </p>
                      ) : (
                        t.counterparty && <p className="truncate text-xs text-muted-foreground">{t.counterparty}</p>
                      )}
                    </td>
                    <td data-label="หมวด" className="px-4 py-3">
                      <Badge tone={t.type === "income" ? "success" : "neutral"} className="whitespace-nowrap">
                        {t.category}
                      </Badge>
                    </td>
                    <td data-label="ก่อน VAT" className={`px-4 py-3 text-right font-medium tabular-nums ${t.type === "income" ? "text-success" : ""}`}>
                      {t.type === "expense" ? "-" : ""}
                      {formatMoney(t.amount)}
                    </td>
                    <td data-label="VAT" className="px-4 py-3 text-right tabular-nums text-muted-foreground">{t.vatAmount ? formatMoney(t.vatAmount) : "–"}</td>
                    <td data-label="หัก ณ ที่จ่าย" className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {t.whtAmount ? `${formatMoney(t.whtAmount)} (${t.whtRate}%)` : "–"}
                    </td>
                    <td data-label="สุทธิ" className="px-4 py-3 text-right tabular-nums">{formatMoney(t.netAmount)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {t.type === "expense" && t.whtAmount > 0 && (
                          <button
                            onClick={() => void certificate(t)}
                            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-primary"
                            title={t.whtCertificateId ? "ดูหนังสือรับรอง 50 ทวิ" : "ออกหนังสือรับรอง 50 ทวิ"}
                            aria-label="หนังสือรับรองการหักภาษี ณ ที่จ่าย"
                          >
                            <FileCheck2 className="size-4" />
                          </button>
                        )}
                        {t.source === "txn" && t.type === "expense" && t.status === "posted" && !t.vatAmount && (writable || t.substituteReceiptId) && (
                          <button
                            onClick={() => void substitute(t)}
                            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-primary"
                            title={t.substituteReceiptId ? "ดูใบรับรองแทนใบเสร็จ" : "ออกใบรับรองแทนใบเสร็จ (ผู้รับเงินไม่มีใบเสร็จ)"}
                            aria-label="ใบรับรองแทนใบเสร็จรับเงิน"
                          >
                            <FileSignature className="size-4" />
                          </button>
                        )}
                        {t.source === "sale" ? (
                          <span className="grid size-8 place-items-center text-muted-foreground" title="ดูรายละเอียดออร์เดอร์">
                            <ChevronRight className="size-4" />
                          </span>
                        ) : (
                          writable && (
                            <button
                              onClick={() => void voidTxn(t)}
                              className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-danger-soft hover:text-danger"
                              title="ยกเลิกรายการ"
                              aria-label="ยกเลิกรายการ"
                            >
                              <Ban className="size-4" />
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && <Pagination {...list.data.meta} onChange={setPage} />}
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">
        ยอดขายแต่ละออร์เดอร์ขึ้นที่นี่และลงบัญชีอัตโนมัติทันทีที่ขาย (คลิกเพื่อดูสินค้าที่ลูกค้าซื้อ) · งบการเงินดูได้ที่{" "}
        <Link href="/accounting/reports" className="text-primary hover:underline">
          รายงานการเงิน
        </Link>
      </p>

      <Dialog open={saleId !== null} onOpenChange={(o) => !o && setSaleId(null)}>
        {saleId !== null && <SaleDetailDialog id={saleId} />}
      </Dialog>
      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog !== null && <TransactionDialog prefill={dialog} onDone={() => setDialog(null)} />}
      </Dialog>
    </>
  );
}
