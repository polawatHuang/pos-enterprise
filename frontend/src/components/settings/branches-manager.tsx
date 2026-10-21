"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MapPin, Pencil, Plus, Store, Trash2, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Branch } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Label, Skeleton, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { PageHeader } from "@/components/layout/page";
import { ErrorNote } from "@/components/dashboard/widgets";

const BRANCHES_KEY = ["org", "branches"] as const;

export function BranchesManager() {
  const branches = useQuery({ queryKey: BRANCHES_KEY, queryFn: () => api.get<Branch[]>("/org/branches") });
  // null = closed, "new" = add form, otherwise the branch being edited
  const [editing, setEditing] = useState<Branch | "new" | null>(null);

  return (
    <>
      <PageHeader
        title="สาขาและคลังสินค้า"
        description="สาขาที่ใช้เปิดกะขาย ออกใบกำกับภาษี และตัดสต๊อก — สาขาใหม่จะมีคลังสินค้าของตัวเองให้อัตโนมัติ"
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" /> เพิ่มสาขา
          </Button>
        }
      />
      {branches.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : branches.isError ? (
        <Card>
          <ErrorNote onRetry={() => branches.refetch()} />
        </Card>
      ) : !branches.data.length ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">ยังไม่มีสาขา — กด &quot;เพิ่มสาขา&quot; เพื่อเริ่ม</Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {branches.data.map((b) => (
            <Card key={b.id} className={cn("flex flex-col p-5", !b.isActive && "opacity-60")}>
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                  <Store className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-semibold leading-tight">{b.name}</h2>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <Badge>{b.code}</Badge>
                    <Badge tone="primary">{b.branchNo === "00000" ? "สำนักงานใหญ่" : `สาขาที่ ${b.branchNo}`}</Badge>
                    {!b.isActive && <Badge tone="danger">ปิดใช้งาน</Badge>}
                  </div>
                </div>
              </div>
              <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                <p className="flex gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0" />
                  <span className="line-clamp-2">{b.address || "ยังไม่ได้ใส่ที่อยู่"}</span>
                </p>
                <p className="flex gap-2">
                  <Warehouse className="mt-0.5 size-4 shrink-0" />
                  {b.warehouseName ?? "ไม่มีคลังสินค้าผูกกับสาขานี้ (ขายจากคลังแรกขององค์กร)"}
                </p>
              </div>
              <div className="mt-auto flex justify-end pt-4">
                <Button size="sm" variant="outline" onClick={() => setEditing(b)}>
                  <Pencil className="size-4" /> แก้ไข
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing !== null && (
          <BranchDialog key={editing === "new" ? "new" : editing.id} branch={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
        )}
      </Dialog>
    </>
  );
}

function BranchDialog({ branch, onClose }: { branch: Branch | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState(branch?.code ?? "");
  const [name, setName] = useState(branch?.name ?? "");
  const [branchNo, setBranchNo] = useState(branch?.branchNo ?? "");
  const [address, setAddress] = useState(branch?.address ?? "");
  const [isActive, setIsActive] = useState(branch?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const remove = async () => {
    if (!branch) return;
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    try {
      await api.del(`/org/branches/${branch.id}`);
      await qc.invalidateQueries({ queryKey: BRANCHES_KEY });
      toast.success(`ลบสาขา ${branch.name} แล้ว`);
      onClose();
    } catch (err) {
      // e.g. the branch has sales or stock history: the message suggests disabling it instead
      toast.error(err instanceof Error ? err.message : "ลบไม่สำเร็จ", { duration: 10_000 });
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const body = { code: code.trim(), name: name.trim(), branchNo: branchNo.trim(), address: address.trim() || null };
    try {
      if (branch) await api.patch(`/org/branches/${branch.id}`, { ...body, isActive });
      else await api.post("/org/branches", body);
      await qc.invalidateQueries({ queryKey: BRANCHES_KEY });
      toast.success(branch ? "บันทึกสาขาแล้ว" : "เพิ่มสาขาและคลังสินค้าแล้ว");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      setBusy(false);
    }
  };

  return (
    <DialogContent title={branch ? `แก้ไขสาขา ${branch.name}` : "เพิ่มสาขา"} description="เลขที่สาขาใช้พิมพ์บนใบกำกับภาษี: สำนักงานใหญ่ = 00000">
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-[1fr_8rem] gap-3">
          <div className="space-y-2">
            <Label htmlFor="br-name">ชื่อสาขา</Label>
            <Input id="br-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น สาขาสยาม" required maxLength={191} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="br-code">รหัส</Label>
            <Input
              id="br-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="SIAM"
              required
              maxLength={32}
              pattern="[A-Za-z0-9_\-]+"
              title="A-Z, 0-9, - และ _"
              className="font-mono"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="br-no">เลขที่สาขา (กรมสรรพากร)</Label>
          <Input
            id="br-no"
            value={branchNo}
            onChange={(e) => setBranchNo(e.target.value.replace(/\D/g, "").slice(0, 5))}
            placeholder="00000"
            inputMode="numeric"
            required
            pattern="\d{5}"
            title="ตัวเลข 5 หลัก"
            className="font-mono"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="br-address">ที่อยู่</Label>
          <Textarea id="br-address" value={address} onChange={(e) => setAddress(e.target.value)} rows={3} placeholder="ที่อยู่สำหรับใบเสร็จและใบกำกับภาษี" />
        </div>
        {branch && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="size-4 accent-primary" />
            เปิดใช้งาน (สาขาที่ปิดจะเลือกเปิดกะขายไม่ได้ แต่ข้อมูลเดิมยังอยู่ครบ)
          </label>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          {branch && (
            <Button type="button" variant={confirmDelete ? "danger" : "ghost"} onClick={remove} disabled={busy} className={cn("mr-auto", !confirmDelete && "text-danger")}>
              <Trash2 className="size-4" />
              {confirmDelete ? "ยืนยันลบสาขานี้" : "ลบสาขา"}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {branch ? "บันทึก" : "เพิ่มสาขา"}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
