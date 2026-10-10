"use client";

import { useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Minus, Plus, Printer, ReceiptText, ScanBarcode, Settings2, ShoppingCart, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { CatalogItem, PosOrder, PosSettings, Shift } from "@/lib/types";
import { cn, formatDateTime, formatMoney, formatNumber } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, Input, Skeleton } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { useCategories } from "@/components/products/product-form";
import { BillsDialog } from "./bills-dialog";
import { PaymentDialog, type PaymentInput } from "./payment-dialog";
import { Receipt } from "./receipt";
import { POS_SETTINGS_KEY, PosSettingsDialog } from "./settings-dialog";
import { CloseShiftDialog, OpenShiftCard, SHIFT_KEY } from "./shift";

interface CartLine {
  item: CatalogItem;
  quantity: number;
}

type Modal = "pay" | "bills" | "close" | "settings" | "receipt" | null;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Mirrors the server's calculation so the cashier sees the same numbers before paying. */
function totalsOf(lines: CartLine[], discount: number) {
  const subtotal = r2(lines.reduce((s, l) => s + l.item.price * l.quantity, 0));
  const total = r2(Math.max(subtotal - discount, 0));
  const ratio = subtotal ? total / subtotal : 0;
  const vatable = lines.filter((l) => l.item.vatType === "vat7").reduce((s, l) => s + l.item.price * l.quantity, 0);
  return { subtotal, total, vat: r2((vatable * ratio * 7) / 107), units: lines.reduce((s, l) => s + l.quantity, 0) };
}

