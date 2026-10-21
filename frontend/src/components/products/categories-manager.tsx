"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Clock, Loader2, Pencil, Plus, ShieldAlert, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Category } from "@/lib/types";
import { formatNumber } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Skeleton } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/overlays";
import { PageHeader } from "@/components/layout/page";
import { ErrorNote } from "@/components/dashboard/widgets";
import { CategoryRulesDialog } from "./category-rules";
import { CATEGORIES_KEY, useCategories } from "./product-form";

export function CategoriesManager() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const categories = useCategories();
  const canWrite = can("products:write");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [rules, setRules] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: CATEGORIES_KEY });

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    try {
      await api.post("/products/categories", { name: name.trim() });
      await refresh();
      toast.success(`เพิ่มหมวด ${name.trim()} แล้ว`);
      setName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เพิ่มไม่สำเร็จ");
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <PageHeader
        title="หมวดหมู่สินค้า"
        description="จัดกลุ่มสินค้าเพื่อค้นหา ทำรายงาน และตั้งกฎการขาย (ช่วงเวลาห้ามขาย / ยืนยันอายุ 20+)"
        actions={
          <>
            <Link href="/products" className="inline-flex min-h-10 items-center text-sm text-muted-foreground hover:text-foreground">
              ← สินค้าทั้งหมด
            </Link>
            {canWrite && categories.data && categories.data.length > 0 && (
              <Button variant="outline" onClick={() => setRules(true)}>
                <Clock className="size-4" /> กฎการขายตามหมวด
              </Button>
            )}
          </>
        }
      />
      <Card className="overflow-hidden">
        {canWrite && (
          <form onSubmit={add} className="flex gap-2 border-b border-border p-4">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อหมวดใหม่ เช่น เครื่องดื่ม" maxLength={191} aria-label="ชื่อหมวดใหม่" />
            <Button type="submit" disabled={adding || !name.trim()}>
              {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} เพิ่มหมวด
            </Button>
          </form>
        )}
        {categories.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : categories.isError ? (
          <ErrorNote onRetry={() => categories.refetch()} />
        ) : !categories.data.length ? (
          <p className="py-12 text-center text-sm text-muted-foreground">ยังไม่มีหมวดหมู่</p>
        ) : (
          <ul className="divide-y divide-border">
            {categories.data.map((c) => (
              <CategoryRow key={c.id} category={c} canWrite={canWrite} onChanged={refresh} />
            ))}
          </ul>
        )}
      </Card>
      <Dialog open={rules} onOpenChange={setRules}>
        {rules && categories.data && <CategoryRulesDialog categories={categories.data} onDone={() => setRules(false)} />}
      </Dialog>
    </>
  );
}

function CategoryRow({ category: c, canWrite, onChanged }: { category: Category; canWrite: boolean; onChanged: () => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.name);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      await onChanged();
      toast.success(ok);
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ");
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      {editing ? (
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && name.trim() !== c.name) void run(() => api.patch(`/products/categories/${c.id}`, { name: name.trim() }), "เปลี่ยนชื่อแล้ว");
            else setEditing(false);
          }}
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={191} className="h-9" aria-label="ชื่อหมวด" />
          <Button type="submit" size="icon" className="size-9 shrink-0" disabled={busy} aria-label="บันทึกชื่อ">
            <Check className="size-4" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="size-9 shrink-0" onClick={() => setEditing(false)} aria-label="ยกเลิก">
            <X className="size-4" />
          </Button>
        </form>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{c.name}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge>{formatNumber(c.productCount)} สินค้า</Badge>
            {c.ageRestricted && (
              <Badge tone="warning">
                <ShieldAlert className="size-3" /> 20+
              </Badge>
            )}
            {c.saleBlock && (
              <Badge tone="warning">
                ห้ามขาย {c.saleBlock.from}–{c.saleBlock.to}
              </Badge>
            )}
          </div>
        </div>
      )}
      {canWrite && !editing && (
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={busy}>
            <Pencil className="size-4" /> เปลี่ยนชื่อ
          </Button>
          <Button
            size="sm"
            variant={confirm ? "danger" : "ghost"}
            className={confirm ? "" : "text-danger"}
            disabled={busy}
            onClick={() => (confirm ? void run(() => api.del(`/products/categories/${c.id}`), `ลบหมวด ${c.name} แล้ว`) : setConfirm(true))}
          >
            <Trash2 className="size-4" />
            {confirm ? (c.productCount ? `ยืนยันลบ (${formatNumber(c.productCount)} สินค้าจะเป็น "ไม่ระบุ")` : "ยืนยันลบ") : "ลบ"}
          </Button>
        </div>
      )}
    </li>
  );
}
