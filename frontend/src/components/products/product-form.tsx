"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { withOfflineCopy } from "@/lib/offline-cache";
import type { Category, Product, ProductDetail, Supplier, Warehouse } from "@/lib/types";
import { lineVatRate, netOfInclusive, useTaxSettings, vatTypeLabel } from "@/lib/tax";
import { useAuth } from "@/components/auth/auth-provider";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, NativeSelect, Textarea } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";
import { ScanButton } from "@/components/ui/barcode-scanner";

const num = (msg: string) =>
  z
    .string()
    .trim()
    .min(1, msg)
    .refine((v) => !Number.isNaN(Number(v)) && Number(v) >= 0, "ต้องเป็นตัวเลขไม่ติดลบ");

const schema = z.object({
  // empty on a new product = the server makes one up
  sku: z.string().trim().max(64),
  barcode: z.string().trim().max(64),
  name: z.string().trim().min(1, "กรุณากรอกชื่อสินค้า").max(255),
  categoryId: z.string(),
  unit: z.string().trim().min(1, "กรุณากรอกหน่วย").max(30),
  price: num("กรุณากรอกราคาขาย"),
  cost: z
    .string()
    .trim()
    .refine((v) => v === "" || (!Number.isNaN(Number(v)) && Number(v) >= 0), "ต้องเป็นตัวเลขไม่ติดลบ"),
  vatType: z.enum(["vat7", "exempt", "zero"]),
  reorderPoint: num("กรุณากรอกจุดสั่งซื้อ"),
  supplierId: z.string(),
  packSize: z
    .string()
    .trim()
    .refine((v) => v === "" || Number(v) > 0, "ต้องมากกว่า 0"),
  trackExpiry: z.boolean(),
  openPrice: z.boolean(),
  shelfLifeDays: z
    .string()
    .trim()
    .refine((v) => v === "" || (Number.isInteger(Number(v)) && Number(v) >= 0), "ต้องเป็นจำนวนวัน"),
  status: z.enum(["active", "draft", "archived"]),
  description: z.string().max(5000),
  sellingPoints: z.string().max(5000),
});
type Values = z.infer<typeof schema>;

export const CATEGORIES_KEY = ["products", "categories"] as const;
export const useCategories = () =>
  useQuery({
    queryKey: CATEGORIES_KEY,
    queryFn: () => withOfflineCopy("categories", () => api.get<Category[]>("/products/categories")),
    staleTime: 5 * 60_000,
  });

/** Create/edit dialog body. Render inside a <Dialog>. */
export const SUPPLIERS_KEY = ["purchasing", "suppliers"] as const;

