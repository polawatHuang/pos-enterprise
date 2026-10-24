"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Ban,
  Coins,
  FileBarChart,
  GraduationCap,
  HelpCircle,
  Keyboard,
  Loader2,
  Lock,
  Minus,
  MonitorSmartphone,
  PackageOpen,
  PauseCircle,
  Plus,
  Printer,
  ReceiptText,
  ScanBarcode,
  Settings2,
  Sparkles,
  ShoppingCart,
  Star,
  TicketPercent,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { CartQuote, CatalogItem, DiscountCheck, DiscountCode, HeldBill, PaymentMethod, PosMember, PosOrder, PosSettings, Shift, ShiftReport } from "@/lib/types";
import { cn, formatDateTime, formatMoney, formatNumber } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Skeleton } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { ScanButton } from "@/components/ui/barcode-scanner";
import { useCategories } from "@/components/products/product-form";
import { BillsDialog } from "./bills-dialog";
import { baseQty, blockedNow, type CartLine, lineKey, lineMarkdown, lineTotal, nowHHMM, r2, totalsOf, unitName, unitPrice } from "./cart";
import { codeAmount, codeLabel, codeProblem, DiscountCodesDialog } from "./discount-codes";
import { type DisplayMessage, openDisplayChannel } from "./display-channel";
import { toggleFavorite, useFavorites } from "./favorites";
import { HELD_KEY, HeldDialog } from "./held-dialog";
import { LineDialog } from "./line-dialog";
import { ApprovalCancelled, ManagerPinHost, withApproval } from "./manager-approval";
import { OpenPriceDialog } from "./open-price-dialog";
import { GatewayDialog } from "./gateway-settings";
import { PosGuide } from "./pos-guide";
import { openDrawer, PrinterDialog, printOnUsb, printReceipt, usePrinterSettings } from "./printer";
import { receiptDoc, shiftReportDoc } from "./receipt-doc";
import { MemberDialog } from "./member-dialog";
import { METHOD_NAME, PaymentDialog, type PaymentResult } from "./payment-dialog";
import { Receipt } from "./receipt";
import { Upsell } from "./upsell";
import { POS_SETTINGS_KEY, PosSettingsDialog } from "./settings-dialog";
import { CashDialog, CloseShiftDialog, OpenShiftCard, SHIFT_KEY, ShiftReportView } from "./shift";
import { ShortcutsDialog } from "./shortcuts";
import { beep } from "./sound";
import { useTaxSettings } from "@/lib/tax";

type Modal =
  | "pay"
  | "codes"
  | "bills"
  | "close"
  | "settings"
  | "receipt"
  | "member"
  | "held"
  | "line"
  | "cash"
  | "report"
  | "keys"
  | "openprice"
  | "practice"
  | "printer"
  | "gateway"
  | null;

const GUIDE_KEY = "pos.guide.done";

