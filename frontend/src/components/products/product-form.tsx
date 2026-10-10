"use client";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { Category, Product } from "@/lib/types";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, NativeSelect, Textarea } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";

const num = (msg: string) => z.string().trim().min(1, msg).refine((v) => !Number.isNaN(Number(v)) && Number(v) >= 0, "ต้องเป็นตัวเลขไม่ติดลบ");

const schema = z.object({
  sku: z.string().trim().min(1, "กรุณากรอก SKU").max(64),
  barcode: z.string().trim().max(64),
  name: z.string().trim().min(1, "กรุณากรอกชื่อสินค้า").max(255),
  categoryId: z.string(),
  unit: z.string().trim().min(1, "กรุณากรอกหน่วย").max(30),
  price: num("กรุณากรอกราคาขาย"),
  cost: num("กรุณากรอกต้นทุน"),
  vatType: z.enum(["vat7", "exempt", "zero"]),
  reorderPoint: num("กรุณากรอกจุดสั่งซื้อ"),
  status: z.enum(["active", "draft", "archived"]),
  description: z.string().max(5000),
  sellingPoints: z.string().max(5000),
});
type Values = z.infer<typeof schema>;

export const CATEGORIES_KEY = ["products", "categories"] as const;
export const useCategories = () =>
  useQuery({ queryKey: CATEGORIES_KEY, queryFn: () => api.get<Category[]>("/products/categories"), staleTime: 5 * 60_000 });

/** Create/edit dialog body. Render inside a <Dialog>. */
export function ProductFormDialog({ product, onSaved }: { product?: Product | null; onSaved: (p: Product) => void }) {
  const qc = useQueryClient();
  const categories = useCategories();
  const isNew = !product;
  const {
    register,
    handleSubmit,
    control,
    setError,
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
      vatType: product?.vatType ?? "vat7",
      reorderPoint: product ? String(product.reorderPoint) : "5",
      status: product?.status ?? "active",
      description: product?.description ?? "",
      sellingPoints: product?.sellingPoints ?? "",
    },
  });

  const [priceStr, costStr, vatType] = useWatch({ control, name: ["price", "cost", "vatType"] });
  const price = Number(priceStr) || 0;
  const cost = Number(costStr) || 0;
  const net = vatType === "vat7" ? price / 1.07 : price;
  const margin = net > 0 ? ((net - cost) / net) * 100 : 0;

  const onSubmit = async (v: Values) => {
    const body = {
      sku: v.sku,
      barcode: v.barcode || null,
      name: v.name,
      categoryId: v.categoryId ? Number(v.categoryId) : null,
      unit: v.unit,
      price: Number(v.price),
      cost: Number(v.cost),
      vatType: v.vatType,
      reorderPoint: Number(v.reorderPoint),
      status: v.status,
      description: v.description || null,
      sellingPoints: v.sellingPoints || null,
    };
    try {
      const saved = isNew ? await api.post<Product>("/products", body) : await api.patch<Product>(`/products/${product.id}`, body);
      toast.success(isNew ? "เพิ่มสินค้าแล้ว" : "บันทึกแล้ว");
      void qc.invalidateQueries({ queryKey: ["products"] });
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(err.message.includes("บาร์โค้ด") ? "barcode" : "sku", { message: err.message });
      } else toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    }
  };

  return (
    <DialogContent title={isNew ? "เพิ่มสินค้า" : `แก้ไข ${product.name}`} className="max-w-2xl">
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ชื่อสินค้า" error={errors.name?.message} className="sm:col-span-2">
            <Input aria-invalid={!!errors.name} {...register("name")} />
          </Field>
          <Field label="SKU" error={errors.sku?.message}>
            <Input aria-invalid={!!errors.sku} {...register("sku")} />
          </Field>
          <Field label="บาร์โค้ด" error={errors.barcode?.message}>
            <Input inputMode="numeric" aria-invalid={!!errors.barcode} {...register("barcode")} />
          </Field>
          <Field label="หมวดหมู่">
            <NativeSelect className="h-10 w-full" {...register("categoryId")}>
              <option value="">ไม่ระบุ</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="หน่วย" error={errors.unit?.message}>
            <Input {...register("unit")} />
          </Field>
          <Field label="ราคาขาย (รวม VAT)" error={errors.price?.message}>
            <Input inputMode="decimal" aria-invalid={!!errors.price} {...register("price")} />
          </Field>
          <Field label="ต้นทุนต่อหน่วย (ก่อน VAT)" error={errors.cost?.message}>
            <Input inputMode="decimal" aria-invalid={!!errors.cost} {...register("cost")} />
          </Field>
          <Field label="ภาษีมูลค่าเพิ่ม">
            <NativeSelect className="h-10 w-full" {...register("vatType")}>
              <option value="vat7">VAT 7% (รวมในราคา)</option>
              <option value="exempt">ยกเว้น VAT</option>
              <option value="zero">VAT 0%</option>
            </NativeSelect>
          </Field>
          <Field label="จุดสั่งซื้อ (แจ้งเตือนเมื่อเหลือ ≤)" error={errors.reorderPoint?.message}>
            <Input inputMode="numeric" {...register("reorderPoint")} />
          </Field>
          <Field label="สถานะ">
            <NativeSelect className="h-10 w-full" {...register("status")}>
              <option value="active">พร้อมขาย</option>
              <option value="draft">ฉบับร่าง</option>
              <option value="archived">เลิกขาย</option>
            </NativeSelect>
          </Field>
          <div className="flex items-end">
            <p className="w-full rounded-lg bg-muted px-3 py-2.5 text-sm">
              ราคาก่อน VAT <b>{formatMoney(net)}</b> · มาร์จิ้น{" "}
              <b className={margin < 0 ? "text-danger" : "text-success"}>{margin.toFixed(1)}%</b>
            </p>
          </div>
          <Field label="รายละเอียดสินค้า" className="sm:col-span-2">
            <Textarea rows={3} {...register("description")} />
          </Field>
          <Field label="จุดขาย (AI ใช้ตอบแชตและเขียนสคริปต์วิดีโอ)" className="sm:col-span-2">
            <Textarea rows={3} placeholder="เช่น กันน้ำ IPX5, แบตอึด 30 ชม., รับประกัน 1 ปี" {...register("sellingPoints")} />
          </Field>
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
