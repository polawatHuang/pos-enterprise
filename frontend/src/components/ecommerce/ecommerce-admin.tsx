"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  Clock3,
  ExternalLink,
  ImagePlus,
  Loader2,
  MapPin,
  PackageCheck,
  Search,
  ShieldCheck,
  ShoppingBag,
  Truck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api, apiBlob } from "@/lib/api";
import { formatDateTime, formatMoney } from "@/lib/utils";
import { Badge, Input, NativeSelect } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

type Warehouse = { id: number; name: string; branchId: number | null };
type StoreConfig = {
  slug: string;
  storeName: string;
  enabled: boolean;
  warehouseId: number | null;
  warehouseName: string | null;
  warehouses: Warehouse[];
  paymentReady: boolean;
  paymentIssues: string[];
};
type Order = {
  id: number;
  orderNo: string;
  status: string;
  paymentStatus: string;
  customerName: string;
  phone: string;
  total: number;
  itemCount: number;
  createdAt: string;
  shippedAt: string | null;
};
type OrderDetail = Order & {
  subtotal: number;
  discount: number;
  shippingFee: number;
  address: string;
  postalCode: string;
  email: string | null;
  note: string | null;
  shipmentNote: string | null;
  hasSlip: boolean;
  hasShipmentEvidence: boolean;
  items: { productId: number; name: string; quantity: number; unitPrice: number; total: number }[];
};

const ORDER_STATES = [
  { value: "all", label: "ทั้งหมด" },
  { value: "pending", label: "รอชำระ" },
  { value: "paid", label: "ชำระแล้ว" },
  { value: "packed", label: "กำลังแพ็ก" },
  { value: "shipped", label: "จัดส่งสำเร็จ" },
  { value: "cancelled", label: "หมดอายุ/ยกเลิก" },
] as const;

const statusInfo: Record<string, { label: string; tone: "warning" | "success" | "primary" | "neutral" | "danger" }> = {
  pending: { label: "รอชำระเงิน", tone: "warning" },
  paid: { label: "ชำระแล้ว", tone: "success" },
  packed: { label: "กำลังแพ็ก", tone: "primary" },
  shipped: { label: "จัดส่งสำเร็จ", tone: "success" },
  completed: { label: "สำเร็จ", tone: "success" },
  cancelled: { label: "หมดอายุ/ยกเลิก", tone: "neutral" },
  refunded: { label: "คืนเงิน", tone: "danger" },
};

