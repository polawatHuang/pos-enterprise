"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Skeleton } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { PageHeader } from "@/components/layout/page";

interface Summary {
  groups: { label: string; items: { key: string; label: string; count: number }[] }[];
  confirmPhrase: string;
}

const countOf = (s: Summary, key: string) => s.groups.flatMap((g) => g.items).find((i) => i.key === key)?.count ?? 0;

const KEPT = [
  "บัญชีของคุณ (admin)",
  "ข้อมูลบริษัท สาขา และคลัง (รวม PromptPay/บัญชีของแต่ละสาขา)",
  "ผังบัญชี",
  "ตั้งค่า POS: PromptPay / บัญชีธนาคาร / แต้ม / ส่วนลดสูงสุด",
  "ตั้งค่าภาษี และวงเงินสวัสดิการเริ่มต้น",
  "API key ที่บันทึกไว้ และตั้งค่า LINE",
  "ตั้งค่า AI แชต",
];

/** Settings > จัดการข้อมูล: wipe the demo data before going live (owner/admin only). */
export function DataResetView() {
  const { user } = useAuth();
  const isOwner = !!user?.roles.some((r) => r === "owner" || r === "admin");
  const summary = useQuery({ queryKey: ["org", "data-summary"], queryFn: () => api.get<Summary>("/org/data-summary"), enabled: isOwner });
  const [open, setOpen] = useState(false);

  return (
    <>
      <PageHeader title="จัดการข้อมูล" description="ล้างข้อมูลตัวอย่างก่อนเริ่มใช้งานจริง" />
      {!isOwner ? (
        <Card className="p-6 text-sm text-muted-foreground">เฉพาะเจ้าของกิจการหรือผู้ดูแลระบบเท่านั้น</Card>
      ) : (
        <Card className="border-danger/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-danger">
              <AlertTriangle className="size-5" /> ลบข้อมูลตัวอย่างทั้งหมด
            </CardTitle>
            <CardDescription>ลบข้อมูลทุกอย่างในระบบ เหลือไว้เฉพาะบัญชี admin ของคุณและการตั้งค่าพื้นฐาน กู้คืนไม่ได้</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium">จะถูกลบ</p>
              {summary.isPending ? (
                <Skeleton className="h-40" />
              ) : (
                <div className="space-y-3">
                  {summary.data?.groups.map((g) => (
                    <div key={g.label}>
                      <p className="mb-1 text-xs font-medium text-muted-foreground">{g.label}</p>
                      <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
                        {g.items.map((i) => (
                          <li key={i.key} className="flex justify-between gap-2 rounded-lg bg-danger-soft/40 px-3 py-2">
                            <span>{i.label}</span>
                            <span className="font-semibold tabular-nums">{formatNumber(i.count)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">รวมถึงยอดคงเหลือ ล็อตสินค้า ใบเสร็จ/สลิป การแจ้งเตือน และไฟล์สื่อที่อัปโหลดทั้งหมด</p>
                </div>
              )}
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">เก็บไว้</p>
              <ul className="space-y-1.5 text-sm">
                {KEPT.map((k) => (
                  <li key={k} className="flex items-center gap-2">
                    <ShieldCheck className="size-4 text-success" /> {k}
                  </li>
                ))}
              </ul>
            </div>
            <div className="md:col-span-2">
              <Button variant="danger" onClick={() => setOpen(true)} disabled={!summary.data}>
                <Trash2 /> ลบข้อมูลตัวอย่างทั้งหมด
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <Dialog open={open} onOpenChange={setOpen}>{open && summary.data && <ConfirmDialog summary={summary.data} onClose={() => setOpen(false)} />}</Dialog>
    </>
  );
}

function ConfirmDialog({ summary, onClose }: { summary: Summary; onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = text.trim() === summary.confirmPhrase;

  const run = async () => {
    setBusy(true);
    try {
      await api.post("/org/reset-data", { confirm: text.trim() });
      toast.success("ลบข้อมูลตัวอย่างเรียบร้อย พร้อมเริ่มใช้งานจริง", { icon: <CheckCircle2 className="size-4" /> });
      qc.clear();
      onClose();
      router.push("/products");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
      setBusy(false);
    }
  };

  return (
    <DialogContent title="ยืนยันจะลบข้อมูลไหม?" description="ข้อมูลทั้งหมดจะถูกลบถาวรและกู้คืนไม่ได้" className="max-w-md">
      <div className="grid gap-4">
        <div className="flex gap-3 rounded-xl bg-danger-soft p-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <p>
            จะลบสินค้า {formatNumber(countOf(summary, "products"))} รายการ, บิล {formatNumber(countOf(summary, "salesOrders"))} ใบ, ลูกค้า{" "}
            {formatNumber(countOf(summary, "customers"))} ราย, เอกสาร {formatNumber(countOf(summary, "documents"))} ฉบับ, โปรโมชั่น{" "}
            {formatNumber(countOf(summary, "promotions"))} รายการ, เบิกสวัสดิการ {formatNumber(countOf(summary, "welfareRequests"))} รายการ และผู้ใช้อื่น{" "}
            {formatNumber(countOf(summary, "otherUsers"))} คน พร้อมข้อมูลอื่นทั้งหมด
          </p>
        </div>
        <label className="grid gap-1.5 text-sm">
          <span>
            พิมพ์ <span className="rounded bg-muted px-1.5 py-0.5 font-semibold">{summary.confirmPhrase}</span> เพื่อยืนยัน
          </span>
          <Input value={text} onChange={(e) => setText(e.target.value)} autoFocus aria-label="พิมพ์คำยืนยัน" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button variant="danger" onClick={run} disabled={!ok || busy}>
            {busy && <Loader2 className="animate-spin" />}
            ยืนยันลบ
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}
