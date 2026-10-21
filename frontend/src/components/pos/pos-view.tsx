"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Ban,
  Coins,
  FileBarChart,
  Keyboard,
  Loader2,
  Lock,
  Minus,
  MonitorSmartphone,
  PauseCircle,
  Plus,
  Printer,
  ReceiptText,
  ScanBarcode,
  Settings2,
  ShoppingCart,
  Star,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { CatalogItem, HeldBill, PaymentMethod, PosMember, PosOrder, PosSettings, Shift, ShiftReport } from "@/lib/types";
import { cn, formatDateTime, formatMoney, formatNumber } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Skeleton } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { ScanButton } from "@/components/ui/barcode-scanner";
import { useCategories } from "@/components/products/product-form";
import { BillsDialog } from "./bills-dialog";
import { baseQty, blockedNow, type CartLine, lineKey, lineMarkdown, lineTotal, nowHHMM, r2, totalsOf, unitName, unitPrice } from "./cart";
import { type DisplayMessage, openDisplayChannel } from "./display-channel";
import { toggleFavorite, useFavorites } from "./favorites";
import { HELD_KEY, HeldDialog } from "./held-dialog";
import { LineDialog } from "./line-dialog";
import { MemberDialog } from "./member-dialog";
import { METHOD_NAME, PaymentDialog, type PaymentResult } from "./payment-dialog";
import { Receipt } from "./receipt";
import { POS_SETTINGS_KEY, PosSettingsDialog } from "./settings-dialog";
import { CashDialog, CloseShiftDialog, OpenShiftCard, SHIFT_KEY, ShiftReportView } from "./shift";
import { ShortcutsDialog } from "./shortcuts";
import { beep } from "./sound";
import { useTaxSettings } from "@/lib/tax";

type Modal = "pay" | "bills" | "close" | "settings" | "receipt" | "member" | "held" | "line" | "cash" | "report" | "keys" | null;
type Filter = number | "all" | "fav";