async function filePayload(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
    reader.onload = () => {
      if (typeof reader.result !== "string") return reject(new Error("ไฟล์ไม่ถูกต้อง"));
      resolve(reader.result.slice(reader.result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function EcommerceAdmin() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<(typeof ORDER_STATES)[number]["value"]>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [storeName, setStoreName] = useState<string | null>(null);
  const [savingStoreName, setSavingStoreName] = useState(false);
  const config = useQuery({ queryKey: ["ecommerce", "store"], queryFn: () => api.get<StoreConfig>("/ecommerce/admin/store") });
  const orders = useQuery({
    queryKey: ["ecommerce", "orders", status, search],
    queryFn: () => api.get<Order[]>("/ecommerce/admin/orders", { status, q: search }),
    refetchInterval: 30_000,
  });
  const detail = useQuery({
    queryKey: ["ecommerce", "order", selected],
    queryFn: () => api.get<OrderDetail>(`/ecommerce/admin/orders/${selected}`),
    enabled: selected !== null,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["ecommerce"] });
  };
  const toggleStore = async () => {
    if (!config.data) return;
    try {
      const next = await api.patch<StoreConfig>("/ecommerce/admin/store", { enabled: !config.data.enabled });
      qc.setQueryData(["ecommerce", "store"], next);
      toast.success(next.enabled ? "เปิดร้านค้าออนไลน์แล้ว" : "ปิดร้านค้าออนไลน์แล้ว");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เปลี่ยนสถานะร้านไม่สำเร็จ");
    }
  };
  const changeWarehouse = async (value: string) => {
    try {
      const next = await api.patch<StoreConfig>("/ecommerce/admin/store", { warehouseId: value ? Number(value) : null });
      qc.setQueryData(["ecommerce", "store"], next);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เปลี่ยนคลังจัดส่งไม่สำเร็จ");
    }
  };
  const saveStoreName = async () => {
    if (!config.data) return;
    const name = (storeName ?? config.data.storeName).trim();
    if (name.length < 2 || name.length > 191) return toast.error("ชื่อร้านต้องมีความยาว 2–191 ตัวอักษร");
    setSavingStoreName(true);
    try {
      const next = await api.patch<StoreConfig>("/ecommerce/admin/store", { storeName: name });
      qc.setQueryData(["ecommerce", "store"], next);
      setStoreName(next.storeName);
      toast.success("บันทึกชื่อร้านแล้ว");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกชื่อร้านไม่สำเร็จ");
    } finally {
      setSavingStoreName(false);
    }
  };
  const showFile = async (kind: "slip" | "shipment") => {
    if (!selected) return;
    try {
      const blob = await apiBlob(`/ecommerce/admin/orders/${selected}/files/${kind}`);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เปิดไฟล์ไม่สำเร็จ");
    }
  };
  const updateStatus = async (nextStatus: "packed" | "shipped", evidence?: File | null, note?: string) => {
    if (!selected) return;
    try {
      const body =
        nextStatus === "shipped" && evidence
          ? { status: nextStatus, mimeType: evidence.type, evidence: await filePayload(evidence), note }
          : { status: nextStatus };
      await api.patch(`/ecommerce/admin/orders/${selected}/status`, body);
      toast.success(nextStatus === "packed" ? "อัปเดตเป็นกำลังแพ็กแล้ว" : "บันทึกการจัดส่งสำเร็จแล้ว");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "อัปเดตสถานะไม่สำเร็จ");
    }
  };

  const storefrontPath = config.data ? `/shop/${config.data.slug}` : "";

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-primary"><ShoppingBag className="size-4" /> ช่องทางขายออนไลน์</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">ร้านค้าออนไลน์</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            สินค้าสถานะ active ที่มีสต๊อกในคลังจัดส่งจะแสดงบนร้านโดยอัตโนมัติ เมื่อเปิดร้านแล้ว
          </p>
        </div>
        <Button variant="outline" onClick={refresh}><Clock3 className="size-4" /> รีเฟรชรายการ</Button>
      </header>

      <section className="grid gap-4 xl:grid-cols-[1.4fr_.9fr]">
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-5">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary"><ShoppingBag className="size-5" /></span>
              <div>
                <h2 className="font-semibold">สถานะหน้าร้าน</h2>
                <p className="text-sm text-muted-foreground">{config.data?.enabled ? "ลูกค้าเข้าชมและสั่งซื้อได้" : "ร้านยังไม่เผยแพร่สู่สาธารณะ"}</p>
              </div>
            </div>
            <Badge tone={config.data?.enabled ? "success" : "neutral"}>{config.data?.enabled ? "เปิดร้าน" : "ยังไม่เปิด"}</Badge>
          </div>
          <div className="grid gap-5 p-5 md:grid-cols-[1fr_auto] md:items-end">
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium" htmlFor="ecommerce-store-name">ชื่อร้านที่ลูกค้าจะเห็น</label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="ecommerce-store-name"
                    value={storeName ?? config.data?.storeName ?? ""}
                    onChange={(event) => setStoreName(event.target.value)}
                    maxLength={191}
                    placeholder="เช่น ร้านดอกไม้บ้านสวน"
                    disabled={config.isPending}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void saveStoreName()}
                    disabled={!config.data || savingStoreName || (storeName ?? config.data.storeName).trim() === config.data.storeName}
                  >
                    {savingStoreName && <Loader2 className="size-4 animate-spin" />}
                    บันทึกชื่อร้าน
                  </Button>
                </div>
              </div>
              <label className="block text-sm font-medium" htmlFor="ecommerce-warehouse">คลังจัดส่ง</label>
              <NativeSelect
                id="ecommerce-warehouse"
                value={config.data?.warehouseId ? String(config.data.warehouseId) : ""}
                onChange={(event) => void changeWarehouse(event.target.value)}
                disabled={config.isPending}
              >
                <option value="">เลือกคลังจัดส่ง</option>
                {config.data?.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
              </NativeSelect>
              <p className="text-xs text-muted-foreground">สต๊อกออนไลน์จะอ้างอิงจากคลังนี้เท่านั้น · ค่าจัดส่งคงที่ ฿60</p>
              {config.data?.paymentIssues.map((issue) => (
                <p key={issue} className="flex items-start gap-2 text-xs text-warning"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" />{issue}</p>
              ))}
            </div>
            <Button onClick={() => void toggleStore()} disabled={!config.data || (!config.data.enabled && !config.data.paymentReady)}>
              {config.data?.enabled ? <><X className="size-4" /> ปิดร้าน</> : <><Check className="size-4" /> เปิดร้าน</>}
            </Button>
          </div>
          {config.data && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-5 py-3 text-sm">
              <span className="min-w-0 truncate text-muted-foreground">ลิงก์ร้าน · {storefrontPath}</span>
              {config.data.enabled && <Link href={storefrontPath} target="_blank" className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><ExternalLink className="size-3.5" /> ดูหน้าร้าน</Link>}
            </div>
          )}
        </div>
        <div className="rounded-2xl bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-violet-500/20 via-primary/5 to-card p-5 ring-1 ring-border">
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">ORDER FLOW</p>
          <h2 className="mt-2 text-lg font-semibold">ตั้งแต่เลือกสินค้าถึงส่งถึงบ้าน</h2>
          <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
            {[
              ["01", "เลือกสินค้า", "ดึงจากคลังจริง"],
              ["02", "ชำระเงิน", "QR PromptPay"],
              ["03", "ตรวจสลิป", "Slip2Go"],
              ["04", "จัดส่ง", "แนบหลักฐาน"],
            ].map(([n, title, caption]) => (
              <div key={n} className="rounded-xl border border-border/70 bg-card/80 p-3">
                <span className="text-[10px] font-bold text-primary">{n}</span>
                <p className="mt-1 font-semibold">{title}</p>
                <p className="mt-0.5 text-muted-foreground">{caption}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <h2 className="text-lg font-semibold">คำสั่งซื้อ</h2>
            <p className="text-sm text-muted-foreground">รายการใหม่จะปรากฏที่นี่และส่งแจ้งเตือนไปยังผู้จัดการ</p>
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 sm:w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาเลขออเดอร์/ลูกค้า" className="pl-9" />
            </div>
            <NativeSelect value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label="กรองสถานะ">
              {ORDER_STATES.map((state) => <option key={state.value} value={state.value}>{state.label}</option>)}
            </NativeSelect>
          </div>
        </div>
        {orders.isPending ? (
          <div className="grid min-h-48 place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div>
        ) : !orders.data?.length ? (
          <div className="grid min-h-56 place-items-center px-4 text-center">
            <div><PackageCheck className="mx-auto size-8 text-muted-foreground/50" /><p className="mt-3 font-medium">ยังไม่มีคำสั่งซื้อ</p><p className="mt-1 text-sm text-muted-foreground">เมื่อลูกค้าสั่งสินค้าจากร้านออนไลน์ ออเดอร์จะแสดงที่นี่</p></div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {orders.data.map((order) => {
              const info = statusInfo[order.status] ?? statusInfo.pending;
              return (
                <button key={order.id} type="button" onClick={() => setSelected(order.id)} className="grid w-full gap-3 px-4 py-4 text-left transition hover:bg-accent/50 sm:grid-cols-[1fr_1fr_auto] sm:items-center sm:px-5">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 font-semibold">{order.orderNo}<Badge tone={info.tone}>{info.label}</Badge></span>
                    <span className="mt-1 block truncate text-sm text-muted-foreground">{order.customerName} · {order.phone}</span>
                  </span>
                  <span className="flex items-center justify-between gap-2 text-sm sm:block">
                    <span className="font-semibold">{formatMoney(order.total)} บาท</span>
                    <span className="text-muted-foreground sm:ml-2">{order.itemCount} รายการ</span>
                  </span>
                  <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground sm:block sm:text-right">
                    {formatDateTime(order.createdAt)} <ArrowUpRight className="inline size-4" />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {selected !== null && (
        <div className="fixed inset-0 z-[100] flex justify-end bg-slate-950/45 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}>
          <section className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-background shadow-2xl animate-in slide-in-from-right duration-300">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-background/95 p-5 backdrop-blur">
              <div>
                <p className="text-xs font-medium text-primary">รายละเอียดคำสั่งซื้อ</p>
                <h2 className="mt-1 text-xl font-semibold">{detail.data?.orderNo ?? "กำลังโหลด…"}</h2>
              </div>
              <Button variant="ghost" size="icon" aria-label="ปิดรายละเอียด" onClick={() => setSelected(null)}><X className="size-5" /></Button>
            </div>
            {detail.isPending || !detail.data ? (
              <div className="grid flex-1 place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div>
            ) : (
              <>
                <div className="flex-1 space-y-5 p-5">
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-primary-soft/60 p-4">
                    <div><p className="text-xs text-muted-foreground">สถานะ</p><p className="mt-1 font-semibold">{statusInfo[detail.data.status]?.label ?? detail.data.status}</p></div>
                    <Badge tone={detail.data.paymentStatus === "paid" ? "success" : "warning"}>{detail.data.paymentStatus === "paid" ? "ชำระแล้ว" : detail.data.paymentStatus === "expired" ? "หมดอายุ" : "รอชำระ"}</Badge>
                  </div>
                  <div className="rounded-xl border border-border p-4">
                    <div className="flex items-center gap-2 font-semibold"><MapPin className="size-4 text-primary" /> ข้อมูลจัดส่ง</div>
                    <p className="mt-3 font-medium">{detail.data.customerName}</p>
                    <p className="text-sm text-muted-foreground">{detail.data.phone}{detail.data.email ? ` · ${detail.data.email}` : ""}</p>
                    <p className="mt-2 whitespace-pre-line text-sm leading-6">{detail.data.address} {detail.data.postalCode}</p>
                    {detail.data.note && <p className="mt-2 text-sm text-muted-foreground">หมายเหตุ: {detail.data.note}</p>}
                  </div>
                  <div className="rounded-xl border border-border p-4">
                    <p className="font-semibold">รายการสินค้า</p>
                    <div className="mt-3 divide-y divide-border">
                      {detail.data.items.map((item) => <div key={item.productId} className="flex justify-between gap-3 py-2 text-sm"><span>{item.name} × {item.quantity}</span><span className="shrink-0">{formatMoney(item.total)} ฿</span></div>)}
                    </div>
                    <div className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">ค่าจัดส่ง</span><span>{formatMoney(detail.data.shippingFee)} ฿</span></div>
                      {detail.data.discount > 0 && <div className="flex justify-between text-success"><span>ส่วนลด</span><span>-{formatMoney(detail.data.discount)} ฿</span></div>}
                      <div className="flex justify-between pt-1 font-semibold"><span>รวม</span><span>{formatMoney(detail.data.total)} ฿</span></div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {detail.data.hasSlip && <Button variant="outline" size="sm" onClick={() => void showFile("slip")}><ImagePlus className="size-4" /> ดูสลิป</Button>}
                    {detail.data.hasShipmentEvidence && <Button variant="outline" size="sm" onClick={() => void showFile("shipment")}><Truck className="size-4" /> ดูหลักฐานจัดส่ง</Button>}
                  </div>
                </div>
                {detail.data.paymentStatus === "paid" && detail.data.status !== "shipped" && detail.data.status !== "completed" && (
                  <OrderActions order={detail.data} onPack={() => updateStatus("packed")} onShip={(file, note) => updateStatus("shipped", file, note)} />
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function OrderActions({ order, onPack, onShip }: { order: OrderDetail; onPack: () => Promise<void>; onShip: (file: File, note: string) => Promise<void> }) {
  const [evidence, setEvidence] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const submitPack = async () => {
    setBusy(true);
    try { await onPack(); } finally { setBusy(false); }
  };
  const submitShip = async () => {
    if (!evidence) return toast.error("กรุณาแนบรูปหลักฐานการจัดส่ง");
    if (!["image/jpeg", "image/png", "image/webp"].includes(evidence.type) || evidence.size > 5 * 1024 * 1024) {
      return toast.error("ใช้ไฟล์ JPEG, PNG หรือ WebP ขนาดไม่เกิน 5 MB");
    }
    setBusy(true);
    try { await onShip(evidence, note); } finally { setBusy(false); }
  };
  return (
    <div className="sticky bottom-0 space-y-3 border-t border-border bg-background/95 p-5 backdrop-blur">
      {order.status === "paid" && <Button variant="outline" className="w-full" onClick={() => void submitPack()} disabled={busy}><PackageCheck className="size-4" /> เริ่มแพ็กสินค้า</Button>}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Input aria-label="หมายเหตุการจัดส่ง" value={note} onChange={(event) => setNote(event.target.value)} placeholder="เลขพัสดุ/หมายเหตุ (ถ้ามี)" />
        <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm hover:bg-accent">
          <ImagePlus className="size-4" /> {evidence ? "เปลี่ยนรูป" : "แนบหลักฐาน"}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => setEvidence(event.target.files?.[0] ?? null)} />
        </label>
      </div>
      {evidence && <p className="truncate text-xs text-muted-foreground">แนบแล้ว: {evidence.name}</p>}
      <Button className="w-full" onClick={() => void submitShip()} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />} จัดส่งสำเร็จ</Button>
    </div>
  );
}
