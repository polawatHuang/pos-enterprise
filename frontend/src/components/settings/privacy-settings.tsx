"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { DataRequest, DataRequestKind, DataRequestStatus, Organization } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect, Skeleton, Textarea } from "@/components/ui/primitives";

export const DATA_REQUEST_KIND: Record<DataRequestKind, string> = {
  delete: "ลบข้อมูล",
  access: "ขอสำเนาข้อมูล",
  correct: "แก้ไขข้อมูล",
  object: "คัดค้านการประมวลผล",
  withdraw: "ถอนความยินยอม",
};
const STATUS: Record<DataRequestStatus, { label: string; tone: "warning" | "primary" | "success" | undefined }> = {
  new: { label: "ใหม่", tone: "warning" },
  in_progress: { label: "กำลังดำเนินการ", tone: "primary" },
  done: { label: "เสร็จแล้ว", tone: "success" },
  rejected: { label: "ปฏิเสธ", tone: undefined },
};

/** Business details: document headers and the provider / data controller on /terms and /privacy. */
export function BusinessInfoCard() {
  const q = useQuery({ queryKey: ["org", "organization"], queryFn: () => api.get<Organization>("/org/organization") });
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>ข้อมูลกิจการ</CardTitle>
        <CardDescription>
          ใช้ในหัวเอกสาร และเป็น &quot;ผู้ให้บริการ / ผู้ควบคุมข้อมูลส่วนบุคคล&quot; ในหน้า{" "}
          <a href="/terms" target="_blank" className="text-primary hover:underline">
            ข้อกำหนดการใช้บริการ
          </a>{" "}
          และ{" "}
          <a href="/privacy" target="_blank" className="text-primary hover:underline">
            นโยบายความเป็นส่วนตัว
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent>{q.data ? <BusinessForm key={JSON.stringify(q.data)} org={q.data} /> : <Skeleton className="h-64" />}</CardContent>
    </Card>
  );
}

function BusinessForm({ org }: { org: Organization }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: org.name,
    legalName: org.legalName ?? "",
    taxId: org.taxId ?? "",
    address: org.address ?? "",
    phone: org.phone ?? "",
    email: org.email ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.put("/org/organization", f);
      await qc.invalidateQueries({ queryKey: ["org", "organization"] });
      toast.success("บันทึกข้อมูลกิจการแล้ว");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="org-name">ชื่อร้าน / ชื่อบริการ</Label>
        <Input id="org-name" value={f.name} onChange={set("name")} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="org-legal">ชื่อตามกฎหมาย (บริษัท / บุคคล)</Label>
        <Input id="org-legal" value={f.legalName} onChange={set("legalName")} placeholder="บริษัท ตัวอย่าง จำกัด" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="org-tax">เลขประจำตัวผู้เสียภาษี</Label>
        <Input id="org-tax" value={f.taxId} onChange={set("taxId")} inputMode="numeric" maxLength={13} placeholder="13 หลัก" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="org-phone">เบอร์โทร</Label>
        <Input id="org-phone" value={f.phone} onChange={set("phone")} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="org-email">อีเมลติดต่อ (รับคำขอเรื่องข้อมูลส่วนบุคคล)</Label>
        <Input id="org-email" type="email" value={f.email} onChange={set("email")} placeholder="privacy@example.com" />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="org-address">ที่อยู่</Label>
        <Textarea id="org-address" value={f.address} onChange={set("address")} rows={2} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} บันทึก
        </Button>
      </div>
    </form>
  );
}

/** Requests from the public /data-deletion page; PDPA gives 30 days to answer. */
export function DataRequestsCard() {
  const q = useQuery({ queryKey: ["org", "data-requests"], queryFn: () => api.get<DataRequest[]>("/org/data-requests") });
  const open = q.data?.filter((r) => r.status === "new" || r.status === "in_progress").length ?? 0;
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          คำขอเรื่องข้อมูลส่วนบุคคล {open > 0 && <Badge tone="warning">รอดำเนินการ {open}</Badge>}
        </CardTitle>
        <CardDescription>
          ส่งมาจากหน้า{" "}
          <a href="/data-deletion" target="_blank" className="inline-flex items-center gap-0.5 text-primary hover:underline">
            คำขอลบข้อมูล <ExternalLink className="size-3" />
          </a>{" "}
          ต้องดำเนินการและแจ้งผู้ขอภายใน 30 วัน (พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล) — ลบแชต/ข้อมูลลูกค้าได้ที่หน้าแชตและหน้าลูกค้า แล้วกด &quot;เสร็จแล้ว&quot;
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.isPending ? (
          <Skeleton className="h-24" />
        ) : !q.data?.length ? (
          <p className="text-sm text-muted-foreground">ยังไม่มีคำขอ</p>
        ) : (
          <ul className="divide-y divide-border">
            {q.data.map((r) => (
              <RequestRow key={r.id} r={r} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RequestRow({ r }: { r: DataRequest }) {
  const qc = useQueryClient();
  const [note, setNote] = useState(r.note ?? "");
  const [busy, setBusy] = useState(false);
  const overdue = (r.status === "new" || r.status === "in_progress") && new Date(r.dueAt) < new Date();
  const update = async (status: DataRequestStatus) => {
    setBusy(true);
    try {
      await api.patch(`/org/data-requests/${r.id}`, { status, note });
      await qc.invalidateQueries({ queryKey: ["org", "data-requests"] });
      toast.success("อัปเดตคำขอแล้ว");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "อัปเดตไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="space-y-2 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs">{r.ref}</span>
        <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
        <span className="font-medium">{DATA_REQUEST_KIND[r.kind]}</span>
        <span className={cn("ml-auto text-xs", overdue ? "font-medium text-danger" : "text-muted-foreground")}>
          รับ {formatDateTime(r.createdAt)} · ตอบภายใน {formatDateTime(r.dueAt)}
        </span>
      </div>
      <p>
        {r.name} · {r.contact} · ช่องทาง {r.platform}
      </p>
      {r.detail && <p className="whitespace-pre-wrap text-muted-foreground">{r.detail}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="บันทึกสิ่งที่ทำ / เหตุผลที่ปฏิเสธ" className="h-9 min-w-0 flex-1" />
        <NativeSelect
          aria-label="สถานะ"
          value={r.status}
          disabled={busy}
          onChange={(e) => void update(e.target.value as DataRequestStatus)}
          className="h-9 w-auto"
        >
          {Object.entries(STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      {r.handledAt && (
        <p className="text-xs text-muted-foreground">
          ปิดเมื่อ {formatDateTime(r.handledAt)}
          {r.handledBy ? ` โดย ${r.handledBy}` : ""}
        </p>
      )}
    </li>
  );
}
