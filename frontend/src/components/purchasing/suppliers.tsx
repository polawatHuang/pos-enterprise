"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Supplier } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label, Skeleton } from "@/components/ui/primitives";
import { ErrorNote } from "@/components/dashboard/widgets";
import { Dialog, DialogContent } from "@/components/ui/overlays";

export function SuppliersList() {
  const { can } = useAuth();
  const suppliers = useQuery({ queryKey: ["purchasing", "suppliers"], queryFn: () => api.get<Supplier[]>("/purchasing/suppliers") });
  const [edit, setEdit] = useState<Supplier | "new" | null>(null);
  return (
    <>
      {can("purchasing:write") && (
        <div className="flex justify-end p-4 pb-0">
          <Button size="sm" onClick={() => setEdit("new")}>
            <Plus /> เพิ่มผู้ขาย
          </Button>
        </div>
      )}
      {suppliers.isPending ? (
        <Skeleton className="m-4 h-40" />
      ) : suppliers.isError ? (
        <ErrorNote onRetry={() => suppliers.refetch()} error={suppliers.error} />
      ) : !suppliers.data?.length ? (
        <p className="p-12 text-center text-sm text-muted-foreground">ยังไม่มีผู้ขาย — กด &quot;เพิ่มผู้ขาย&quot; เพื่อเริ่ม แล้วผูกกับสินค้าเพื่อสั่งซื้อได้เร็วขึ้น</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-cards w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">ผู้ขาย</th>
                <th className="px-4 py-3 font-medium">ติดต่อ</th>
                <th className="px-4 py-3 text-right font-medium">ส่งของ (วัน)</th>
                <th className="px-4 py-3 text-right font-medium">สินค้า</th>
                <th className="px-4 py-3 text-right font-medium">ใบที่รอของ</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.data?.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <button className="font-medium hover:text-primary" onClick={() => can("purchasing:write") && setEdit(s)}>
                      {s.name}
                    </button>
                    {!s.isActive && <Badge className="ml-2">ปิดใช้</Badge>}
                    {s.taxId && <p className="text-xs text-muted-foreground">{s.taxId}</p>}
                  </td>
                  <td data-label="ติดต่อ" className="px-4 py-3 text-muted-foreground">{[s.contact, s.phone].filter(Boolean).join(" · ") || "–"}</td>
                  <td data-label="ส่งของ (วัน)" className="px-4 py-3 text-right tabular-nums">{s.leadTimeDays}</td>
                  <td data-label="สินค้า" className="px-4 py-3 text-right tabular-nums">{s.productCount}</td>
                  <td data-label="ใบที่รอของ" className="px-4 py-3 text-right tabular-nums">{s.openOrders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)}>
        {edit !== null && <SupplierDialog supplier={edit === "new" ? null : edit} onDone={() => setEdit(null)} />}
      </Dialog>
    </>
  );
}

function SupplierDialog({ supplier, onDone }: { supplier: Supplier | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: supplier?.name ?? "",
    taxId: supplier?.taxId ?? "",
    contact: supplier?.contact ?? "",
    phone: supplier?.phone ?? "",
    email: supplier?.email ?? "",
    leadTimeDays: String(supplier?.leadTimeDays ?? 2),
    note: supplier?.note ?? "",
    isActive: supplier?.isActive ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = async () => {
    if (!supplier) return;
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    try {
      await api.del(`/purchasing/suppliers/${supplier.id}`);
      toast.success(`ลบผู้ขาย ${supplier.name} แล้ว`);
      void qc.invalidateQueries({ queryKey: ["purchasing"] });
      onDone();
    } catch (err) {
      // e.g. it has purchase orders: the message says to switch it off instead
      toast.error(err instanceof Error ? err.message : "ลบไม่สำเร็จ", { duration: 10_000 });
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f, leadTimeDays: Number(f.leadTimeDays) || 0 };
      if (supplier) await api.patch(`/purchasing/suppliers/${supplier.id}`, body);
      else await api.post("/purchasing/suppliers", body);
      toast.success("บันทึกผู้ขายแล้ว");
      void qc.invalidateQueries({ queryKey: ["purchasing"] });
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  const field = (k: keyof typeof f, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`sup-${k}`}>{label}</Label>
      <Input id={`sup-${k}`} value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />
    </div>
  );
  return (
    <DialogContent title={supplier ? "แก้ไขผู้ขาย" : "เพิ่มผู้ขาย"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">{field("name", "ชื่อผู้ขาย")}</div>
        {field("contact", "ผู้ติดต่อ")}
        {field("phone", "โทร", { inputMode: "tel" })}
        {field("email", "อีเมล", { type: "email" })}
        {field("taxId", "เลขผู้เสียภาษี")}
        {field("leadTimeDays", "ส่งของภายใน (วัน)", { inputMode: "numeric" })}
        {field("note", "หมายเหตุ (เช่น สั่งได้ทุกวันจันทร์)")}
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> ใช้งานอยู่
        </label>
        <Button className="sm:col-span-2" onClick={save} disabled={busy || !f.name.trim()}>
          {busy && <Loader2 className="animate-spin" />}
          บันทึก
        </Button>
        {supplier && (
          <Button variant={confirmDelete ? "danger" : "ghost"} className={cn("sm:col-span-2", !confirmDelete && "text-danger")} onClick={() => void remove()} disabled={busy}>
            <Trash2 /> {confirmDelete ? "ยืนยันลบผู้ขายนี้" : "ลบผู้ขาย"}
          </Button>
        )}
      </div>
    </DialogContent>
  );
}
