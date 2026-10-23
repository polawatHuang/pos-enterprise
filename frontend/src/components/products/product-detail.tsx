"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { KnowledgeEntry, ProductDetail as ProductDetailT, StockMovement } from "@/lib/types";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/utils";
import { lineVatRate, netOfInclusive, useTaxSettings } from "@/lib/tax";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Skeleton, Textarea } from "@/components/ui/primitives";
import { UnitsPanel } from "./units-panel";
import { Dialog } from "@/components/ui/overlays";
import { MovementTypeBadge } from "@/components/inventory/movement-badge";
import { ProductFormDialog } from "./product-form";
import { STATUS_LABEL } from "./products-view";

export function ProductDetail({ id }: { id: number }) {
  const { can } = useAuth();
  const { tax } = useTaxSettings();
  const router = useRouter();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const product = useQuery({ queryKey: ["products", "detail", id], queryFn: () => api.get<ProductDetailT>(`/products/${id}`) });
  const movements = useQuery({
    queryKey: ["inventory", "movements", { productId: id }],
    queryFn: () => api.get<StockMovement[]>("/inventory/movements", { productId: id, limit: 20 }),
    enabled: can("inventory:read"),
  });

  if (product.isPending) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (product.isError) return <p className="py-16 text-center text-muted-foreground">{product.error.message}</p>;
  const p = product.data;
  const rate = lineVatRate(tax, p.vatType);
  const net = netOfInclusive(p.price, rate);

  const remove = async () => {
    if (!confirmDelete) return setConfirmDelete(true);
    setDeleting(true);
    try {
      await api.del(`/products/${p.id}`);
      toast.success(`ลบ ${p.name} แล้ว`);
      await qc.invalidateQueries({ queryKey: ["products"] });
      router.push("/products");
    } catch (err) {
      // A product with sales or stock history is refused with the reason and "เลิกขาย" as the alternative
      toast.error(err instanceof Error ? err.message : "ลบไม่สำเร็จ", { duration: 10_000 });
      setConfirmDelete(false);
      setDeleting(false);
    }
  };
  const margin = net > 0 ? ((net - p.cost) / net) * 100 : 0;

  return (
    <>
      <Link href="/products" className="mb-2 inline-flex min-h-10 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> สินค้าทั้งหมด
      </Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
            <Badge tone={STATUS_LABEL[p.status].tone}>{STATUS_LABEL[p.status].label}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            รหัส {p.sku}
            {p.barcode && ` · บาร์โค้ด ${p.barcode}`}
            {p.categoryName && ` · ${p.categoryName}`}
          </p>
        </div>
        {can("products:write") && (
          <div className="flex flex-wrap gap-2">
            <Button variant={confirmDelete ? "danger" : "ghost"} onClick={remove} disabled={deleting} className={confirmDelete ? "" : "text-danger"}>
              <Trash2 /> {confirmDelete ? "ยืนยันลบสินค้านี้" : "ลบสินค้า"}
            </Button>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> แก้ไขสินค้า
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="ราคาขาย (รวม VAT)" value={formatMoney(p.price)} hint={rate ? `ก่อน VAT ${formatMoney(net)}` : "ไม่มี VAT"} />
        <Stat label="ต้นทุนเฉลี่ย" value={formatMoney(p.cost)} hint="คำนวณแบบถัวเฉลี่ยเมื่อรับสินค้า" />
        <Stat label="มาร์จิ้น" value={`${margin.toFixed(1)}%`} hint={`กำไร ${formatMoney(net - p.cost)} / ${p.unit}`} />
        <Stat
          label="คงเหลือรวม"
          value={`${formatNumber(p.onHand)} ${p.unit}`}
          hint={`จุดสั่งซื้อ ${formatNumber(p.reorderPoint)}`}
          alert={p.onHand <= p.reorderPoint}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>สต๊อกตามคลัง</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {p.stock.map((s) => (
                <li key={s.warehouseId} className="flex items-center justify-between py-2.5 text-sm">
                  <span>{s.name}</span>
                  <span className="font-medium tabular-nums">
                    {formatNumber(s.quantity)} {p.unit}
                  </span>
                </li>
              ))}
            </ul>
            {can("inventory:write") && (
              <Link href="/inventory" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
                รับเข้า / ปรับ / โอนย้าย →
              </Link>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>ข้อมูลสำหรับลูกค้าและ AI</CardTitle>
              <CardDescription>AI แชตและ AI Video จะใช้ข้อมูลส่วนนี้</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">รายละเอียด</p>
              <p className="whitespace-pre-line">{p.description || "–"}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">จุดขาย</p>
              <p className="whitespace-pre-line">{p.sellingPoints || "–"}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <UnitsPanel productId={p.id} baseUnit={p.unit} basePrice={p.price} writable={can("products:write")} />

      <KnowledgePanel productId={p.id} writable={can("products:write")} />

      {can("inventory:read") && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>ความเคลื่อนไหวล่าสุด</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="table-cards w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-y border-border text-left text-xs text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium">เวลา</th>
                  <th className="px-5 py-2.5 font-medium">ประเภท</th>
                  <th className="px-5 py-2.5 font-medium">คลัง</th>
                  <th className="px-5 py-2.5 text-right font-medium">จำนวน</th>
                  <th className="px-5 py-2.5 font-medium">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {movements.data?.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                      ยังไม่มีความเคลื่อนไหว
                    </td>
                  </tr>
                )}
                {movements.data?.map((m) => (
                  <tr key={m.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-2.5 text-muted-foreground">{formatDateTime(m.createdAt)}</td>
                    <td data-label="ประเภท" className="px-5 py-2.5">
                      <MovementTypeBadge type={m.type} />
                    </td>
                    <td data-label="คลัง" className="px-5 py-2.5">{m.warehouseName}</td>
                    <td data-label="จำนวน" className={`px-5 py-2.5 text-right font-medium tabular-nums ${m.quantity < 0 ? "text-danger" : "text-success"}`}>
                      {m.quantity > 0 ? "+" : ""}
                      {formatNumber(m.quantity)}
                    </td>
                    <td data-label="หมายเหตุ" className="max-w-64 truncate px-5 py-2.5 text-muted-foreground">{m.note ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Dialog open={editing} onOpenChange={setEditing}>
        {editing && <ProductFormDialog product={p} onSaved={() => setEditing(false)} />}
      </Dialog>
    </>
  );
}

function Stat({ label, value, hint, alert }: { label: string; value: string; hint: string; alert?: boolean }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight ${alert ? "text-danger" : ""}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </Card>
  );
}

function KnowledgePanel({ productId, writable }: { productId: number; writable: boolean }) {
  const qc = useQueryClient();
  const key = ["products", "knowledge", productId];
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const list = useQuery({ queryKey: key, queryFn: () => api.get<KnowledgeEntry[]>(`/products/${productId}/knowledge`) });
  const add = useMutation({
    mutationFn: () => api.post(`/products/${productId}/knowledge`, { kind: "faq", question: question || null, answer }),
    onSuccess: () => {
      setQuestion("");
      setAnswer("");
      void qc.invalidateQueries({ queryKey: key });
      toast.success("เพิ่มคำถาม-คำตอบแล้ว");
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (kid: number) => api.del(`/products/${productId}/knowledge/${kid}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });

  return (
    <Card className="mt-4">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4 text-primary" /> ฐานความรู้ AI (FAQ)
          </CardTitle>
          <CardDescription>คำถามที่ลูกค้าถามบ่อย — AI ตอบแชตจากข้อมูลนี้เท่านั้น จึงไม่แต่งข้อมูลเอง</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {list.data?.length === 0 && <p className="text-sm text-muted-foreground">ยังไม่มีคำถาม-คำตอบ</p>}
        <ul className="space-y-2">
          {list.data?.map((k) => (
            <li key={k.id} className="flex gap-3 rounded-lg border border-border p-3 text-sm">
              <div className="min-w-0 flex-1">
                {k.question && <p className="font-medium">ถาม: {k.question}</p>}
                <p className="text-muted-foreground">ตอบ: {k.answer}</p>
              </div>
              {writable && (
                <button
                  onClick={() => remove.mutate(k.id)}
                  className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-danger-soft hover:text-danger"
                  aria-label="ลบ"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {writable && (
          <form
            className="grid gap-2 rounded-lg bg-muted/50 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (answer.trim()) add.mutate();
            }}
          >
            <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="คำถาม เช่น ใช้กับผิวแพ้ง่ายได้ไหม" />
            <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={2} placeholder="คำตอบ" />
            <Button type="submit" size="sm" className="w-fit" disabled={!answer.trim() || add.isPending}>
              <Plus /> เพิ่ม
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