export function PosView() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const shift = useQuery({ queryKey: SHIFT_KEY, queryFn: () => api.get<Shift | null>("/pos/shift") });
  const settings = useQuery({ queryKey: POS_SETTINGS_KEY, queryFn: () => api.get<PosSettings>("/pos/settings"), staleTime: 5 * 60_000 });
  const held = useQuery({ queryKey: HELD_KEY, queryFn: () => api.get<HeldBill[]>("/pos/held"), enabled: !!shift.data });
  const categories = useCategories();
  const favorites = useFavorites();
  const { tax } = useTaxSettings();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [discount, setDiscount] = useState("");
  const [member, setMember] = useState<PosMember | null>(null);
  const [pointsUse, setPointsUse] = useState(0);
  const [pendingQty, setPendingQty] = useState<number | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [receipt, setReceipt] = useState<PosOrder | null>(null);
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [paying, setPaying] = useState(false);
  const [ageByCustomer, setAgeByCustomer] = useState(false);
  const [tab, setTab] = useState<"products" | "cart">("products");
  const [now, setNow] = useState(nowHHMM);
  const searchRef = useRef<HTMLInputElement>(null);
  const discountRef = useRef<HTMLInputElement>(null);
  const channel = useRef<BroadcastChannel | null>(null);

  const catalog = useQuery({
    queryKey: ["pos", "catalog", search, filter, filter === "fav" ? favorites.join(",") : ""],
    queryFn: () =>
      filter === "fav"
        ? favorites.length
          ? api.get<CatalogItem[]>("/pos/catalog", { ids: favorites.join(","), limit: 60 })
          : Promise.resolve([])
        : api.get<CatalogItem[]>("/pos/catalog", { q: search, categoryId: filter === "all" ? undefined : filter, limit: 60 }),
    enabled: !!shift.data,
    placeholderData: keepPreviousData,
  });

  const pointValue = settings.data?.pointValue ?? 0;
  const discountNum = Math.max(Number(discount) || 0, 0);
  const base = useMemo(() => totalsOf(cart, discountNum, 0, tax), [cart, discountNum, tax]);
  const maxPoints = member && pointValue > 0 ? Math.min(member.points, Math.floor(base.total / pointValue)) : 0;
  const points = Math.min(pointsUse, maxPoints);
  const totals = useMemo(() => totalsOf(cart, discountNum, r2(points * pointValue), tax), [cart, discountNum, points, pointValue, tax]);
  const needsAge = cart.some((l) => l.item.ageRestricted);
  const selectedLine = cart.find((l) => l.key === selected) ?? null;

  /* ---------------------------------------------------------- customer display */
  const post = (m: DisplayMessage) => channel.current?.postMessage(m);
  const cartMessage = (): DisplayMessage => ({
    type: "cart",
    lines: cart.map((l) => ({ name: l.item.name, unit: unitName(l), quantity: l.quantity, total: lineTotal(l) })),
    total: totals.total,
    discount: r2(totals.gross - totals.total),
    member: member ? { name: member.name, points: member.points } : null,
  });
  const onDisplayMessage = useEffectEvent((m: DisplayMessage) => {
    if (m.type === "age-confirmed") {
      setAgeByCustomer(true);
      toast.success("ลูกค้ายืนยันอายุ 20+ แล้ว");
    }
    if (m.type === "hello") post(cart.length ? cartMessage() : { type: "idle" });
  });
  useEffect(() => {
    const ch = openDisplayChannel();
    channel.current = ch;
    if (ch) ch.onmessage = (e: MessageEvent<DisplayMessage>) => onDisplayMessage(e.data);
    const t = setInterval(() => setNow(nowHHMM()), 30_000);
    return () => {
      ch?.close();
      clearInterval(t);
    };
  }, []);
  useEffect(() => {
    if (modal === "pay" || modal === "receipt") return;
    channel.current?.postMessage(cart.length ? cartMessage() : ({ type: "idle" } satisfies DisplayMessage));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cartMessage derives from these values
  }, [cart, totals.total, member, modal]);

  /* ------------------------------------------------------------------- cart ops */
  const add = (item: CatalogItem, unitId: number | null = null, qty = 1) => {
    if (blockedNow(item.saleBlock, now)) {
      beep("error");
      toast.error(`ขาย "${item.name}" ไม่ได้ช่วง ${item.saleBlock!.from}–${item.saleBlock!.to}${item.saleBlock!.label ? ` (${item.saleBlock!.label})` : ""}`);
      return;
    }
    const key = lineKey(item.id, unitId);
    const factor = unitId ? (item.units.find((u) => u.id === unitId)?.factor ?? 1) : 1;
    const inCart = cart.filter((l) => l.item.id === item.id).reduce((s, l) => s + baseQty(l), 0);
    if (inCart + qty * factor > item.stock) {
      if (item.stock - inCart < factor) {
        beep("error");
        toast.error(`${item.name} คงเหลือ ${formatNumber(item.stock)} ${item.unit} ไม่พอ`);
        return;
      }
      toast.warning(`${item.name} คงเหลือ ${formatNumber(item.stock)} ${item.unit}`);
    }
    beep("ok");
    setCart((c) => {
      const existing = c.find((l) => l.key === key);
      return existing
        ? c.map((l) => (l.key === key ? { ...l, item, quantity: l.quantity + qty } : l))
        : [...c, { key, item, unitId, quantity: qty, discount: 0 }];
    });
    setSelected(key);
    setFlash(key);
    setTimeout(() => setFlash((f) => (f === key ? null : f)), 450);
  };
  const setQty = (key: string, q: number) => {
    setCart((c) => (q <= 0 ? c.filter((l) => l.key !== key) : c.map((l) => (l.key === key ? { ...l, quantity: q } : l))));
  };
  const remove = (key: string) => {
    setCart((c) => c.filter((l) => l.key !== key));
    setSelected(null);
  };
  const clearBill = () => {
    setCart([]);
    setDiscount("");
    setMember(null);
    setPointsUse(0);
    setSelected(null);
    setAgeByCustomer(false);
  };

  /** Barcode scanners type the code then Enter. "6*" first means the next scan counts 6. */
  const onSearchEnter = async (scanned?: string) => {
    const code = (scanned ?? search).trim();
    if (!code) return;
    try {
      const item = await api.get<CatalogItem>("/pos/lookup", { code });
      add(item, item.matchedUnitId ?? null, pendingQty ?? 1);
      setSearch("");
      setPendingQty(null);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) toast.error(err instanceof Error ? err.message : "ค้นหาไม่สำเร็จ");
      else if (scanned === undefined && catalog.data?.length === 1) {
        add(catalog.data[0], null, pendingQty ?? 1);
        setSearch("");
        setPendingQty(null);
      } else {
        beep("error");
        toast.error(`ไม่พบสินค้ารหัส ${code}`);
      }
    }
  };
  const onSearchChange = (v: string) => {
    const m = v.match(/^(\d{1,4})\*$/);
    if (m) {
      setPendingQty(Number(m[1]));
      setSearch("");
      return;
    }
    setSearch(v);
  };

  /* --------------------------------------------------------------- hold/recall */
  const hold = async () => {
    if (!cart.length) return;
    try {
      await api.post("/pos/held", {
        label: member?.name,
        cart: { items: cart.map((l) => ({ productId: l.item.id, unitId: l.unitId, quantity: l.quantity, discount: l.discount || undefined })), discount: discountNum || undefined },
        customerId: member?.id ?? null,
        total: totals.total,
      });
      toast.success("พักบิลแล้ว — กด F5 เพื่อเรียกกลับ");
      clearBill();
      void qc.invalidateQueries({ queryKey: HELD_KEY });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "พักบิลไม่สำเร็จ");
    }
  };
  const recall = async (b: HeldBill) => {
    if (cart.length) {
      toast.error("ชำระหรือพักบิลปัจจุบันก่อนเรียกบิลอื่น");
      return;
    }
    try {
      const items = await api.get<CatalogItem[]>("/pos/catalog", { ids: [...new Set(b.cart.items.map((i) => i.productId))].join(","), limit: 200 });
      await api.del(`/pos/held/${b.id}`);
      setCart(
        b.cart.items.flatMap((i) => {
          const item = items.find((x) => x.id === i.productId);
          return item ? [{ key: lineKey(item.id, i.unitId ?? null), item, unitId: i.unitId ?? null, quantity: i.quantity, discount: i.discount ?? 0 }] : [];
        }),
      );
      setDiscount(b.cart.discount ? String(b.cart.discount) : "");
      if (b.customerId) {
        const found = await api.get<PosMember[]>("/pos/customers", { q: b.customerName ?? "" }).catch(() => []);
        setMember(found.find((m) => m.id === b.customerId) ?? null);
      }
      setModal(null);
      void qc.invalidateQueries({ queryKey: HELD_KEY });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เรียกบิลไม่สำเร็จ");
    }
  };

  /* ------------------------------------------------------------------- payment */
  const openPay = (m: PaymentMethod) => {
    if (!cart.length) return;
    setPayMethod(m);
    setModal("pay");
    if (needsAge && !ageByCustomer) post({ type: "age", asking: true });
    post({ type: "pay", total: totals.total, qr: null, method: m });
  };

  const pay = async (p: PaymentResult) => {
    setPaying(true);
    try {
      const order = await api.post<PosOrder>("/pos/checkout", {
        items: cart.map((l) => ({ productId: l.item.id, unitId: l.unitId, quantity: l.quantity, discount: l.discount || undefined })),
        discount: discountNum || undefined,
        customerId: member?.id ?? null,
        pointsUsed: points || undefined,
        ageConfirmed: needsAge ? p.ageConfirmed : undefined,
        payments: p.payments,
      });
      beep("done");
      post({ type: "done", total: order.total, change: order.change ?? 0, pointsEarned: order.pointsEarned });
      clearBill();
      setReceipt(order);
      setModal("receipt");
      void qc.invalidateQueries({ queryKey: ["pos"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      const limit = settings.data?.cashLimit ?? 0;
      if (limit > 0) {
        const s = await qc.fetchQuery({ queryKey: SHIFT_KEY, queryFn: () => api.get<Shift | null>("/pos/shift") });
        if (s && s.expectedCash > limit) toast.warning(`เงินสดในลิ้นชัก ${formatMoney(s.expectedCash)} เกินที่ตั้งไว้ — นำเข้าตู้เซฟ`, { duration: 8000 });
      }
    } catch (err) {
      beep("error");
      toast.error(err instanceof Error ? err.message : "ชำระเงินไม่สำเร็จ");
    } finally {
      setPaying(false);
    }
  };

  const closeModal = () => {
    if (modal === "pay") post(cart.length ? cartMessage() : { type: "idle" });
    if (modal === "receipt") post({ type: "idle" });
    setModal(null);
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const showReport = async () => {
    try {
      setReport(await api.get<ShiftReport>("/pos/shift/report"));
      setModal("report");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "โหลดรายงานไม่สำเร็จ");
    }
  };

  /* ------------------------------------------------------------------ keyboard */
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (!shift.data) return;
    const fkey = /^F([1-9]|10)$/.test(e.key);
    if (modal !== null && !fkey) return;
    if (modal !== null && modal !== "pay") return;
    const inField = e.target instanceof HTMLInputElement && e.target !== searchRef.current;
    const k = e.key;
    const act = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    if (k === "F1") return act(() => setModal("keys"));
    if (k === "F2") return act(() => searchRef.current?.focus());
    if (modal === "pay") {
      if (k === "F8" || k === "F9") e.preventDefault();
      return;
    }
    if (k === "F3") return act(() => setModal("member"));
    if (k === "F4") return act(() => void hold());
    if (k === "F5") return act(() => setModal("held"));
    if (k === "F6") return act(() => discountRef.current?.focus());
    if (k === "F7" && selectedLine) return act(() => setModal("line"));
    if (k === "F8") return act(() => openPay("cash"));
    if (k === "F9") return act(() => openPay("promptpay"));
    if (k === "F10") return act(() => openPay("cash"));
    if (inField) return;
    if (k === "Escape" && search) return act(() => setSearch(""));
    // While a code is being typed (e.g. "PACK-4"), every key belongs to the search box
    if (search) return;
    if (!cart.length) return;
    const idx = cart.findIndex((l) => l.key === selected);
    if (k === "ArrowDown") return act(() => setSelected(cart[Math.min(idx + 1, cart.length - 1)].key));
    if (k === "ArrowUp") return act(() => setSelected(cart[Math.max(idx - 1, 0)].key));
    if (selectedLine && (k === "+" || (k === "=" && e.shiftKey))) return act(() => add(selectedLine.item, selectedLine.unitId));
    if (selectedLine && k === "-") return act(() => setQty(selectedLine.key, selectedLine.quantity - 1));
    if (selectedLine && k === "Delete") return act(() => remove(selectedLine.key));
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  if (shift.isPending) return <Skeleton className="h-[70vh] w-full rounded-xl" />;
  if (!shift.data) return <OpenShiftCard />;
  const s = shift.data;
  const heldCount = held.data?.length ?? 0;

  return (
    <div className="pb-24 lg:pb-0">
      {/* Shift / tool bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">ขายหน้าร้าน</h1>
          <p className="truncate text-xs text-muted-foreground">
            {s.branchName} · เปิดกะ {formatDateTime(s.openedAt)} · {formatNumber(s.stats.orders)} บิล · {formatMoney(s.stats.sales)}
          </p>
        </div>
        <ToolButton icon={PauseCircle} label="บิลพัก" k="F5" onClick={() => setModal("held")} badge={heldCount} />
        <ToolButton icon={ReceiptText} label="บิลในกะ" onClick={() => setModal("bills")} />
        <ToolButton icon={ArrowLeftRight} label="เงินเข้า/ออก" onClick={() => setModal("cash")} />
        <ToolButton icon={FileBarChart} label="รายงาน X" onClick={() => void showReport()} />
        <ToolButton icon={MonitorSmartphone} label="จอลูกค้า" onClick={() => window.open("/customer-display", "pos-customer-display", "popup,width=1024,height=700")} />
        <ToolButton icon={Keyboard} label="คีย์ลัด" k="F1" onClick={() => setModal("keys")} className="hidden lg:inline-flex" />
        {can("pos:manage") && settings.data && <ToolButton icon={Settings2} label="ตั้งค่า" onClick={() => setModal("settings")} />}
        <Button variant="secondary" size="sm" onClick={() => setModal("close")}>
          ปิดกะ
        </Button>
      </div>

      {/* Mobile tabs */}
      <div className="mb-3 grid grid-cols-2 rounded-xl bg-muted p-1 lg:hidden" role="tablist">
        {(["products", "cart"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn("rounded-lg py-2 text-sm font-medium", tab === t ? "bg-card shadow-sm" : "text-muted-foreground")}
          >
            {t === "products" ? "สินค้า" : `ตะกร้า (${formatNumber(totals.units)})`}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Catalog */}
        <section aria-label="สินค้า" className={cn("min-w-0", tab !== "products" && "hidden lg:block")}>
          <div className="relative">
            <ScanBarcode className="absolute left-3.5 top-1/2 size-6 -translate-y-1/2 text-primary" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void onSearchEnter();
                }
              }}
              placeholder="สแกนบาร์โค้ด หรือพิมพ์ชื่อ/SKU · พิมพ์ 6* ก่อนสแกน = 6 ชิ้น"
              className="h-14 rounded-2xl pl-12 pr-32 text-lg shadow-sm"
              aria-label="สแกนหรือค้นหาสินค้า"
              autoFocus
            />
            <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
              {pendingQty && (
                <button onClick={() => setPendingQty(null)} className="rounded-full bg-primary px-2.5 py-1 text-sm font-semibold text-primary-foreground" aria-label="ยกเลิกจำนวน">
                  ×{pendingQty}
                </button>
              )}
              {search && (
                <button onClick={() => setSearch("")} className="text-muted-foreground" aria-label="ล้าง">
                  <X className="size-4" />
                </button>
              )}
              <kbd className="hidden rounded border border-border bg-muted px-1.5 text-[10px] text-muted-foreground sm:block">F2</kbd>
              <ScanButton
                mode="continuous"
                beep={false}
                variant="ghost"
                title="สแกนสินค้าด้วยกล้อง"
                className="-mr-1.5 rounded-xl text-primary"
                onDetected={(code) => onSearchEnter(code)}
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            <Chip active={filter === "fav"} onClick={() => setFilter("fav")}>
              <Star className={cn("size-3.5", filter === "fav" ? "fill-current" : "fill-warning text-warning")} /> โปรด
            </Chip>
            <Chip active={filter === "all"} onClick={() => setFilter("all")}>
              ทั้งหมด
            </Chip>
            {categories.data?.map((c) => (
              <Chip key={c.id} active={filter === c.id} onClick={() => setFilter(c.id)}>
                {c.name}
              </Chip>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {catalog.isPending && Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
            {catalog.data?.map((item) => (
              <ProductTile
                key={item.id}
                item={item}
                inCart={cart.filter((l) => l.item.id === item.id).reduce((n, l) => n + baseQty(l), 0)}
                favorite={favorites.includes(item.id)}
                blocked={blockedNow(item.saleBlock, now)}
                onAdd={(unitId) => add(item, unitId)}
              />
            ))}
          </div>
          {catalog.data?.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">{filter === "fav" ? "ยังไม่มีสินค้าโปรด — กดดาวที่สินค้าเพื่อปักหมุด" : "ไม่พบสินค้า"}</p>
          )}
        </section>

        {/* Cart */}
        <div className={cn("lg:sticky lg:top-20 lg:self-start", tab !== "cart" && "hidden lg:block")}>
          <Card className="flex flex-col overflow-hidden lg:max-h-[calc(100dvh-7rem)]">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="flex items-center gap-2 font-semibold">
                <ShoppingCart className="size-4" /> ตะกร้า
                <span className="text-sm font-normal text-muted-foreground">({formatNumber(totals.units)})</span>
              </h2>
              <div className="flex items-center gap-3">
                {cart.length > 0 && (
                  <button onClick={() => void hold()} className="text-xs font-medium text-warning hover:underline">
                    พักบิล F4
                  </button>
                )}
                {cart.length > 0 && (
                  <button onClick={clearBill} className="text-xs text-danger hover:underline">
                    ยกเลิกบิล
                  </button>
                )}
              </div>
            </div>
            {/* Member */}
            <div className="border-b border-border px-4 py-2">
              {member ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="grid size-8 place-items-center rounded-full bg-primary-soft text-primary">
                    <UserRound className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{member.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {member.memberNo} · {formatNumber(member.points)} แต้ม
                    </span>
                  </span>
                  <button onClick={() => (setMember(null), setPointsUse(0))} aria-label="เอาสมาชิกออก" className="text-muted-foreground">
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <button onClick={() => setModal("member")} className="flex w-full items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                  <UserRound className="size-4" /> เพิ่มสมาชิก / สะสมแต้ม <kbd className="ml-auto rounded border border-border bg-muted px-1.5 text-[10px]">F3</kbd>
                </button>
              )}
            </div>
            <ul className="min-h-28 flex-1 divide-y divide-border overflow-y-auto" aria-label="รายการในตะกร้า">
              {cart.length === 0 && (
                <li className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
                  <ScanBarcode className="size-10 opacity-30" />
                  สแกนหรือแตะสินค้าเพื่อเริ่มขาย
                </li>
              )}
              {cart.map((l) => (
                <li
                  key={l.key}
                  onClick={() => setSelected(l.key)}
                  onDoubleClick={() => (setSelected(l.key), setModal("line"))}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-4 py-2.5 transition-colors",
                    selected === l.key ? "bg-primary-soft/60" : "hover:bg-accent/50",
                    flash === l.key && "animate-[pos-flash_0.45s_ease-out]",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{l.item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {l.unitId && <Badge tone="primary" className="mr-1 px-1.5 py-0 text-[10px]">{unitName(l)}</Badge>}
                      {formatMoney(unitPrice(l))}
                      {l.discount > 0 && <span className="text-danger"> · ลด {formatMoney(l.discount)}</span>}
                      {lineMarkdown(l) > 0 && <span className="text-success"> · ลดใกล้หมดอายุ {l.item.markdown?.pct}%</span>}
                      {l.item.ageRestricted && <span className="text-warning"> · 20+</span>}
                    </p>
                  </div>
                  <div className="flex items-center rounded-lg border border-border bg-card" onClick={(e) => e.stopPropagation()}>
                    <button className="grid size-8 place-items-center" onClick={() => setQty(l.key, l.quantity - 1)} aria-label="ลด">
                      {l.quantity === 1 ? <Trash2 className="size-3.5 text-danger" /> : <Minus className="size-3.5" />}
                    </button>
                    <button className="w-8 text-center text-sm font-semibold tabular-nums" onClick={() => (setSelected(l.key), setModal("line"))} aria-label="แก้จำนวน">
                      {formatNumber(l.quantity)}
                    </button>
                    <button className="grid size-8 place-items-center" onClick={() => add(l.item, l.unitId)} aria-label="เพิ่ม">
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                  <span className="w-20 text-right text-sm font-semibold tabular-nums">{formatMoney(lineTotal(l))}</span>
                </li>
              ))}
            </ul>
            <div className="space-y-1.5 border-t border-border bg-muted/30 p-4 text-sm">
              <Row label="รวม" value={formatMoney(totals.gross)} />
              {totals.lineDiscounts > 0 && <Row label="ส่วนลดรายการ" value={`−${formatMoney(totals.lineDiscounts)}`} danger />}
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="discount" className="text-muted-foreground">
                  ส่วนลดท้ายบิล <kbd className="rounded border border-border bg-muted px-1 text-[10px]">F6</kbd>
                </label>
                <Input
                  ref={discountRef}
                  id="discount"
                  inputMode="decimal"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchRef.current?.focus()}
                  placeholder="0.00"
                  className="h-8 w-28 text-right"
                />
              </div>
              {member && maxPoints > 0 && (
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="points" className="text-muted-foreground">
                    ใช้แต้ม (สูงสุด {formatNumber(maxPoints)})
                  </label>
                  <div className="flex items-center gap-1">
                    <Input
                      id="points"
                      inputMode="numeric"
                      value={pointsUse || ""}
                      onChange={(e) => setPointsUse(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                      placeholder="0"
                      className="h-8 w-20 text-right"
                    />
                    <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setPointsUse(maxPoints)}>
                      ทั้งหมด
                    </Button>
                  </div>
                </div>
              )}
              {points > 0 && <Row label={`แต้ม ${formatNumber(points)}`} value={`−${formatMoney(r2(points * pointValue))}`} danger />}
              {settings.data && !can("pos:manage") && <p className="text-right text-[11px] text-muted-foreground">ให้ส่วนลดได้สูงสุด {settings.data.maxDiscountPct}%</p>}
              {tax.vatRegistered && <Row label={`VAT ${tax.vatRate}% (รวมในราคาแล้ว)`} value={formatMoney(totals.vat)} muted />}
              <div className="flex items-baseline justify-between pt-1">
                <span className="font-medium">ยอดสุทธิ</span>
                <span className="text-3xl font-bold tracking-tight tabular-nums" data-testid="cart-total">
                  {formatMoney(totals.total)}
                </span>
              </div>
              <div className="grid grid-cols-[1fr_1fr_1.4fr] gap-2 pt-2">
                <PayButton label="เงินสด" k="F8" onClick={() => openPay("cash")} disabled={!cart.length} />
                <PayButton label="PromptPay" k="F9" onClick={() => openPay("promptpay")} disabled={!cart.length} />
                <Button size="lg" className="h-14 text-base" disabled={!cart.length || discountNum > totals.subtotal} onClick={() => openPay("cash")}>
                  ชำระเงิน <kbd className="rounded bg-primary-foreground/20 px-1 text-[10px]">F10</kbd>
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Mobile checkout bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t border-border bg-card/95 p-3 backdrop-blur lg:hidden">
        <button className="min-w-0 flex-1 text-left" onClick={() => setTab("cart")}>
          <span className="block text-xs text-muted-foreground">{formatNumber(totals.units)} ชิ้น · ดูตะกร้า</span>
          <span className="text-xl font-bold tabular-nums">{formatMoney(totals.total)}</span>
        </button>
        <Button size="lg" className="h-12" disabled={!cart.length} onClick={() => openPay("cash")}>
          ชำระเงิน
        </Button>
      </div>

      <Dialog open={modal !== null} onOpenChange={(o) => !o && closeModal()}>
        {modal === "pay" && (
          <PaymentDialog
            total={totals.total}
            settings={settings.data}
            busy={paying}
            initialMethod={payMethod}
            needsAge={needsAge}
            ageConfirmedByCustomer={ageByCustomer}
            onQr={(qr, method, amount) => {
              const acc = settings.data?.bankAccount;
              post({
                type: "pay",
                total: amount,
                qr,
                method: METHOD_NAME[method] ?? method,
                bank: method === "transfer" && acc ? { bank: acc.bank, number: acc.display ?? acc.number, name: acc.name } : null,
              });
            }}
            onConfirm={pay}
          />
        )}
        {modal === "bills" && (
          <BillsDialog
            onReprint={(o) => {
              setReceipt(o);
              setModal("receipt");
            }}
          />
        )}
        {modal === "close" && (
          <CloseShiftDialog
            shift={s}
            onClosed={(r) => {
              setReport(r);
              setModal("report");
            }}
          />
        )}
        {modal === "settings" && settings.data && <PosSettingsDialog settings={settings.data} onDone={closeModal} />}
        {modal === "member" && (
          <MemberDialog
            onPick={(m) => {
              setMember(m);
              setPointsUse(0);
              closeModal();
            }}
          />
        )}
        {modal === "held" && <HeldDialog onRecall={(b) => void recall(b)} />}
        {modal === "keys" && <ShortcutsDialog />}
        {modal === "cash" && <CashDialog onDone={closeModal} />}
        {modal === "line" && selectedLine && (
          <LineDialog
            line={selectedLine}
            onRemove={() => {
              remove(selectedLine.key);
              closeModal();
            }}
            onSave={({ quantity, unitId, discount: d }) => {
              const key = lineKey(selectedLine.item.id, unitId);
              setCart((c) => {
                const others = c.filter((l) => l.key !== selectedLine.key && l.key !== key);
                const merged = c.find((l) => l.key === key && l.key !== selectedLine.key);
                return [...others, { ...selectedLine, key, unitId, quantity: quantity + (merged?.quantity ?? 0), discount: d }];
              });
              setSelected(key);
              closeModal();
            }}
          />
        )}
        {modal === "report" && report && (
          <DialogContent title={report.kind === "Z" ? "ปิดกะเรียบร้อย · รายงาน Z" : "รายงาน X (ระหว่างกะ)"} className="max-w-md">
            <div className="max-h-[60dvh] overflow-y-auto rounded-lg border border-border">
              <ShiftReportView report={report} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => window.print()}>
                <Printer /> พิมพ์
              </Button>
              <Button onClick={closeModal}>ปิด</Button>
            </div>
          </DialogContent>
        )}
        {modal === "receipt" && receipt && (
          <DialogContent title={receipt.status === "cancelled" ? "ใบเสร็จ (ยกเลิกแล้ว)" : "ขายสำเร็จ"} className="max-w-md">
            {receipt.status !== "cancelled" && (
              <div className="mb-4 rounded-2xl bg-success p-5 text-center text-white">
                <p className="text-sm opacity-90">เงินทอน</p>
                <p className="text-5xl font-bold tabular-nums" data-testid="receipt-change">
                  {formatMoney(receipt.change ?? 0)}
                </p>
                {receipt.pointsEarned > 0 && <p className="mt-1 text-sm">ลูกค้าได้ +{formatNumber(receipt.pointsEarned)} แต้ม</p>}
              </div>
            )}
            <div className="max-h-[45dvh] overflow-y-auto rounded-lg border border-border">
              <Receipt order={receipt} settings={settings.data} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => window.print()}>
                <Printer /> พิมพ์ใบเสร็จ
              </Button>
              <Button onClick={closeModal} autoFocus>
                ขายบิลถัดไป
              </Button>
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

function ProductTile({
  item,
  inCart,
  favorite,
  blocked,
  onAdd,
}: {
  item: CatalogItem;
  inCart: number;
  favorite: boolean;
  blocked: boolean;
  onAdd: (unitId: number | null) => void;
}) {
  const out = item.stock <= 0;
  const low = !out && item.stock <= 5;
  return (
    <div
      className={cn(
        "group relative flex min-h-32 flex-col rounded-2xl border bg-card p-3 text-left transition-all",
        out || blocked ? "opacity-55" : "hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md",
        inCart > 0 ? "border-primary ring-2 ring-primary/15" : "border-border",
      )}
    >
      <button className="absolute inset-0 rounded-2xl" onClick={() => onAdd(null)} disabled={out || blocked} aria-label={`เพิ่ม ${item.name}`} />
      <button
        className={cn(
          "absolute bottom-2 right-2 z-10 transition-opacity",
          favorite ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-60",
        )}
        onClick={() => toggleFavorite(item.id)}
        aria-label={favorite ? "เลิกปักหมุด" : "ปักหมุดเป็นสินค้าโปรด"}
      >
        <Star className={cn("size-4", favorite ? "fill-warning text-warning" : "text-muted-foreground")} />
      </button>
      {item.markdown && !out && (
        <span className="pointer-events-none absolute -top-2 left-3 rounded-full bg-success px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
          ลด {item.markdown.pct}% ใกล้หมดอายุ
        </span>
      )}
      {inCart > 0 && (
        <span className="absolute right-2 top-2 grid min-w-6 place-items-center rounded-full bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-foreground">
          {formatNumber(inCart)}
        </span>
      )}
      <span className="pointer-events-none line-clamp-2 pr-6 text-sm font-medium leading-snug">{item.name}</span>
      <span className="pointer-events-none mt-auto pt-2 text-lg font-bold text-primary tabular-nums">{formatMoney(item.price)}</span>
      <span className={cn("pointer-events-none flex items-center gap-1 pr-5 text-[11px]", out || low ? "text-danger" : "text-muted-foreground")}>
        {blocked ? (
          <>
            <Lock className="size-3" /> งดขาย {item.saleBlock?.from}–{item.saleBlock?.to}
          </>
        ) : out ? (
          <>
            <Ban className="size-3" /> หมด
          </>
        ) : (
          `เหลือ ${formatNumber(item.stock)} ${item.unit}`
        )}
        {item.ageRestricted && <span className="ml-auto rounded bg-warning-soft px-1 font-semibold text-warning">20+</span>}
      </span>
      {item.units.length > 0 && !out && !blocked && (
        <div className="relative z-10 mt-2 flex flex-wrap gap-1">
          {item.units.map((u) => (
            <button
              key={u.id}
              onClick={() => onAdd(u.id)}
              className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium hover:border-primary hover:text-primary"
              title={`${u.name} = ${u.factor} ${item.unit}`}
            >
              {u.name} {formatMoney(u.price)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ToolButton({
  icon: Icon,
  label,
  k,
  badge,
  onClick,
  className,
}: {
  icon: typeof Coins;
  label: string;
  k?: string;
  badge?: number;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} className={cn("relative", className)} title={k ? `${label} (${k})` : label}>
      <Icon />
      <span className="hidden sm:inline">{label}</span>
      {!!badge && <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-warning text-[10px] font-bold text-white">{badge}</span>}
    </Button>
  );
}

function PayButton({ label, k, onClick, disabled }: { label: string; k: string; onClick: () => void; disabled: boolean }) {
  return (
    <Button variant="outline" className="h-14 flex-col gap-0 text-sm" onClick={onClick} disabled={disabled}>
      {label}
      <span className="text-[10px] text-muted-foreground">{k}</span>
    </Button>
  );
}

function Row({ label, value, danger, muted }: { label: string; value: string; danger?: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between", muted && "text-xs text-muted-foreground", danger && "text-danger")}>
      <span className={cn(!muted && !danger && "text-muted-foreground")}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-9 shrink-0 items-center gap-1 rounded-full border px-4 text-sm transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
