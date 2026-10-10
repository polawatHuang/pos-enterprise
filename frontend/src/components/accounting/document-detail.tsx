"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Banknote, Copy, FileCheck, Loader2, Pencil, Printer } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { AccDocument, DocType } from "@/lib/types";
import { formatThaiDate } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label, NativeSelect, Skeleton } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { DocumentPaper } from "./document-paper";
import { DocumentEditor } from "./document-editor";
import { DOC_STATUS, DOC_TYPE_LABEL, PAYMENT_LABEL } from "./labels";

type Action = "issue" | "pay" | "void" | null;

export function DocumentDetail({ id }: { id: number }) {
  const { can } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [action, setAction] = useState<Action>(null);
  const [editing, setEditing] = useState(false);
  const key = ["accounting", "document", id];
  const doc = useQuery({ queryKey: key, queryFn: () => api.get<AccDocument>(`/accounting/documents/${id}`) });

  if (doc.isPending) return <Skeleton className="h-[80vh] w-full rounded-xl" />;
  if (doc.isError) return <p className="py-16 text-center text-muted-foreground">{doc.error.message}</p>;
  const d = doc.data;
  if (editing) return <DocumentEditor initial={d} />;

  const writable = can("accounting:write");
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["accounting"] });
  };
  const convert = async (to: DocType) => {
    try {
      const created = await api.post<AccDocument>(`/accounting/documents/${id}/convert`, { docType: to });
      refresh();
      router.push(`/accounting/documents/${created.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "แปลงเอกสารไม่สำเร็จ");
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 print:hidden lg:flex-row lg:items-center lg:justify-between">
        <div>
          <Link href="/accounting/documents" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> เอกสารทั้งหมด
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">
              {DOC_TYPE_LABEL[d.docType]} {d.isDraft ? "(ฉบับร่าง)" : d.docNo}
            </h1>
            <Badge tone={DOC_STATUS[d.status].tone}>{DOC_STATUS[d.status].label}</Badge>
          </div>
          {d.status === "paid" && d.paymentMethod && (
            <p className="text-sm text-muted-foreground">
              รับชำระด้วย{PAYMENT_LABEL[d.paymentMethod] ?? d.paymentMethod}
              {d.paidAt ? ` เมื่อ ${formatThaiDate(d.paidAt.slice(0, 10))}` : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer /> พิมพ์ / PDF
          </Button>
          {writable && d.isDraft && (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> แก้ไข
              </Button>
              <Button onClick={() => setAction("issue")}>
                <FileCheck /> ออกเอกสาร
              </Button>
            </>
          )}
          {writable && d.status === "issued" && (d.docType === "invoice" || d.docType === "tax_invoice") && (
            <Button onClick={() => setAction("pay")}>
              <Banknote /> บันทึกรับชำระ
            </Button>
          )}
          {writable && d.docType === "quotation" && d.status === "issued" && (
            <Button variant="outline" onClick={() => void convert("tax_invoice")}>
              <Copy /> สร้างใบกำกับภาษีจากใบนี้
            </Button>
          )}
          {writable && ["tax_invoice", "tax_invoice_receipt"].includes(d.docType) && ["issued", "paid"].includes(d.status) && (
            <Button variant="outline" onClick={() => void convert("credit_note")}>
              <Copy /> ออกใบลดหนี้
            </Button>
          )}
          {writable && d.status !== "void" && (
            <Button variant="ghost" className="text-danger" onClick={() => setAction("void")}>
              <Ban /> {d.isDraft ? "ลบฉบับร่าง" : "ยกเลิก"}
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-muted/50 p-2 sm:p-6 print:bg-transparent print:p-0">
        <DocumentPaper doc={d} />
      </div>

      <Dialog open={action !== null} onOpenChange={(o) => !o && setAction(null)}>
        {action && (
          <ActionDialog
            doc={d}
            action={action}
            onDone={(deleted) => {
              setAction(null);
              refresh();
              if (deleted) router.push("/accounting/documents");
            }}
          />
        )}
      </Dialog>
    </>
  );
}

function ActionDialog({ doc, action, onDone }: { doc: AccDocument; action: Exclude<Action, null>; onDone: (deleted?: boolean) => void }) {
  const needsMethod = action === "pay" || (action === "issue" && ["receipt", "tax_invoice_receipt"].includes(doc.docType));
  const [method, setMethod] = useState("transfer");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      if (action === "issue") {
        const r = await api.post<AccDocument>(`/accounting/documents/${doc.id}/issue`, needsMethod ? { paymentMethod: method } : {});
        toast.success(`ออกเอกสารเลขที่ ${r.docNo} แล้ว`);
      } else if (action === "pay") {
        await api.post(`/accounting/documents/${doc.id}/pay`, { paymentMethod: method });
        toast.success("บันทึกรับชำระและลงบัญชีแล้ว");
      } else {
        await api.post(`/accounting/documents/${doc.id}/void`, { reason });
        toast.success(doc.isDraft ? "ลบฉบับร่างแล้ว" : "ยกเลิกเอกสารและกลับรายการบัญชีแล้ว");
      }
      onDone(action === "void" && doc.isDraft);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const title = action === "issue" ? "ออกเอกสาร" : action === "pay" ? "บันทึกรับชำระ" : doc.isDraft ? "ลบฉบับร่าง" : "ยกเลิกเอกสาร";
  const description =
    action === "issue"
      ? "ระบบจะออกเลขที่ต่อเนื่องและลงบัญชีทันที หลังจากนี้แก้ไขเอกสารไม่ได้ (ต้องยกเลิกแล้วออกใหม่)"
      : action === "void" && !doc.isDraft
        ? "เลขที่เอกสารจะถูกเก็บไว้พร้อมสถานะยกเลิก และระบบจะกลับรายการบัญชีให้"
        : undefined;

  return (
    <DialogContent title={title} description={description}>
      <div className="grid gap-4">
        {needsMethod && (
          <div className="space-y-2">
            <Label htmlFor="method">ช่องทางรับชำระ</Label>
            <NativeSelect id="method" className="h-10 w-full" value={method} onChange={(e) => setMethod(e.target.value)}>
              {["transfer", "cash", "card", "promptpay", "cheque"].map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_LABEL[m]}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        {action === "void" && (
          <div className="space-y-2">
            <Label htmlFor="reason">เหตุผล</Label>
            <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </div>
        )}
        <Button variant={action === "void" ? "danger" : "default"} onClick={run} disabled={busy || (action === "void" && !reason.trim())}>
          {busy && <Loader2 className="animate-spin" />}
          ยืนยัน
        </Button>
      </div>
    </DialogContent>
  );
}