export function PosView() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const shift = useQuery({ queryKey: SHIFT_KEY, queryFn: () => api.get<Shift | null>("/pos/shift") });
  const settings = useQuery({ queryKey: POS_SETTINGS_KEY, queryFn: () => api.get<PosSettings>("/pos/settings"), staleTime: 5 * 60_000 });
  const categories = useCategories();

  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [receipt, setReceipt] = useState<PosOrder | null>(null);
  const [paying, setPaying] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const cartRef = useRef<HTMLDivElement>(null);

  const catalog = useQuery({
    queryKey: ["pos", "catalog", search, categoryId],
    queryFn: () => api.get<CatalogItem[]>("/pos/catalog", { q: search, categoryId: categoryId ?? undefined, limit: 60 }),
    enabled: !!shift.data,
    placeholderData: keepPreviousData,
  });

  const discountNum = Math.max(Number(discount) || 0, 0);
  const totals = useMemo(() => totalsOf(cart, discountNum), [cart, discountNum]);

  const add = (item: CatalogItem) => {
    setCart((c) => {
      const existing = c.find((l) => l.item.id === item.id);
      const nextQty = (existing?.quantity ?? 0) + 1;
      if (nextQty > item.stock) {
        toast.warning(`${item.name} คงเหลือ ${formatNumber(item.stock)} ${item.unit}`);
        if (item.stock <= 0) return c;
      }
      return existing ? c.map((l) => (l.item.id === item.id ? { ...l, quantity: nextQty } : l)) : [...c, { item, quantity: 1 }];
    });
  };
  const setQty = (id: number, q: number) =>
    setCart((c) => (q <= 0 ? c.filter((l) => l.item.id !== id) : c.map((l) => (l.item.id === id ? { ...l, quantity: q } : l))));

  /** Barcode scanners type the code then Enter: try an exact lookup first, fall back to search. */
  const onSearchEnter = async () => {
    const code = search.trim();
    if (!code) return;
    try {
      add(await api.get<CatalogItem>("/pos/lookup", { code }));
      setSearch("");
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) toast.error(err instanceof Error ? err.message : "ค้นหาไม่สำเร็จ");
      else if (catalog.data?.length === 1) {
        add(catalog.data[0]);
        setSearch("");
      }
    }
  };

  const pay = async (p: PaymentInput) => {
    setPaying(true);
    try {
      const order = await api.post<PosOrder>("/pos/checkout", {
        items: cart.map((l) => ({ productId: l.item.id, quantity: l.quantity })),
        discount: discountNum || undefined,
        payment: p,
      });
      setCart([]);
      setDiscount("");
      setReceipt(order);
      setModal("receipt");
      void qc.invalidateQueries({ queryKey: ["pos"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ชำระเงินไม่สำเร็จ");
    } finally {
      setPaying(false);
    }
  };

  const closeModal = () => {
    setModal(null);
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  if (shift.isPending) return <Skeleton className="h-[70vh] w-full rounded-xl" />;
  if (!shift.data) return <OpenShiftCard />;
  const s = shift.data;

  return (
    <div className="pb-24 lg:pb-0">
      {/* Shift bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold tracking-tight">ขายหน้าร้าน</h1>
          <p className="text-xs text-muted-foreground">
            {s.branchName} · เปิดกะ {formatDateTime(s.openedAt)} · {formatNumber(s.stats.orders)} บิล · {formatMoney(s.stats.sales)}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setModal("bills")}>
          <ReceiptText /> บิลในกะ
        </Button>
        {can("pos:manage") && settings.data && (
          <Button variant="outline" size="sm" onClick={() => setModal("settings")}>
            <Settings2 /> ตั้งค่า POS
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={() => setModal("close")}>
          ปิดกะ
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Catalog */}
        <section aria-label="สินค้า" className="min-w-0">
          <div className="relative">
            <ScanBarcode className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void onSearchEnter();
                }
              }}
              placeholder="สแกนบาร์โค้ด หรือพิมพ์ชื่อ/SKU แล้วกด Enter"
              className="h-12 pl-11 text-base"
              aria-label="สแกนหรือค้นหาสินค้า"
              autoFocus
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-label="ล้าง">
                <X className="size-4" />
              </button>
            )}
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            <Chip active={categoryId === null} onClick={() => setCategoryId(null)}>
              ทั้งหมด
            </Chip>
            {categories.data?.map((c) => (
              <Chip key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(c.id)}>
                {c.name}
              </Chip>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {catalog.isPending &&
              Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
            {catalog.data?.map((item) => {
              const inCart = cart.find((l) => l.item.id === item.id)?.quantity ?? 0;
              const out = item.stock <= 0;
              return (
                <button
                  key={item.id}
                  onClick={() => add(item)}
                  disabled={out}
                  className={cn(
                    "relative flex min-h-28 flex-col rounded-xl border bg-card p-3 text-left transition-all active:scale-[0.98]",
                    out ? "cursor-not-allowed opacity-50" : "hover:border-primary/50 hover:shadow-sm",
                    inCart > 0 ? "border-primary ring-2 ring-primary/15" : "border-border",
                  )}
                >
                  {inCart > 0 && (
                    <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                      {inCart}
                    </span>
                  )}
                  <span className="line-clamp-2 pr-6 text-sm font-medium leading-snug">{item.name}</span>
                  <span className="mt-auto pt-2 text-base font-semibold text-primary">{formatMoney(item.price)}</span>
                  <span className={cn("text-[11px]", item.stock <= 5 ? "text-danger" : "text-muted-foreground")}>
                    {out ? "หมด" : `เหลือ ${formatNumber(item.stock)} ${item.unit}`}
                  </span>
                </button>
              );
            })}
          </div>
          {catalog.data?.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">ไม่พบสินค้า</p>}
        </section>

        {/* Cart */}
        <div ref={cartRef} className="lg:sticky lg:top-20 lg:self-start">
          <Card className="flex flex-col lg:max-h-[calc(100dvh-7rem)]">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="flex items-center gap-2 font-semibold">
                <ShoppingCart className="size-4" /> ตะกร้า
                <span className="text-sm font-normal text-muted-foreground">({formatNumber(totals.units)} ชิ้น)</span>
              </h2>
              {cart.length > 0 && (
                <button onClick={() => setCart([])} className="text-xs text-danger hover:underline">
                  ล้างตะกร้า
                </button>
              )}
            </div>
            <ul className="min-h-24 flex-1 divide-y divide-border overflow-y-auto">
              {cart.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted-foreground">สแกนหรือแตะสินค้าเพื่อเพิ่มลงตะกร้า</li>}
              {cart.map((l) => (
                <li key={l.item.id} className="flex items-center gap-2 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{l.item.name}</p>
                    <p className="text-xs text-muted-foreground">{formatMoney(l.item.price)}</p>
                  </div>
                  <div className="flex items-center rounded-lg border border-border">
                    <button className="grid size-8 place-items-center" onClick={() => setQty(l.item.id, l.quantity - 1)} aria-label="ลด">
                      {l.quantity === 1 ? <Trash2 className="size-3.5 text-danger" /> : <Minus className="size-3.5" />}
                    </button>
                    <span className="w-8 text-center text-sm font-medium tabular-nums">{l.quantity}</span>
                    <button className="grid size-8 place-items-center" onClick={() => add(l.item)} aria-label="เพิ่ม">
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                  <span className="w-20 text-right text-sm font-semibold tabular-nums">{formatMoney(l.item.price * l.quantity)}</span>
                </li>
              ))}
            </ul>
            <div className="space-y-2 border-t border-border p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">รวม</span>
                <span className="tabular-nums">{formatMoney(totals.subtotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="discount" className="text-muted-foreground">
                  ส่วนลดท้ายบิล
                </label>
                <Input
                  id="discount"
                  inputMode="decimal"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  placeholder="0.00"
                  className="h-8 w-28 text-right"
                />
              </div>
              {settings.data && !can("pos:manage") && (
                <p className="text-right text-[11px] text-muted-foreground">ให้ส่วนลดได้สูงสุด {settings.data.maxDiscountPct}%</p>
              )}
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>VAT 7% (รวมในราคาแล้ว)</span>
                <span className="tabular-nums">{formatMoney(totals.vat)}</span>
              </div>
              <div className="flex items-baseline justify-between pt-1">
                <span className="font-medium">ยอดสุทธิ</span>
                <span className="text-2xl font-semibold tabular-nums">{formatMoney(totals.total)}</span>
              </div>
              <Button size="lg" className="mt-2 h-12 w-full text-base" disabled={!cart.length || discountNum > totals.subtotal} onClick={() => setModal("pay")}>
                ชำระเงิน
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* Mobile checkout bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t border-border bg-card/95 p-3 backdrop-blur lg:hidden">
        <button className="min-w-0 flex-1 text-left" onClick={() => cartRef.current?.scrollIntoView({ behavior: "smooth" })}>
          <span className="block text-xs text-muted-foreground">{formatNumber(totals.units)} ชิ้น · ดูตะกร้า</span>
          <span className="text-lg font-semibold">{formatMoney(totals.total)}</span>
        </button>
        <Button size="lg" disabled={!cart.length} onClick={() => setModal("pay")}>
          ชำระเงิน
        </Button>
      </div>

      <Dialog open={modal !== null} onOpenChange={(o) => !o && closeModal()}>
        {modal === "pay" && <PaymentDialog total={totals.total} settings={settings.data} busy={paying} onConfirm={pay} />}
        {modal === "bills" && (
          <BillsDialog
            onReprint={(o) => {
              setReceipt(o);
              setModal("receipt");
            }}
          />
        )}
        {modal === "close" && <CloseShiftDialog shift={s} onClosed={() => setModal(null)} />}
        {modal === "settings" && settings.data && <PosSettingsDialog settings={settings.data} onDone={closeModal} />}
        {modal === "receipt" && receipt && (
          <DialogContent title={receipt.status === "cancelled" ? "ใบเสร็จ (ยกเลิกแล้ว)" : "ขายสำเร็จ"} className="max-w-md">
            {receipt.change ? (
              <div className="mb-4 rounded-xl bg-success-soft p-4 text-center text-success">
                <p className="text-sm">เงินทอน</p>
                <p className="text-3xl font-semibold">{formatMoney(receipt.change)}</p>
              </div>
            ) : null}
            <div className="max-h-[50dvh] overflow-y-auto rounded-lg border border-border">
              <Receipt order={receipt} settings={settings.data} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => window.print()}>
                <Printer /> พิมพ์ใบเสร็จ
              </Button>
              <Button onClick={closeModal}>ขายบิลถัดไป</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
      {paying && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/10">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-8 shrink-0 rounded-full border px-3.5 text-sm transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
