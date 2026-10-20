"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { Paged, Product } from "@/lib/types";
import { formatMoney, formatNumber } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, NativeSelect, Pagination, Skeleton } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/overlays";
import { PageHeader } from "@/components/layout/page";
import { ErrorNote } from "@/components/dashboard/widgets";
import { CategoryRulesDialog } from "./category-rules";
import { ProductFormDialog, useCategories } from "./product-form";

export const STATUS_LABEL: Record<string, { label: string; tone: "success" | "neutral" | "danger" }> = {
  active: { label: "พร้อมขาย", tone: "success" },
  draft: { label: "ฉบับร่าง", tone: "neutral" },
  archived: { label: "เลิกขาย", tone: "danger" },
};

export function ProductsView() {
  const router = useRouter();
  const { can } = useAuth();
  const categories = useCategories();
  // The global search "ดูทั้งหมด" opens this page with ?q=
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("all");
  const [lowStock, setLowStock] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [rules, setRules] = useState(false);

  const query = { q, categoryId, status, lowStock: lowStock ? "true" : undefined, page, pageSize: 25 };
  const products = useQuery({
    queryKey: ["products", "list", query],
    queryFn: () => apiFetch<Paged<Product>>("/products", { query }),
    placeholderData: keepPreviousData,
  });
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="สินค้า"
        description="แคตตาล็อกกลางของทุกช่องทาง และฐานความรู้ให้ AI"
        actions={
          can("products:write") && (
            <>
              <Button variant="outline" onClick={() => setRules(true)} disabled={!categories.data?.length}>
                กฎการขายตามหมวด
              </Button>
              <Button onClick={() => setCreating(true)}>
                <Plus /> เพิ่มสินค้า
              </Button>
            </>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center">
          <div className="relative w-full lg:max-w-xs">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => resetPage(setQ)(e.target.value)}
              placeholder="ค้นหาชื่อ / SKU / บาร์โค้ด"
              className="h-9 pl-9"
              aria-label="ค้นหาสินค้า"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label="หมวดหมู่" value={categoryId} onChange={(e) => resetPage(setCategoryId)(e.target.value)}>
              <option value="">ทุกหมวดหมู่</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.productCount})
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="สถานะ" value={status} onChange={(e) => resetPage(setStatus)(e.target.value)}>
              <option value="all">ทุกสถานะ (ยกเว้นเลิกขาย)</option>
              <option value="active">พร้อมขาย</option>
              <option value="draft">ฉบับร่าง</option>
              <option value="archived">เลิกขาย</option>
            </NativeSelect>
            <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm">
              <input type="checkbox" checked={lowStock} onChange={(e) => resetPage(setLowStock)(e.target.checked)} className="accent-[var(--primary)]" />
              เฉพาะสต๊อกต่ำ
            </label>
          </div>
          <p className="text-sm text-muted-foreground lg:ml-auto">{products.data ? `${formatNumber(products.data.meta.total)} รายการ` : " "}</p>
        </div>

        {products.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : products.isError && !products.data ? (
          <ErrorNote onRetry={() => products.refetch()} />
        ) : products.data?.data.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">ไม่พบสินค้าที่ตรงกับเงื่อนไข</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">สินค้า</th>
                  <th className="px-4 py-3 font-medium">หมวดหมู่</th>
                  <th className="px-4 py-3 text-right font-medium">ราคาขาย</th>
                  <th className="px-4 py-3 text-right font-medium">ต้นทุน</th>
                  <th className="px-4 py-3 text-right font-medium">คงเหลือ</th>
                  <th className="px-4 py-3 font-medium">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {products.data?.data.map((p) => {
                  const low = p.onHand <= p.reorderPoint;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => router.push(`/products/${p.id}`)}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-4 py-3">
                        <Link href={`/products/${p.id}`} className="font-medium hover:text-primary" onClick={(e) => e.stopPropagation()}>
                          {p.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {p.sku}
                          {p.barcode ? ` · ${p.barcode}` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{p.categoryName ?? "–"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatMoney(p.price)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{formatMoney(p.cost)}</td>
                      <td className="px-4 py-3 text-right">
                        <Badge tone={p.onHand <= 0 ? "danger" : low ? "warning" : "neutral"}>
                          {formatNumber(p.onHand)} {p.unit}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={STATUS_LABEL[p.status].tone}>{STATUS_LABEL[p.status].label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {products.data && <Pagination {...products.data.meta} onChange={setPage} />}
      </Card>

      <Dialog open={rules} onOpenChange={setRules}>
        {rules && categories.data && <CategoryRulesDialog categories={categories.data} onDone={() => setRules(false)} />}
      </Dialog>
      <Dialog open={creating} onOpenChange={setCreating}>
        {creating && (
          <ProductFormDialog
            onSaved={(p) => {
              setCreating(false);
              router.push(`/products/${p.id}`);
            }}
          />
        )}
      </Dialog>
    </>
  );
}