/** Stand-in shift for training mode: the till works, nothing is saved. */
const PRACTICE_SHIFT: Shift = {
  id: 0,
  branchId: 0,
  branchName: "โหมดฝึกขาย",
  openedAt: new Date(0).toISOString(),
  closedAt: null,
  openingCash: 0,
  closingCash: null,
  expectedCash: 0,
  denominations: null,
  note: null,
  stats: { orders: 0, sales: 0, voided: 0, byMethod: {}, cash: { pay_in: 0, pay_out: 0, pickup: 0 } },
};
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
  const printer = usePrinterSettings();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [discount, setDiscount] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [code, setCode] = useState<DiscountCode | null>(null);
  const [checkingCode, setCheckingCode] = useState(false);
  const [member, setMember] = useState<PosMember | null>(null);
  const [pointsUse, setPointsUse] = useState(0);
  const [pendingQty, setPendingQty] = useState<number | null>(null);
  const [scanMiss, setScanMiss] = useState<string | null>(null);
  // Training mode: the whole till works but no sale, stock or money is recorded
  const [training, setTraining] = useState(false);
  const [practice, setPractice] = useState<{ total: number; change: number } | null>(null);
  const [openItem, setOpenItem] = useState<CatalogItem | null>(null);
  const [guide, setGuide] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(GUIDE_KEY) !== "1";
    } catch {
      return false;
    }
  });
  const closeGuide = () => {
    setGuide(false);
    try {
      localStorage.setItem(GUIDE_KEY, "1");
    } catch {
      /* storage blocked: the card comes back next visit */
    }
  };
  useEffect(() => {
    if (!scanMiss) return;
    const t = setTimeout(() => setScanMiss(null), 4000);
    return () => clearTimeout(t);
  }, [scanMiss]);
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

  // Promotions are priced by the server (same code as checkout); lines keep the quote for their key
  // while it matches their quantity, so totals don't flicker while the next quote loads.
  const quoteItems = cart.map((l) => ({ productId: l.item.id, unitId: l.unitId, quantity: l.quantity }));
  const quote = useQuery({
    queryKey: ["pos", "quote", JSON.stringify(quoteItems)],
    queryFn: async () => ({ ...(await api.post<CartQuote>("/pos/quote", { items: quoteItems })), keys: cart.map((l) => `${l.key}@${l.quantity}`) }),
    enabled: !!shift.data && cart.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 20_000,
    refetchInterval: 60_000, // time-window deals start and end while a bill is open
  });
  const priced = useMemo<CartLine[]>(() => {
    const q = cart.length ? quote.data : undefined;
    if (!q) return cart;
    return cart.map((l) => {
      const i = q.keys.indexOf(`${l.key}@${l.quantity}`);
      const ql = i >= 0 ? q.lines[i] : null;
      return ql ? { ...l, promo: { discount: ql.promoDiscount, markdown: ql.markdownKept, name: ql.promotionName } } : l;
    });
  }, [cart, quote.data]);
  const suggestions = cart.length ? (quote.data?.suggestions ?? []) : [];

  const pointValue = settings.data?.pointValue ?? 0;
  const discountNum = Math.max(Number(discount) || 0, 0);
  const lines = useMemo(() => totalsOf(priced, 0, 0, tax), [priced, tax]);
  // A code applies to the subtotal after line discounts, never more than what is left after the bill discount
  const codeIssue = code ? codeProblem(code, lines.subtotal, member?.id ?? null) : null;
  const codeOff = code && !codeIssue ? Math.min(codeAmount(code, lines.subtotal), Math.max(r2(lines.subtotal - discountNum), 0)) : 0;
  const billOff = r2(discountNum + codeOff);
  const base = useMemo(() => totalsOf(priced, billOff, 0, tax), [priced, billOff, tax]);
  const maxPoints = member && pointValue > 0 ? Math.min(member.points, Math.floor(base.total / pointValue)) : 0;
  const points = Math.min(pointsUse, maxPoints);
  const totals = useMemo(() => totalsOf(priced, billOff, r2(points * pointValue), tax), [priced, billOff, points, pointValue, tax]);
  const needsAge = cart.some((l) => l.item.ageRestricted);
  const selectedLine = cart.find((l) => l.key === selected) ?? null;

  /* ---------------------------------------------------------- customer display */
  const post = (m: DisplayMessage) => channel.current?.postMessage(m);
  const cartMessage = (): DisplayMessage => ({
    type: "cart",
    lines: priced.map((l) => ({ name: l.item.name, unit: unitName(l), quantity: l.quantity, total: lineTotal(l) })),
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
    if (item.openPrice) {
      // a priced open-price line is its own object in the cart: + adds to it; otherwise ask for the price
      const line = cart.find((l) => l.item === item);
      if (line) setQty(line.key, line.quantity + qty);
      else {
        setOpenItem(item);
        setModal("openprice");
      }
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
  /** An open-price line: the typed price and description ride on a copy of the item. */
  const addOpen = (item: CatalogItem, price: number, name: string, qty: number) => {
    const key = `${lineKey(item.id, null)}:open:${Date.now()}`;
    beep("ok");
    setCart((c) => [...c, { key, item: { ...item, price, name, promos: [], promoPrice: null, markdown: null }, unitId: null, quantity: qty, discount: 0 }]);
    setSelected(key);
    setOpenItem(null);
    setModal(null);
  };
  const lineBody = (l: CartLine) => ({
    productId: l.item.id,
    unitId: l.unitId,
    quantity: l.quantity,
    discount: l.discount || undefined,
    unitPrice: l.item.openPrice ? l.item.price : undefined,
    name: l.item.openPrice ? l.item.name : undefined,
  });
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
    setCode(null);
    setCodeInput("");
    setMember(null);
    setPointsUse(0);
    setSelected(null);
    setAgeByCustomer(false);
  };

  /** Barcode scanners type the code then Enter. "6*" first means the next scan counts 6. */
  const onSearchEnter = async (scanned?: string) => {
    const code = (scanned ?? search).trim();
    if (!code) return;
    setScanMiss(null);
    try {
      const item = await api.get<CatalogItem>("/pos/lookup", { code });
      add(item, item.matchedUnitId ?? null, pendingQty ?? 1);
      setSearch("");
      setPendingQty(null);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) {
        beep("error");
        toast.error(err instanceof Error ? err.message : "ค้นหาไม่สำเร็จ");
      } else if (scanned === undefined && catalog.data?.length === 1) {
        add(catalog.data[0], null, pendingQty ?? 1);
        setSearch("");
        setPendingQty(null);
      } else {
        // clear the box so the next scan starts clean; the message under it says what was missed
        beep("error");
        setScanMiss(code);
        setSearch("");
        setPendingQty(null);
      }
    }
  };
  const onSearchChange = (v: string) => {
    setScanMiss(null);
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
    if (training) return void toast.info("โหมดฝึกขายพักบิลไม่ได้");
    try {
      await api.post("/pos/held", {
        label: member?.name,
        cart: { items: cart.map(lineBody), discount: discountNum || undefined },
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
          const found = items.find((x) => x.id === i.productId);
          if (!found) return [];
          const open = found.openPrice && i.unitPrice !== undefined;
          const item = open ? { ...found, price: i.unitPrice!, name: i.name ?? found.name } : found;
          const key = open ? `${lineKey(item.id, null)}:open:${Math.random().toString(36).slice(2)}` : lineKey(item.id, i.unitId ?? null);
          return [{ key, item, unitId: open ? null : (i.unitId ?? null), quantity: i.quantity, discount: i.discount ?? 0 }];
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
  const applyCode = async () => {
    const c = codeInput.trim();
    if (!c) return;
    setCheckingCode(true);
    try {
      const r = await api.get<DiscountCheck>("/pos/discount-codes/check", { code: c, subtotal: lines.subtotal, customerId: member?.id });
      // Minimum spend can still be reached by adding items, so keep that code and show the hint
      if (r.code && (r.valid || r.reason?.startsWith("ใช้ได้เมื่อซื้อครบ"))) {
        setCode(r.code);
        setCodeInput("");
        if (r.valid) toast.success(`ใช้โค้ด ${r.code.code} · ${codeLabel(r.code)}`);
        else toast.warning(r.reason);
      } else {
        beep("error");
        toast.error(r.reason ?? "ใช้โค้ดนี้ไม่ได้");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ตรวจโค้ดไม่สำเร็จ");
    } finally {
      setCheckingCode(false);
    }
  };

  const openPay = (m: PaymentMethod) => {
    if (!cart.length) return;
    setPayMethod(m);
    setModal("pay");
    if (needsAge && !ageByCustomer) post({ type: "age", asking: true });
    post({ type: "pay", total: totals.total, qr: null, method: m });
  };

  const pay = async (p: PaymentResult) => {
    if (training) {
      // practice sale: same screens, nothing sent to the server
      const paid = r2(p.payments.reduce((sum, t) => sum + t.amount, 0));
      beep("done");
      setPractice({ total: totals.total, change: Math.max(0, r2(paid - totals.total)) });
      clearBill();
      setModal("practice");
      return;
    }
    setPaying(true);
    try {
      const body = {
        items: cart.map(lineBody),
        discount: discountNum || undefined,
        discountCode: codeOff > 0 ? code?.code : undefined,
        customerId: member?.id ?? null,
        pointsUsed: points || undefined,
        ageConfirmed: needsAge ? p.ageConfirmed : undefined,
        payments: p.payments,
      };
      // past the cashier's discount limit -> a manager's PIN lets this one sale through
      const order = await withApproval("override", async (h) => {
        if (h) setPaying(true);
        try {
          return await api.post<PosOrder>("/pos/checkout", body, h);
        } finally {
          setPaying(false);
        }
      });
      beep("done");
      post({ type: "done", total: order.total, change: order.change ?? 0, pointsEarned: order.pointsEarned });
      clearBill();
      setReceipt(order);
      setModal("receipt");
      // USB printer: the receipt prints by itself and the drawer opens for cash
      const tookCash = p.payments.some((t) => t.method === "cash");
      if (printer?.kind && printer.autoPrint) {
        printOnUsb(receiptDoc(order, settings.data, tax), { openDrawer: tookCash }).catch((err) =>
          toast.warning(`พิมพ์ใบเสร็จไม่สำเร็จ: ${err instanceof Error ? err.message : err} — กด พิมพ์ใบเสร็จ อีกครั้ง`),
        );
      } else if (tookCash) void openDrawer();
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
      if (err instanceof ApprovalCancelled) return;
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
    if (!shift.data && !training) return;
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
    if (training && (k === "F3" || k === "F5")) return act(() => toast.info("โหมดฝึกขายไม่มีสมาชิกและบิลพัก"));
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
  const reportDialog = modal === "report" && report && (
    <DialogContent title={report.kind === "Z" ? "ปิดกะเรียบร้อย · สรุปปิดกะ" : "สรุประหว่างกะ"} className="max-w-md">
      <div className="max-h-[60dvh] overflow-y-auto rounded-lg border border-border">
        <ShiftReportView report={report} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => void printReceipt(shiftReportDoc(report))}>
          <Printer /> พิมพ์
        </Button>
        <Button onClick={closeModal}>ปิด</Button>
      </div>
    </DialogContent>
  );
  if (!shift.data && !training)
    return (
      <>
        <OpenShiftCard onTraining={() => setTraining(true)} />
        {/* the shift that just closed is gone from the query, so its summary is shown here */}
        <Dialog open={!!reportDialog} onOpenChange={(o) => !o && closeModal()}>
          {reportDialog}
        </Dialog>
      </>
    );
  const s = shift.data ?? PRACTICE_SHIFT;
  const heldCount = held.data?.length ?? 0;

  return (
    <div className="pb-24 lg:pb-0">
      {/* Shift / tool bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">ขายหน้าร้าน</h1>
          <p className="truncate text-xs text-muted-foreground">
            {training
              ? "ลองขายได้ทุกขั้นตอน ไม่ตัดสต๊อก ไม่บันทึกยอด"
              : `${s.branchName} · เปิดกะ ${formatDateTime(s.openedAt)} · ${formatNumber(s.stats.orders)} บิล · ${formatMoney(s.stats.sales)}`}
          </p>
        </div>
        {!training && <ToolButton icon={PauseCircle} label="บิลพัก" k="F5" onClick={() => setModal("held")} badge={heldCount} />}
        {!training && <ToolButton icon={ReceiptText} label="บิล / คืนของ" onClick={() => setModal("bills")} />}
        <ToolButton icon={PackageOpen} label="ระบุราคา" onClick={() => (setOpenItem(null), setModal("openprice"))} />
        {!training && can("pos:manage") && <ToolButton icon={TicketPercent} label="โค้ดลด" onClick={() => setModal("codes")} />}
        {!training && <ToolButton icon={ArrowLeftRight} label="เงินเข้า/ออก" onClick={() => setModal("cash")} />}
        {!training && <ToolButton icon={FileBarChart} label="สรุปกะ" onClick={() => void showReport()} />}
        <ToolButton icon={MonitorSmartphone} label="จอลูกค้า" onClick={() => window.open("/customer-display", "pos-customer-display", "popup,width=1024,height=700")} />
        <ToolButton icon={HelpCircle} label="วิธีใช้" onClick={() => setGuide(true)} />
        <ToolButton icon={Keyboard} label="คีย์ลัด" k="F1" onClick={() => setModal("keys")} className="hidden lg:inline-flex" />
        <ToolButton icon={Printer} label="เครื่องพิมพ์" onClick={() => setModal("printer")} className="hidden lg:inline-flex" />
        {!training && can("pos:manage") && settings.data && <ToolButton icon={Settings2} label="ตั้งค่า" onClick={() => setModal("settings")} />}
        {training ? (
          <Button size="sm" className="h-11 sm:h-8" onClick={() => (clearBill(), setTraining(false))}>
            <GraduationCap /> จบการฝึก
          </Button>
        ) : (
          <Button variant="secondary" size="sm" className="h-11 sm:h-8" onClick={() => setModal("close")}>
            ปิดกะ
          </Button>
        )}
      </div>
      {training && (
        <div role="status" className="mb-3 flex items-center gap-2 rounded-xl border-2 border-warning bg-warning/10 px-4 py-2.5 text-sm font-medium">
          <GraduationCap className="size-5 shrink-0 text-warning" />
          โหมดฝึกขาย — ทุกอย่างที่ทำตอนนี้ไม่ถูกบันทึก ลองสแกน ใส่ส่วนลด และรับเงินได้เต็มที่
        </div>
      )}
      {guide && <PosGuide onClose={closeGuide} onTraining={training ? undefined : () => (closeGuide(), setTraining(true))} />}

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
              placeholder="สแกนบาร์โค้ด หรือพิมพ์ชื่อ/รหัสสินค้า · พิมพ์ 6* ก่อนสแกน = 6 ชิ้น"
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
              <kbd className="hidden rounded border border-border bg-muted px-1.5 text-xs text-muted-foreground lg:block">F2</kbd>
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
          {scanMiss && (
            <p role="alert" className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
              ไม่พบสินค้ารหัส {scanMiss} — ลองสแกนใหม่ หรือพิมพ์ชื่อสินค้า
            </p>
          )}
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
                {cart.length > 0 && <span className="hidden text-xs font-normal text-muted-foreground lg:inline">· F7 แก้รายการที่เลือก</span>}
              </h2>
              <div className="flex items-center gap-3">
                {cart.length > 0 && (
                  <button onClick={() => void hold()} className="text-xs font-medium text-warning hover:underline">
                    พักบิล<span className="hidden lg:inline"> F4</span>
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
                <button onClick={() => (training ? toast.info("โหมดฝึกขายไม่มีสมาชิก") : setModal("member"))} className="flex w-full items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                  <UserRound className="size-4" /> เพิ่มสมาชิก / สะสมแต้ม <kbd className="ml-auto hidden rounded border border-border bg-muted px-1.5 text-xs lg:block">F3</kbd>
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
              {priced.map((l) => (
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
                      {(l.promo ? l.promo.markdown : lineMarkdown(l)) > 0 && <span className="text-success"> · ลดใกล้หมดอายุ {l.item.markdown?.pct}%</span>}
                      {!!l.promo?.discount && (
                        <span className="text-success">
                          {" "}
                          · <Sparkles className="inline size-3" /> {l.promo.name} −{formatMoney(l.promo.discount)}
                        </span>
                      )}
                      {l.item.ageRestricted && <span className="text-warning"> · 20+</span>}
                    </p>
                  </div>
                  <div className="flex items-center rounded-lg border border-border bg-card" onClick={(e) => e.stopPropagation()}>
                    <button className="grid size-11 place-items-center sm:size-9" onClick={() => setQty(l.key, l.quantity - 1)} aria-label="ลด">
                      {l.quantity === 1 ? <Trash2 className="size-4 text-danger" /> : <Minus className="size-4" />}
                    </button>
                    <button className="h-11 w-9 text-center text-sm font-semibold tabular-nums sm:h-9" onClick={() => (setSelected(l.key), setModal("line"))} aria-label="แก้จำนวน">
                      {formatNumber(l.quantity)}
                    </button>
                    <button className="grid size-11 place-items-center sm:size-9" onClick={() => add(l.item, l.unitId)} aria-label="เพิ่ม">
                      <Plus className="size-4" />
                    </button>
                  </div>
                  <span className="w-20 text-right text-sm font-semibold tabular-nums">{formatMoney(lineTotal(l))}</span>
                </li>
              ))}
            </ul>
            <Upsell suggestions={suggestions} onAdd={(item, qty) => add(item, null, qty)} className="mx-3 mb-3" />
            <div className="space-y-1.5 border-t border-border bg-muted/30 p-4 text-sm">
              <Row label="รวม" value={formatMoney(totals.gross)} />
              {totals.promo > 0 && <Row label="ส่วนลดโปรโมชั่น" value={`−${formatMoney(totals.promo)}`} danger />}
              {r2(totals.lineDiscounts - totals.promo) > 0 && <Row label="ส่วนลดรายการ" value={`−${formatMoney(r2(totals.lineDiscounts - totals.promo))}`} danger />}
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="discount" className="text-muted-foreground">
                  ส่วนลดท้ายบิล <kbd className="hidden rounded border border-border bg-muted px-1 text-xs lg:inline">F6</kbd>
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
              {code ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                    <TicketPercent className="size-4 shrink-0 text-primary" />
                    <span className="truncate">
                      โค้ด <span className="font-mono font-semibold text-foreground">{code.code}</span> · {codeLabel(code)}
                    </span>
                    <button onClick={() => setCode(null)} className="shrink-0 rounded p-0.5 hover:bg-muted" aria-label="เอาโค้ดออก">
                      <X className="size-3.5" />
                    </button>
                  </span>
                  {codeIssue ? (
                    <span className="shrink-0 text-right text-xs text-warning">{codeIssue}</span>
                  ) : (
                    <span className="shrink-0 tabular-nums text-danger">−{formatMoney(codeOff)}</span>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="dcode" className="text-muted-foreground">
                    โค้ดส่วนลด
                  </label>
                  <div className="flex items-center gap-1">
                    <Input
                      id="dcode"
                      value={codeInput}
                      onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === "Enter" && void applyCode()}
                      placeholder="กรอกโค้ด"
                      autoCapitalize="characters"
                      className="h-8 w-28 font-mono uppercase"
                    />
                    <Button size="sm" variant="outline" className="h-8 px-2 text-xs" disabled={!codeInput.trim() || !cart.length || checkingCode} onClick={() => void applyCode()}>
                      {checkingCode ? <Loader2 className="animate-spin" /> : "ใช้"}
                    </Button>
                  </div>
                </div>
              )}
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
                  ชำระเงิน <kbd className="hidden rounded bg-primary-foreground/20 px-1 text-xs lg:inline">F10</kbd>
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
            suggestions={suggestions}
            onAddSuggestion={(item, qty) => add(item, null, qty)}
            onGatewayPaid={(amount) => post({ type: "paid", total: amount })}
            onQr={(qr, method, amount, image) => {
              const acc = settings.data?.bankAccount;
              post({
                type: "pay",
                total: amount,
                qr,
                qrImage: image ?? null,
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
        {modal === "codes" && <DiscountCodesDialog canManage={can("pos:manage")} />}
        {modal === "settings" && settings.data && <PosSettingsDialog settings={settings.data} onDone={closeModal} onGateway={() => setModal("gateway")} />}
        {modal === "gateway" && <GatewayDialog onDone={closeModal} />}
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
        {modal === "printer" && <PrinterDialog />}
        {modal === "openprice" && <OpenPriceDialog key={openItem?.id ?? 0} item={openItem} onAdd={addOpen} />}
        {modal === "practice" && practice && (
          <DialogContent title="ฝึกขายสำเร็จ" description="ของจริงจะขึ้นใบเสร็จตรงนี้ — บิลนี้ไม่ถูกบันทึก" className="max-w-sm">
            <div className="rounded-2xl bg-success p-5 text-center text-white">
              <p className="text-sm opacity-90">เงินทอน</p>
              <p className="text-5xl font-bold tabular-nums">{formatMoney(practice.change)}</p>
              <p className="mt-1 text-sm">ยอดบิล {formatMoney(practice.total)}</p>
            </div>
            <Button className="mt-4 w-full" onClick={closeModal} autoFocus>
              ฝึกบิลถัดไป
            </Button>
          </DialogContent>
        )}
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
              // edit in place: the line keeps its spot; a unit change that lands on another line folds that line in
              setCart((c) => {
                const merged = c.find((l) => l.key === key && l.key !== selectedLine.key);
                const edited = { ...selectedLine, key, unitId, quantity: quantity + (merged?.quantity ?? 0), discount: d };
                return c.filter((l) => l !== merged).map((l) => (l.key === selectedLine.key ? edited : l));
              });
              setSelected(key);
              closeModal();
            }}
          />
        )}
        {reportDialog}
        {modal === "receipt" && receipt && (
          <DialogContent
            title={receipt.status === "cancelled" ? "ใบเสร็จ (ยกเลิกแล้ว)" : receipt.change === undefined ? `ใบเสร็จ ${receipt.orderNo}` : "ขายสำเร็จ"}
            className="max-w-md"
          >
            {receipt.status !== "cancelled" && receipt.change !== undefined && (
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
              <Button variant="outline" onClick={() => void printReceipt(receiptDoc(receipt, settings.data, tax))}>
                <Printer /> พิมพ์ใบเสร็จ
              </Button>
              <Button onClick={closeModal} autoFocus>
                ขายบิลถัดไป
              </Button>
            </div>
            <button type="button" onClick={() => setModal("printer")} className="mt-3 min-h-10 w-full text-center text-xs text-muted-foreground hover:underline">
              เครื่องพิมพ์: {printer?.kind ? printer.name : "ใช้หน้าพิมพ์ของเบราว์เซอร์"} · ตั้งค่า
            </button>
          </DialogContent>
        )}
      </Dialog>
      <ManagerPinHost />
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
  // an open-price item keeps no stock: never "out", and its price is asked when tapped
  const out = !item.openPrice && item.stock <= 0;
  const low = !out && !item.openPrice && item.stock <= 5;
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
      {!out && (item.markdown || item.promos?.length) ? (
        <span className="pointer-events-none absolute -top-2 left-3 right-8 flex gap-1 overflow-hidden">
          {item.promos?.slice(0, 2).map((t) => (
            <span key={t.id} className="shrink-0 rounded-full bg-danger px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
              {t.label}
            </span>
          ))}
          {item.markdown && <span className="shrink-0 rounded-full bg-success px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">ลด {item.markdown.pct}% ใกล้หมดอายุ</span>}
        </span>
      ) : null}
      {inCart > 0 && (
        <span className="absolute right-2 top-2 grid min-w-6 place-items-center rounded-full bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-foreground">
          {formatNumber(inCart)}
        </span>
      )}
      <span className="pointer-events-none line-clamp-2 pr-6 text-sm font-medium leading-snug">{item.name}</span>
      {item.promoPrice != null && item.promoPrice < item.price ? (
        <span className="pointer-events-none mt-auto flex items-baseline gap-1.5 pt-2">
          <span className="text-lg font-bold text-danger tabular-nums">{formatMoney(item.promoPrice)}</span>
          <span className="text-xs text-muted-foreground line-through tabular-nums">{formatMoney(item.price)}</span>
        </span>
      ) : (
        <span className="pointer-events-none mt-auto pt-2 text-lg font-bold text-primary tabular-nums">{item.openPrice ? "ระบุราคา" : formatMoney(item.price)}</span>
      )}
      <span className={cn("pointer-events-none flex items-center gap-1 pr-5 text-[11px]", out || low ? "text-danger" : "text-muted-foreground")}>
        {blocked ? (
          <>
            <Lock className="size-3" /> งดขาย {item.saleBlock?.from}–{item.saleBlock?.to}
          </>
        ) : out ? (
          <>
            <Ban className="size-3" /> หมด
          </>
        ) : item.openPrice ? (
          "แตะเพื่อใส่ราคา"
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
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      className={cn("relative h-12 min-w-14 flex-col gap-0.5 px-2 text-[11px] sm:h-8 sm:min-w-0 sm:flex-row sm:gap-1.5 sm:px-3 sm:text-xs", className)}
      title={k ? `${label} (${k})` : label}
    >
      <Icon />
      <span className="leading-none sm:leading-normal">{label}</span>
      {k && <span className="hidden text-muted-foreground lg:inline">{k}</span>}
      {!!badge && <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-warning text-[10px] font-bold text-white">{badge}</span>}
    </Button>
  );
}

function PayButton({ label, k, onClick, disabled }: { label: string; k: string; onClick: () => void; disabled: boolean }) {
  return (
    <Button variant="outline" className="h-14 flex-col gap-0 text-sm" onClick={onClick} disabled={disabled}>
      {label}
      <span className="hidden text-xs text-muted-foreground lg:block">{k}</span>
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