export function ProductFormDialog({ product, onSaved }: { product?: Product | null; onSaved: (p: Product) => void }) {
  const qc = useQueryClient();
  const { user, can } = useAuth();
  const { tax } = useTaxSettings();
  const categories = useCategories();
  const suppliers = useQuery({
    queryKey: SUPPLIERS_KEY,
    queryFn: () => api.get<Supplier[]>("/purchasing/suppliers"),
    staleTime: 5 * 60_000,
  });
  const isNew = !product;
  const canStock = can("inventory:write");
  const warehouses = useQuery({
    queryKey: ["inventory", "warehouses"],
    queryFn: () => api.get<Warehouse[]>("/inventory/warehouses"),
    enabled: can("inventory:read"),
    staleTime: 5 * 60_000,
  });
  // Current stock per warehouse when editing (same query as the product page)
  const detail = useQuery({
    queryKey: ["products", "detail", product?.id],
    queryFn: () => api.get<ProductDetail>(`/products/${product!.id}`),
    enabled: !isNew,
  });
  const [openingQty, setOpeningQty] = useState("");
  const [openingWh, setOpeningWh] = useState("");
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [reason, setReason] = useState("แก้ไขจำนวนจากหน้าสินค้า");
  const defaultWh = String(warehouses.data?.find((w) => w.branchId === user?.branchId)?.id ?? warehouses.data?.[0]?.id ?? "");
  const changedCounts = (detail.data?.stock ?? []).filter(
    (s) => counts[s.warehouseId] !== undefined && counts[s.warehouseId] !== "" && Number(counts[s.warehouseId]) !== s.quantity,
  );
  const {
    register,
    handleSubmit,
    control,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      sku: product?.sku ?? "",
      barcode: product?.barcode ?? "",
      name: product?.name ?? "",
      categoryId: product?.categoryId ? String(product.categoryId) : "",
      unit: product?.unit ?? "ชิ้น",
      price: product ? String(product.price) : "",
      cost: product ? String(product.cost) : "0",
      vatType: product?.vatType ?? tax.defaultVatType,
      reorderPoint: product ? String(product.reorderPoint) : "5",
      supplierId: product?.supplierId ? String(product.supplierId) : "",
      packSize: product ? String(product.packSize ?? 1) : "1",
      trackExpiry: product?.trackExpiry ?? false,
      openPrice: product?.openPrice ?? false,
      shelfLifeDays: product?.shelfLifeDays != null ? String(product.shelfLifeDays) : "",
      status: product?.status ?? "active",
      description: product?.description ?? "",
      sellingPoints: product?.sellingPoints ?? "",
    },
  });

  const [priceStr, costStr, vatType, openPrice] = useWatch({
    control,
    name: ["price", "cost", "vatType", "openPrice"],
  });
  const price = Number(priceStr) || 0;
  const cost = Number(costStr) || 0;
  const net = netOfInclusive(price, lineVatRate(tax, vatType));
  const margin = net > 0 ? ((net - cost) / net) * 100 : 0;

  const onSubmit = async (v: Values) => {
    const qty = Number(openingQty);
    if (isNew && openingQty.trim() && (!(qty > 0) || !(openingWh || defaultWh))) {
      toast.error("จำนวนเริ่มต้นต้องมากกว่า 0 และต้องเลือกคลัง");
      return;
    }
    if (changedCounts.some((s) => !(Number(counts[s.warehouseId]) >= 0))) {
      toast.error("จำนวนคงเหลือต้องเป็นตัวเลขไม่ติดลบ");
      return;
    }
    if (!isNew && !v.sku) {
      setError("sku", { message: "กรุณากรอกรหัสสินค้า" });
      return;
    }
    const body = {
      ...(v.sku ? { sku: v.sku } : {}),
      barcode: v.barcode || null,
      name: v.name,
      categoryId: v.categoryId ? Number(v.categoryId) : null,
      unit: v.unit,
      price: Number(v.price),
      cost: Number(v.cost) || 0,
      vatType: v.vatType,
      reorderPoint: Number(v.reorderPoint),
      supplierId: v.supplierId ? Number(v.supplierId) : null,
      packSize: Number(v.packSize) || 1,
      trackExpiry: v.trackExpiry,
      openPrice: v.openPrice,
      shelfLifeDays: v.shelfLifeDays === "" ? null : Number(v.shelfLifeDays),
      status: v.status,
      description: v.description || null,
      sellingPoints: v.sellingPoints || null,
      ...(isNew && qty > 0 && !v.openPrice
        ? {
            openingStock: {
              warehouseId: Number(openingWh || defaultWh),
              quantity: qty,
            },
          }
        : {}),
    };
    try {
      const saved = isNew ? await api.post<Product>("/products", body) : await api.patch<Product>(`/products/${product.id}`, body);
      // Stock changes are recorded as adjustments (movement history + audit), one per warehouse
      for (const s of changedCounts) {
        await api.post("/inventory/adjust", {
          warehouseId: s.warehouseId,
          productId: saved.id,
          countedQuantity: Number(counts[s.warehouseId]),
          reason: reason.trim() || "แก้ไขจำนวนจากหน้าสินค้า",
        });
      }
      toast.success(isNew ? "เพิ่มสินค้าแล้ว" : "บันทึกแล้ว");
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(err.message.includes("บาร์โค้ด") ? "barcode" : "sku", {
          message: err.message,
        });
      } else toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    }
  };

  return (
    <DialogContent title={isNew ? "เพิ่มสินค้า" : `แก้ไข ${product.name}`} className="max-w-2xl">
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="บาร์โค้ด" error={errors.barcode?.message}>
            <div className="flex gap-2">
              <Input inputMode="numeric" className="h-11" aria-invalid={!!errors.barcode} {...register("barcode")} />
              <ScanButton
                onDetected={(code) =>
                  setValue("barcode", code, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              />
            </div>
          </Field>
          <Field label="ชื่อสินค้า" error={errors.name?.message} className="sm:col-span-2">
            <Input aria-invalid={!!errors.name} {...register("name")} />
          </Field>
          <Field label="ราคาขาย (รวม VAT)" error={errors.price?.message}>
            <Input inputMode="decimal" aria-invalid={!!errors.price} {...register("price")} />
          </Field>
          <Field label="ต้นทุนต่อหน่วย (ก่อน VAT, ไม่บังคับ)" error={errors.cost?.message}>
            <Input inputMode="decimal" aria-invalid={!!errors.cost} {...register("cost")} />
          </Field>
          <div className="flex items-end">
            <p className="w-full rounded-lg bg-muted px-3 py-2.5 text-sm">
              ราคาก่อน VAT <b>{formatMoney(net)}</b> · มาร์จิ้น <b className={margin < 0 ? "text-danger" : "text-success"}>{margin.toFixed(1)}%</b>
            </p>
          </div>
          {isNew && canStock && !openPrice && (
            <div className="grid gap-3 rounded-lg border border-border p-3 sm:col-span-2 sm:grid-cols-2">
              <Field label="จำนวนเริ่มต้น (ไม่บังคับ)">
                <Input inputMode="decimal" placeholder="เช่น 24" value={openingQty} onChange={(e) => setOpeningQty(e.target.value)} />
              </Field>
              <Field label="เข้าคลัง">
                <NativeSelect className="h-10 w-full" value={openingWh || defaultWh} onChange={(e) => setOpeningWh(e.target.value)}>
                  {warehouses.data?.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                      {w.branchName ? ` · ${w.branchName}` : ""}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          )}
          {!isNew && detail.data && detail.data.stock.length > 0 && (
            <div className="space-y-3 rounded-lg border border-border p-3 sm:col-span-2">
              <p className="text-sm font-medium">จำนวนคงเหลือ ({product.unit})</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {detail.data.stock.map((s) => (
                  <div key={s.warehouseId} className="space-y-1.5">
                    <Label htmlFor={`stock-${s.warehouseId}`} className="text-xs text-muted-foreground">
                      {s.name}
                    </Label>
                    <Input
                      id={`stock-${s.warehouseId}`}
                      inputMode="decimal"
                      disabled={!canStock}
                      value={counts[s.warehouseId] ?? String(s.quantity)}
                      onChange={(e) =>
                        setCounts((c) => ({
                          ...c,
                          [s.warehouseId]: e.target.value,
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
              {changedCounts.length > 0 && (
                <Field label="เหตุผลที่แก้จำนวน (บันทึกในประวัติสต๊อก)">
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} />
                </Field>
              )}
              {!canStock && <p className="text-xs text-muted-foreground">ต้องมีสิทธิ์จัดการสต๊อกจึงจะแก้จำนวนได้</p>}
            </div>
          )}
          <details open={!isNew} className="rounded-lg border border-border sm:col-span-2">
            <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium">
              ตั้งค่าเพิ่มเติม (รหัสสินค้า หมวด หน่วย ภาษี วันหมดอายุ ฯลฯ)
            </summary>
            <div className="grid gap-4 border-t border-border p-3 sm:grid-cols-2">
              <Field label={isNew ? "รหัสสินค้า (เว้นว่าง = ระบบตั้งให้)" : "รหัสสินค้า"} error={errors.sku?.message}>
                <Input aria-invalid={!!errors.sku} {...register("sku")} />
              </Field>
              <label className="flex items-start gap-2 rounded-lg border border-border px-3 py-2.5 text-sm sm:col-span-2">
                <input type="checkbox" className="mt-0.5" {...register("openPrice")} />
                <span>
                  ระบุราคาตอนขาย ไม่นับสต๊อก
                  <span className="block text-xs text-muted-foreground">
                    สำหรับค่าบริการหรือของไม่มีบาร์โค้ด เช่น ถ่ายเอกสาร — แคชเชียร์กรอกราคาเองที่ปุ่ม ระบุราคา
                  </span>
                </span>
              </label>
              <Field label="หมวดหมู่">
                <div className="relative flex gap-2">
                  <NativeSelect className="h-10 w-full" {...register("categoryId")}>
                    <option value="">ไม่ระบุ</option>
                    {categories.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <QuickAdd
                    label="เพิ่มหมวดหมู่"
                    placeholder="ชื่อหมวด เช่น เครื่องดื่ม"
                    onAdd={async (name) => {
                      const c = await api.post<{ id: number }>("/products/categories", { name });
                      await qc.invalidateQueries({ queryKey: CATEGORIES_KEY });
                      await afterRender(); // a <select> ignores a value until its <option> is rendered
                      setValue("categoryId", String(c.id), {
                        shouldDirty: true,
                      });
                    }}
                  />
                </div>
              </Field>
              <Field label="หน่วย" error={errors.unit?.message}>
                <Input {...register("unit")} />
              </Field>
              <Field label="ภาษีมูลค่าเพิ่ม">
                <NativeSelect className="h-10 w-full" {...register("vatType")}>
                  <option value="vat7">{vatTypeLabel(tax, "vat7")} (รวมในราคา)</option>
                  <option value="exempt">{vatTypeLabel(tax, "exempt")}</option>
                  <option value="zero">{vatTypeLabel(tax, "zero")}</option>
                </NativeSelect>
                {!tax.vatRegistered && (
                  <p className="text-xs text-muted-foreground">ร้านยังไม่ได้จด VAT — ขายโดยไม่คิดภาษี (ตั้งค่าได้ที่ ตั้งค่า → ภาษีมูลค่าเพิ่ม)</p>
                )}
              </Field>
              <Field label="จุดสั่งซื้อ (แจ้งเตือนเมื่อเหลือ ≤)" error={errors.reorderPoint?.message}>
                <Input inputMode="numeric" {...register("reorderPoint")} />
              </Field>
              <Field label="ผู้ขายหลัก (ใช้จัดใบสั่งซื้อ)">
                <div className="relative flex gap-2">
                  <NativeSelect className="h-10 w-full" {...register("supplierId")}>
                    <option value="">ไม่ระบุ</option>
                    {suppliers.data?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </NativeSelect>
                  {can("purchasing:write") && (
                    <QuickAdd
                      label="เพิ่มผู้ขาย"
                      placeholder="ชื่อผู้ขาย / บริษัท"
                      onAdd={async (name) => {
                        const sup = await api.post<{ id: number }>("/purchasing/suppliers", { name });
                        await qc.invalidateQueries({ queryKey: SUPPLIERS_KEY });
                        await afterRender();
                        setValue("supplierId", String(sup.id), {
                          shouldDirty: true,
                        });
                      }}
                    />
                  )}
                </div>
              </Field>
              <Field label="สั่งทีละ (จำนวนต่อแพ็กที่ผู้ขายส่ง)" error={errors.packSize?.message}>
                <Input inputMode="decimal" {...register("packSize")} />
              </Field>
              <Field label="อายุสินค้า (วัน) — ใช้เติมวันหมดอายุตอนรับของ" error={errors.shelfLifeDays?.message}>
                <Input inputMode="numeric" placeholder="เช่น 7" {...register("shelfLifeDays")} />
              </Field>
              <label className="flex items-center gap-2 self-end rounded-lg border border-border px-3 py-2.5 text-sm">
                <input type="checkbox" {...register("trackExpiry")} /> ติดตามวันหมดอายุ (ขายล็อตที่หมดก่อนออกก่อน)
              </label>
              <Field label="สถานะ">
                <NativeSelect className="h-10 w-full" {...register("status")}>
                  <option value="active">พร้อมขาย</option>
                  <option value="draft">ฉบับร่าง</option>
                  <option value="archived">เลิกขาย</option>
                </NativeSelect>
              </Field>
              <Field label="รายละเอียดสินค้า" className="sm:col-span-2">
                <Textarea rows={3} {...register("description")} />
              </Field>
              <Field label="จุดขาย (AI ใช้ตอบแชตและเขียนสคริปต์วิดีโอ)" className="sm:col-span-2">
                <Textarea rows={3} placeholder="เช่น กันน้ำ IPX5, แบตอึด 30 ชม., รับประกัน 1 ปี" {...register("sellingPoints")} />
              </Field>
            </div>
          </details>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" />}
            {isNew ? "เพิ่มสินค้า" : "บันทึก"}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

function Field({ label, error, className, children }: { label: string; error?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
      <FieldError message={error} />
    </div>
  );
}

const afterRender = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/** "+" next to a select: type a name, create it, and select it. */
function QuickAdd({ label, placeholder, onAdd }: { label: string; placeholder: string; onAdd: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onAdd(name.trim());
      toast.success(`${label}แล้ว`);
      setName("");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${label}ไม่สำเร็จ`);
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return (
      <Button type="button" variant="outline" size="icon" className="size-10 shrink-0" onClick={() => setOpen(true)} aria-label={label} title={label}>
        <Plus className="size-4" />
      </Button>
    );
  }
  return (
    <div className="absolute right-0 top-11 z-20 flex w-72 gap-2 rounded-lg border border-border bg-card p-2 shadow-lg">
      <Input
        autoFocus
        value={name}
        placeholder={placeholder}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void add();
          }
          if (e.key === "Escape") setOpen(false);
        }}
        className="h-9"
      />
      <Button type="button" size="sm" className="h-9" onClick={add} disabled={busy || !name.trim()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : "เพิ่ม"}
      </Button>
    </div>
  );
}
