"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Heart,
  Loader2,
  LockKeyhole,
  MapPin,
  Minus,
  PackageCheck,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  TicketPercent,
  Truck,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { base64Of } from "@/lib/image";
import { formatDateTime, formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import type { PublicStoreSeoData } from "@/lib/ecommerce-seo";

type Product = {
  id: number;
  sku: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  price: number;
  unit: string;
  category: string | null;
  available: number;
};
type StorefrontData = PublicStoreSeoData;
type CartLine = { productId: number; quantity: number };
type CustomerAddress = {
  id: number;
  recipientName: string;
  phone: string;
  email: string | null;
  address: string;
  postalCode: string;
  isDefault: boolean;
};
type CustomerAccount = {
  customer: { displayName: string; pictureUrl: string | null };
  addresses: CustomerAddress[];
  orders: { id: number; orderNo: string; status: string; total: number; orderedAt: string; trackPath: string }[];
};
type Quote = {
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
  coupon: { valid: boolean; reason: string | null; amount: number };
};
type CreatedOrder = {
  id: number;
  orderNo: string;
  token: string;
  total: number;
  subtotal: number;
  discount: number;
  shippingFee: number;
  expiresAt: string | null;
  qrPayload: string;
  trackPath: string;
};
type TrackingData = {
  orderNo: string;
  status: string;
  paymentStatus: string;
  customerName: string;
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
  orderedAt: string;
  expiresAt: string;
  shipmentNote: string | null;
  shippedAt: string | null;
  qrPayload: string | null;
  items: { name: string; quantity: number; unitPrice: number; total: number }[];
};

async function readFile(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
    throw new Error("เลือกไฟล์ JPEG, PNG หรือ WebP ขนาดไม่เกิน 5 MB");
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("ไฟล์ไม่ถูกต้อง"));
    reader.readAsDataURL(file);
  });
  return { mimeType: file.type, imageBase64: base64Of(dataUrl) };
}

function ProductImage({ product, className = "" }: { product: Product; className?: string }) {
  return (
    <div
      role={product.imageUrl ? "img" : undefined}
      aria-label={product.imageUrl ? product.name : undefined}
      className={`store-product-image ${className}`}
      style={product.imageUrl ? { backgroundImage: `url("${product.imageUrl.replaceAll('"', "%22")}")` } : undefined}
    >
      {!product.imageUrl && <span aria-hidden className="store-image-mark">{product.name.slice(0, 1)}</span>}
    </div>
  );
}

export function Storefront({ slug, initialData }: { slug: string; initialData?: StorefrontData }) {
  const shop = useQuery({
    queryKey: ["public-store", slug],
    queryFn: () => api.get<StorefrontData>(`/ecommerce/public/stores/${slug}`),
    initialData,
    retry: false,
  });
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [category, setCategory] = useState("ทั้งหมด");
  const [search, setSearch] = useState("");
  const [discountInput, setDiscountInput] = useState("");
  const [discountCode, setDiscountCode] = useState("");
  const [order, setOrder] = useState<CreatedOrder | null>(null);
  const [saveAddress, setSaveAddress] = useState(false);
  const [customer, setCustomer] = useState({ customerName: "", phone: "", email: "", address: "", postalCode: "", note: "" });
  const account = useQuery({
    queryKey: ["public-store-customer", slug],
    queryFn: () => api.get<CustomerAccount>(`/ecommerce/public/stores/${slug}/customer/account`),
    enabled: Boolean(shop.data?.customerLoginEnabled),
    retry: false,
  });
  const products = useMemo(() => shop.data?.products ?? [], [shop.data?.products]);
  const categories = useMemo(() => ["ทั้งหมด", ...new Set(products.map((p) => p.category).filter((x): x is string => Boolean(x)))], [products]);
  const visible = products.filter((p) => (category === "ทั้งหมด" || p.category === category) && (!search || `${p.name} ${p.sku}`.toLowerCase().includes(search.toLowerCase())));
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const quote = useQuery({
    queryKey: ["public-store-quote", slug, cart, discountCode],
    queryFn: () => api.post<Quote>(`/ecommerce/public/stores/${slug}/quote`, { items: cart, code: discountCode }),
    enabled: cart.length > 0,
    retry: false,
  });
  const subtotal = cart.reduce((sum, line) => sum + (products.find((p) => p.id === line.productId)?.price ?? 0) * line.quantity, 0);
  const checkoutTotal = quote.data?.total ?? subtotal + (shop.data?.shippingFee ?? 60);
  const openCheckout = () => {
    const address = account.data?.addresses.find((item) => item.isDefault);
    if (address && !customer.customerName) {
      setCustomer((current) => ({
        ...current,
        customerName: address.recipientName,
        phone: address.phone,
        email: address.email ?? "",
        address: address.address,
        postalCode: address.postalCode,
      }));
    }
    setCheckoutOpen(true);
  };
  const add = (product: Product) => {
    setCart((current) => {
      const line = current.find((item) => item.productId === product.id);
      if (line && line.quantity >= product.available) {
        toast.error("ตะกร้าถึงจำนวนสินค้าที่มีในสต๊อกแล้ว");
        return current;
      }
      return line
        ? current.map((item) => item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item)
        : [...current, { productId: product.id, quantity: 1 }];
    });
  };
  const setQuantity = (productId: number, quantity: number) => {
    if (quantity <= 0) return setCart((current) => current.filter((line) => line.productId !== productId));
    const product = products.find((p) => p.id === productId);
    setCart((current) => current.map((line) => line.productId === productId ? { ...line, quantity: Math.min(quantity, product?.available ?? quantity) } : line));
  };
  const applyCode = () => {
    setDiscountCode(discountInput.trim());
  };
  const placeOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const created = await api.post<CreatedOrder>(`/ecommerce/public/stores/${slug}/orders`, {
        items: cart,
        ...(discountCode ? { discountCode } : {}),
        ...customer,
        saveAddress,
      });
      setOrder(created);
      setCheckoutOpen(false);
      setCartOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "สร้างคำสั่งซื้อไม่สำเร็จ");
    }
  };

  if (shop.isPending) return <StoreLoading />;
  if (!shop.data) return <StoreUnavailable />;

  return (
    <main className="store-shell min-h-dvh bg-[#f7f7fb] text-slate-950">
      <header className="store-header sticky top-0 z-30 border-b border-slate-200/70 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between gap-4 px-4 sm:px-7">
          <Link href={`/shop/${slug}`} className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-500/25"><ShoppingBag className="size-5" /></span>
            <span className="truncate text-base font-bold tracking-tight sm:text-lg">{shop.data.store.name}</span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-medium text-slate-500 md:flex">
            <a href="#shop-home" className="text-slate-950">หน้าแรก</a>
            <a href="#shop-products" className="hover:text-slate-950">สินค้า</a>
            <a href="#shop-service" className="hover:text-slate-950">บริการ</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href={`/shop/${slug}`} className="hidden rounded-full px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 sm:block">เลือกซื้อ</Link>
            {shop.data.customerLoginEnabled && <Link href={`/shop/${slug}/account`} className="inline-flex h-10 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold text-slate-700 hover:bg-violet-50 sm:px-3 sm:text-sm" aria-label="บัญชีของฉัน">
              <UserRound className="size-4" /> <span className="hidden sm:inline">{account.data?.customer.displayName ?? "บัญชี"}</span>
            </Link>}
            <Button className="relative size-10 rounded-full p-0" aria-label={`ตะกร้าสินค้า ${itemCount} ชิ้น`} onClick={() => setCartOpen(true)}>
              <ShoppingBag className="size-4" />
              {itemCount > 0 && <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-fuchsia-500 px-1 text-[10px] font-bold text-white">{itemCount}</span>}
            </Button>
          </div>
        </div>
      </header>

      <div id="shop-home" className="mx-auto max-w-7xl px-4 pb-20 pt-5 sm:px-7 sm:pt-8">
        <div className="mb-5 flex items-center justify-between gap-3 md:hidden">
          <div><p className="text-xs font-medium text-slate-500">ค้นหาสินค้าที่ใช่สำหรับคุณ</p><p className="mt-1 text-sm font-semibold">สินค้าพร้อมส่งจากสต๊อกจริง</p></div>
          <button type="button" onClick={() => setCartOpen(true)} className="relative grid size-11 shrink-0 place-items-center rounded-full bg-white text-slate-800 shadow-sm ring-1 ring-slate-200" aria-label="เปิดตะกร้า">
            <ShoppingBag className="size-5" />{itemCount > 0 && <span className="absolute -right-1 -top-1 size-4 rounded-full bg-violet-600 text-[10px] leading-4 text-white">{itemCount}</span>}
          </button>
        </div>

        <section className="store-hero relative isolate overflow-hidden rounded-[30px] bg-[#ece6ff] px-5 py-8 shadow-[0_24px_70px_-45px_rgba(80,48,150,.45)] sm:px-10 sm:py-11 lg:px-14 lg:py-14">
          <div className="store-hero-orb" aria-hidden />
          <div className="relative z-10 max-w-xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/60 px-3 py-1.5 text-[10px] font-bold tracking-[.15em] text-violet-700 shadow-sm sm:text-xs">
              <Sparkles className="size-3.5" /> CURATED FOR YOU
            </span>
            <h1 className="mt-5 max-w-lg text-3xl font-semibold leading-[1.13] tracking-tight text-slate-950 sm:text-5xl lg:text-[56px]">
              เลือกชิ้นที่ใช่<br /><span className="store-gradient-text">เติมเต็มทุกวันของคุณ</span>
            </h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-slate-600 sm:text-base">ช้อปสินค้าคุณภาพจาก {shop.data.store.name} จ่ายง่ายด้วย PromptPay พร้อมส่งจากสต๊อกจริง</p>
            <a href="#shop-products" className="store-cta mt-6 inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition hover:-translate-y-0.5 sm:h-12 sm:px-6">
              เลือกซื้อสินค้า <ArrowRight className="size-4" />
            </a>
            <div className="mt-6 flex flex-wrap gap-4 text-xs font-medium text-slate-600">
              <span className="inline-flex items-center gap-1.5"><Truck className="size-4 text-violet-600" /> ส่งทั่วไทย ฿60</span>
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-4 text-violet-600" /> ตรวจสอบสลิปปลอดภัย</span>
            </div>
          </div>
          <div className="store-hero-art absolute -right-5 bottom-0 top-0 hidden w-[53%] items-center justify-center lg:flex">
            <div className="store-art-glow" aria-hidden />
            <div className="store-art-card store-art-card-back" aria-hidden />
            <div className="store-art-card store-art-card-front">
              {products[0] ? <ProductImage product={products[0]} className="h-full w-full rounded-[26px]" /> : <span className="text-6xl">✦</span>}
            </div>
            <div className="store-art-float store-art-tag"><Sparkles className="size-4" /> New arrivals</div>
            <div className="store-art-float store-art-trust"><BadgeCheck className="size-5 text-emerald-500" /><span><b>ของแท้พร้อมส่ง</b><small>อัปเดตสต๊อกแบบเรียลไทม์</small></span></div>
          </div>
          <span className="store-hero-star store-star-one" aria-hidden>✦</span>
          <span className="store-hero-star store-star-two" aria-hidden>✧</span>
        </section>

        <section id="shop-service" className="store-service-strip mt-4 grid grid-cols-2 overflow-hidden rounded-2xl border border-slate-200/70 bg-white sm:grid-cols-4">
          {[
            [Truck, "จัดส่งทั่วไทย", "ค่าจัดส่ง 60 บาท"],
            [ShieldCheck, "ชำระปลอดภัย", "ตรวจสอบด้วย Slip2Go"],
            [PackageCheck, "สต๊อกจริง", "สินค้าพร้อมส่งเท่านั้น"],
            [Heart, "บริการใส่ใจ", "ดูแลโดยร้านค้าโดยตรง"],
          ].map(([Icon, title, caption], index) => {
            const ServiceIcon = Icon as typeof Truck;
            return <div key={String(title)} className={`flex items-center gap-3 px-3 py-4 sm:px-5 ${index < 3 ? "sm:border-r sm:border-slate-100" : ""} ${index < 2 ? "border-b border-slate-100 sm:border-b-0" : ""}`}>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600 sm:size-10"><ServiceIcon className="size-4.5" /></span>
              <span className="min-w-0"><b className="block truncate text-xs sm:text-sm">{String(title)}</b><small className="mt-0.5 block truncate text-[10px] text-slate-500 sm:text-xs">{String(caption)}</small></span>
            </div>;
          })}
        </section>

        <section className="mt-9 sm:mt-12">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.18em] text-violet-600">DISCOVER</p>
              <h2 id="shop-products" className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">สินค้าแนะนำ</h2>
              <p className="mt-1 text-sm text-slate-500">เลือกดูสินค้าพร้อมจำหน่ายจากคลังของร้าน</p>
            </div>
            <label className="relative block w-full sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาสินค้า..." className="h-11 rounded-xl border-slate-200 bg-white pl-9" />
            </label>
          </div>

          <div className="store-categories mt-5 flex gap-2 overflow-x-auto pb-2">
            {categories.map((name) => <button key={name} type="button" onClick={() => setCategory(name)} className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold transition ${category === name ? "bg-slate-950 text-white shadow-md" : "border border-slate-200 bg-white text-slate-600 hover:border-violet-300 hover:text-violet-700"}`}>{name}</button>)}
          </div>

          {visible.length ? (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
              {visible.map((product, index) => {
                const inCart = cart.find((line) => line.productId === product.id)?.quantity ?? 0;
                return (
                  <article key={product.id} className="store-product-card group" style={{ animationDelay: `${Math.min(index, 9) * 55}ms` }}>
                    <div className="relative overflow-hidden rounded-[18px] bg-[#f0eff5]">
                      <Link href={`/shop/${slug}/products/${product.id}`} aria-label={`ดูรายละเอียด ${product.name}`}>
                        <ProductImage product={product} className="aspect-[.95] w-full transition duration-500 group-hover:scale-[1.04]" />
                      </Link>
                      {index < 2 && <span className="absolute left-2.5 top-2.5 rounded-full bg-white/85 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-violet-700 shadow-sm">Featured</span>}
                      <button type="button" onClick={() => toast("เพิ่มสินค้าเข้ารายการโปรดเมื่อเข้าสู่ระบบ")} className="absolute right-2.5 top-2.5 grid size-8 place-items-center rounded-full bg-white/85 text-slate-500 shadow-sm transition hover:text-rose-500" aria-label="เพิ่มรายการโปรด"><Heart className="size-4" /></button>
                      <button type="button" onClick={() => add(product)} disabled={inCart >= product.available} className="store-quick-add absolute bottom-2.5 right-2.5 grid size-9 place-items-center rounded-full bg-white text-slate-900 shadow-lg transition hover:bg-violet-600 hover:text-white disabled:opacity-40 sm:translate-y-2 sm:opacity-0 sm:group-hover:translate-y-0 sm:group-hover:opacity-100" aria-label={`เพิ่ม ${product.name} ลงตะกร้า`}>
                        <Plus className="size-4" />
                      </button>
                    </div>
                    <div className="px-1 pt-3">
                      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-400">{product.category ?? "สินค้าแนะนำ"}</p>
                      <h3 className="mt-1 line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-slate-800"><Link href={`/shop/${slug}/products/${product.id}`} className="hover:text-violet-700">{product.name}</Link></h3>
                      <div className="mt-2 flex items-center justify-between gap-1">
                        <p className="text-sm font-bold text-slate-950">{formatMoney(product.price)} <small className="font-normal text-slate-500">/ {product.unit}</small></p>
                        <span className="text-[10px] text-slate-400">เหลือ {product.available}</span>
                      </div>
                      <button type="button" onClick={() => add(product)} disabled={inCart >= product.available} className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 text-xs font-semibold text-violet-700 transition hover:bg-violet-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:hidden">
                        <Plus className="size-3.5" /> เพิ่มลงตะกร้า
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-16 text-center">
              <ShoppingBag className="mx-auto size-9 text-slate-300" />
              <p className="mt-3 font-semibold">{products.length ? "ไม่พบสินค้าที่ค้นหา" : "ร้านกำลังเตรียมสินค้า"}</p>
              <p className="mt-1 text-sm text-slate-500">{products.length ? "ลองเปลี่ยนคำค้นหรือหมวดหมู่" : "กลับมาเยี่ยมชมใหม่เมื่อมีสินค้าในสต๊อก"}</p>
            </div>
          )}
        </section>

        <section className="mt-10 overflow-hidden rounded-2xl bg-slate-950 px-5 py-7 text-white sm:mt-14 sm:flex sm:items-center sm:justify-between sm:px-8">
          <div><p className="text-xs font-semibold tracking-[.16em] text-violet-300">READY WHEN YOU ARE</p><h2 className="mt-2 text-xl font-semibold">สินค้าพร้อมส่งจาก {shop.data.store.name}</h2><p className="mt-1 text-sm text-slate-400">ชำระด้วย QR PromptPay พร้อมแนบสลิปเพื่อยืนยันรายการ</p></div>
          <a href="#shop-products" className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-slate-950 transition hover:bg-violet-100 sm:mt-0">เลือกซื้อเลย <ArrowRight className="size-4" /></a>
        </section>
        <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-5 text-xs text-slate-500">
          <span>© {new Date().getFullYear()} {shop.data.store.name}</span><span className="flex items-center gap-1"><LockKeyhole className="size-3.5" /> Secure checkout by POSWITHAI</span>
        </footer>
      </div>

      {cartOpen && <CartDrawer
        products={products}
        cart={cart}
        paymentReady={shop.data.paymentReady}
        quote={quote.data}
        quoteLoading={quote.isFetching}
        discountInput={discountInput}
        discountCode={discountCode}
        onDiscountInput={setDiscountInput}
        onApplyCode={applyCode}
        onClose={() => setCartOpen(false)}
        onQuantity={setQuantity}
        onCheckout={() => { setCartOpen(false); openCheckout(); }}
      />}
      {checkoutOpen && <CheckoutModal
        customer={customer}
        setCustomer={setCustomer}
        addresses={account.data?.addresses ?? []}
        canSaveAddress={Boolean(account.data)}
        saveAddress={saveAddress}
        setSaveAddress={setSaveAddress}
        total={checkoutTotal}
        busy={quote.isFetching}
        onClose={() => setCheckoutOpen(false)}
        onSubmit={placeOrder}
      />}
      {order && <PaymentModal slug={slug} order={order} onClose={() => setOrder(null)} />}
    </main>
  );
}

function CartDrawer({
  products, cart, paymentReady, quote, quoteLoading, discountInput, discountCode, onDiscountInput, onApplyCode, onClose, onQuantity, onCheckout,
}: {
  products: Product[]; cart: CartLine[]; paymentReady: boolean; quote?: Quote; quoteLoading: boolean; discountInput: string; discountCode: string;
  onDiscountInput: (v: string) => void; onApplyCode: () => void; onClose: () => void; onQuantity: (id: number, qty: number) => void; onCheckout: () => void;
}) {
  const subtotal = cart.reduce((sum, line) => sum + (products.find((product) => product.id === line.productId)?.price ?? 0) * line.quantity, 0);
  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/45 backdrop-blur-[2px]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div><h2 className="text-lg font-semibold">ตะกร้าของคุณ</h2><p className="text-xs text-slate-500">{cart.reduce((sum, item) => sum + item.quantity, 0)} รายการ</p></div>
          <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full hover:bg-slate-100" aria-label="ปิดตะกร้า"><X className="size-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {!cart.length ? <div className="grid h-full place-items-center text-center"><div><ShoppingBag className="mx-auto size-9 text-slate-300" /><p className="mt-3 font-semibold">ตะกร้ายังว่างอยู่</p><p className="mt-1 text-sm text-slate-500">เลือกสินค้าที่คุณชอบแล้วมาเริ่มช้อปกัน</p></div></div> : (
            <>
              <div className="space-y-4">
                {cart.map((line) => {
                  const product = products.find((p) => p.id === line.productId);
                  if (!product) return null;
                  return <div key={line.productId} className="flex gap-3">
                    <ProductImage product={product} className="size-20 shrink-0 rounded-xl" />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-semibold">{product.name}</p>
                      <p className="mt-1 text-sm font-bold text-violet-700">{formatMoney(product.price)} ฿</p>
                      <div className="mt-2 flex items-center gap-2">
                        <button type="button" onClick={() => onQuantity(product.id, line.quantity - 1)} className="grid size-7 place-items-center rounded-full border border-slate-200" aria-label="ลดจำนวน"><Minus className="size-3" /></button>
                        <span className="min-w-5 text-center text-sm font-semibold">{line.quantity}</span>
                        <button type="button" disabled={line.quantity >= product.available} onClick={() => onQuantity(product.id, line.quantity + 1)} className="grid size-7 place-items-center rounded-full border border-slate-200 disabled:opacity-40" aria-label="เพิ่มจำนวน"><Plus className="size-3" /></button>
                        <button type="button" onClick={() => onQuantity(product.id, 0)} className="ml-auto text-xs text-slate-400 hover:text-rose-600">นำออก</button>
                      </div>
                    </div>
                  </div>;
                })}
              </div>
              <div className="mt-6 rounded-xl border border-dashed border-violet-200 bg-violet-50/60 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-violet-800"><TicketPercent className="size-3.5" /> โค้ดส่วนลด</p>
                <div className="flex gap-2"><Input value={discountInput} onChange={(event) => onDiscountInput(event.target.value)} placeholder="ใส่โค้ดโปรโมชั่น" className="h-9 bg-white" /><Button variant="outline" size="sm" onClick={onApplyCode}>ใช้โค้ด</Button></div>
                {discountCode && <p className={`mt-2 text-xs ${quote?.coupon.valid ? "text-emerald-700" : "text-rose-600"}`}>{quote?.coupon.valid ? `ใช้โค้ดแล้ว ลด ${formatMoney(quote.coupon.amount)} บาท` : quote?.coupon.reason ?? "กำลังตรวจสอบโค้ด..."}</p>}
              </div>
            </>
          )}
        </div>
        {cart.length > 0 && <div className="border-t border-slate-100 p-5">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">ยอดสินค้า</span><span>{formatMoney(quote?.subtotal ?? subtotal)} ฿</span></div>
            {quote?.discount ? <div className="flex justify-between text-emerald-700"><span>ส่วนลด</span><span>-{formatMoney(quote.discount)} ฿</span></div> : null}
            <div className="flex justify-between"><span className="text-slate-500">ค่าจัดส่ง</span><span>{formatMoney(quote?.shippingFee ?? 60)} ฿</span></div>
            <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-bold"><span>รวมทั้งหมด</span><span>{formatMoney(quote?.total ?? subtotal + 60)} ฿</span></div>
          </div>
          {quoteLoading && <p className="mt-2 text-xs text-slate-500">กำลังตรวจสอบสต๊อกและโปรโมชั่น…</p>}
          {!paymentReady && <p className="mt-3 rounded-lg bg-amber-50 p-2.5 text-xs leading-5 text-amber-800">ร้านกำลังปรับปรุงระบบรับชำระเงิน กรุณากลับมาใหม่ภายหลัง</p>}
          <Button className="mt-4 h-12 w-full rounded-xl" disabled={!paymentReady || !quote || quoteLoading || Boolean(discountCode && !quote.coupon.valid)} onClick={onCheckout}>ระบุที่อยู่และชำระเงิน <ArrowRight className="size-4" /></Button>
          <p className="mt-2 text-center text-[10px] text-slate-400">ค่าส่งเหมาจ่าย ฿60 · ชำระผ่าน QR PromptPay</p>
        </div>}
      </aside>
    </div>
  );
}

function CheckoutModal({
  customer, setCustomer, addresses, canSaveAddress, saveAddress, setSaveAddress, total, busy, onClose, onSubmit,
}: {
  customer: { customerName: string; phone: string; email: string; address: string; postalCode: string; note: string };
  addresses: CustomerAddress[];
  canSaveAddress: boolean;
  saveAddress: boolean;
  setSaveAddress: (value: boolean) => void;
  setCustomer: (value: (old: typeof customer) => typeof customer) => void; total: number; busy: boolean;
  onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <div className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-slate-950/50 p-3 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="my-auto w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200">
      <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
        <div><p className="text-xs font-semibold text-violet-700">CHECKOUT</p><h2 className="mt-1 text-xl font-semibold">ที่อยู่จัดส่ง</h2><p className="mt-1 text-xs text-slate-500">กรอกข้อมูลเพื่อสร้างคำสั่งซื้อและรับ QR ชำระเงิน</p></div>
        <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full hover:bg-slate-100" aria-label="ปิด"><X className="size-5" /></button>
      </div>
      <form className="space-y-4 p-5" onSubmit={onSubmit}>
        {addresses.length > 0 && <label className="block text-xs font-semibold text-slate-700">เลือกที่อยู่ที่บันทึกไว้
          <select
            defaultValue=""
            onChange={(event) => {
              const address = addresses.find((item) => item.id === Number(event.target.value));
              if (address) setCustomer((current) => ({
                ...current,
                customerName: address.recipientName,
                phone: address.phone,
                email: address.email ?? "",
                address: address.address,
                postalCode: address.postalCode,
              }));
            }}
            className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
          >
            <option value="">กรอกที่อยู่ใหม่</option>
            {addresses.map((address) => <option key={address.id} value={address.id}>{address.recipientName} · {address.address.slice(0, 60)}{address.isDefault ? " (ค่าเริ่มต้น)" : ""}</option>)}
          </select>
        </label>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-700">ชื่อผู้รับ<input required minLength={2} maxLength={191} value={customer.customerName} onChange={(e) => setCustomer((c) => ({ ...c, customerName: e.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" /></label>
          <label className="text-xs font-semibold text-slate-700">เบอร์โทรศัพท์<input required minLength={8} maxLength={50} inputMode="tel" value={customer.phone} onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" /></label>
        </div>
        <label className="block text-xs font-semibold text-slate-700">อีเมล (ถ้ามี)<input type="email" maxLength={191} value={customer.email} onChange={(e) => setCustomer((c) => ({ ...c, email: e.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" /></label>
        <label className="block text-xs font-semibold text-slate-700">ที่อยู่จัดส่ง<textarea required minLength={5} maxLength={1500} rows={3} value={customer.address} onChange={(e) => setCustomer((c) => ({ ...c, address: e.target.value }))} className="mt-1.5 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" placeholder="บ้านเลขที่ ถนน ตำบล/แขวง อำเภอ/เขต จังหวัด" /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-700">รหัสไปรษณีย์<input required minLength={3} maxLength={12} inputMode="numeric" value={customer.postalCode} onChange={(e) => setCustomer((c) => ({ ...c, postalCode: e.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" /></label>
          <label className="text-xs font-semibold text-slate-700">หมายเหตุ (ถ้ามี)<input maxLength={500} value={customer.note} onChange={(e) => setCustomer((c) => ({ ...c, note: e.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" placeholder="เช่น ฝากไว้ที่นิติบุคคล" /></label>
        </div>
        {canSaveAddress && <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={saveAddress} onChange={(event) => setSaveAddress(event.target.checked)} className="size-4 accent-violet-600" />บันทึกที่อยู่นี้ไว้ใช้ครั้งถัดไป</label>}
        <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm"><span className="text-slate-600">ยอดชำระรวม (รวมค่าส่ง ฿60)</span><b className="text-lg">{formatMoney(total)} ฿</b></div>
        <Button type="submit" className="h-12 w-full rounded-xl" disabled={busy}>สร้างคำสั่งซื้อและแสดง QR <ArrowRight className="size-4" /></Button>
        <p className="text-center text-[10px] text-slate-400">ระบบจะสำรองสินค้าไว้ 30 นาทีระหว่างรอชำระเงิน</p>
      </form>
    </section>
  </div>;
}

function PaymentModal({ slug, order, onClose }: { slug: string; order: CreatedOrder; onClose: () => void }) {
  const [qr, setQr] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(order.qrPayload, { width: 280, margin: 1, color: { dark: "#111827", light: "#ffffff" } }).then((url) => { if (active) setQr(url); });
    return () => { active = false; };
  }, [order.qrPayload]);
  const verify = async () => {
    if (!file) return setError("กรุณาเลือกรูปสลิปก่อน");
    setBusy(true);
    setError("");
    try {
      const payload = await readFile(file);
      const result = await api.post<{ verified: boolean; message: string }>(`/ecommerce/public/stores/${slug}/orders/${order.token}/verify-slip`, payload);
      if (!result.verified) setError(result.message || "ตรวจสอบสลิปไม่ผ่าน กรุณาตรวจสอบยอดและรูปอีกครั้ง");
      else setPaid(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ตรวจสอบสลิปไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  return <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-slate-950/55 p-3 backdrop-blur-md" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
    <section className="my-auto w-full max-w-md overflow-hidden rounded-[26px] bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-300">
      {paid ? (
        <div className="px-6 py-9 text-center">
          <div className="store-success-ring mx-auto grid size-20 place-items-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="size-11" /></div>
          <p className="mt-5 text-xs font-bold tracking-[.18em] text-emerald-700">PAYMENT VERIFIED</p>
          <h2 className="mt-2 text-2xl font-semibold">ชำระเงินเรียบร้อย!</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">ขอบคุณที่สั่งซื้อ เรากำลังเตรียมคำสั่งซื้อ <b className="text-slate-800">{order.orderNo}</b></p>
          <Link href={order.trackPath} className="mt-6 flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 text-sm font-semibold text-white hover:bg-violet-700">ติดตามคำสั่งซื้อ <ArrowRight className="size-4" /></Link>
          <button type="button" onClick={onClose} className="mt-3 text-xs text-slate-500 hover:text-slate-900">กลับไปเลือกซื้อสินค้า</button>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between border-b border-slate-100 p-5">
            <div><p className="text-xs font-bold tracking-[.16em] text-violet-700">ORDER {order.orderNo}</p><h2 className="mt-1 text-xl font-semibold">สแกนเพื่อชำระเงิน</h2><p className="mt-1 text-xs text-slate-500">PromptPay · ตรวจสอบสลิปด้วย Slip2Go</p></div>
            <button type="button" disabled={busy} onClick={onClose} className="grid size-9 place-items-center rounded-full hover:bg-slate-100 disabled:opacity-50" aria-label="ปิด"><X className="size-5" /></button>
          </div>
          <div className="p-5">
            <div className="rounded-2xl bg-gradient-to-br from-violet-50 to-indigo-50 p-4 text-center">
              <p className="text-xs text-slate-500">ยอดชำระ</p><p className="mt-1 text-3xl font-bold tracking-tight">{formatMoney(order.total)} <small className="text-base font-medium">บาท</small></p>
              <div className="mx-auto mt-3 grid size-[220px] place-items-center rounded-2xl bg-white p-3 shadow-sm sm:size-[240px]">
                {qr ? <Image src={qr} alt="QR PromptPay สำหรับชำระเงิน" width={216} height={216} unoptimized className="size-full" /> : <Loader2 className="size-7 animate-spin text-violet-600" />}
              </div>
              <p className="mt-3 flex items-center justify-center gap-1 text-[11px] text-slate-500"><Clock3 className="size-3.5" /> QR ใช้ได้ 30 นาที กรุณาโอนยอดให้ตรง</p>
            </div>
            <div className="mt-4 rounded-xl border border-slate-200 p-3">
              <p className="text-sm font-semibold">แนบสลิปเพื่อยืนยัน</p>
              <p className="mt-0.5 text-xs text-slate-500">ไฟล์รูป JPEG, PNG หรือ WebP ไม่เกิน 5 MB</p>
              <label className="mt-3 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-violet-300 bg-violet-50/50 px-3 text-sm font-medium text-violet-700 hover:bg-violet-50">
                <ArrowDown className="size-4" /> {file ? file.name : "เลือกรูปสลิปจากอุปกรณ์"}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(""); }} />
              </label>
              {error && <p className="mt-2 text-xs text-rose-600" role="alert">{error}</p>}
              <Button className="mt-3 h-11 w-full rounded-lg" disabled={busy || !file} onClick={() => void verify()}>{busy ? <><Loader2 className="size-4 animate-spin" /> กำลังตรวจสอบกับ Slip2Go…</> : <><ShieldCheck className="size-4" /> ตรวจสอบและยืนยันชำระเงิน</>}</Button>
            </div>
            <p className="mt-3 text-center text-[10px] leading-5 text-slate-400">การชำระเงินจะได้รับการยืนยันเมื่อ Slip2Go ตรวจสอบสลิปและยอดตรงกับคำสั่งซื้อ</p>
          </div>
        </>
      )}
    </section>
  </div>;
}

const ORDER_STEPS = [
  { key: "pending", label: "รอชำระเงิน", icon: Clock3 },
  { key: "paid", label: "ชำระแล้ว", icon: BadgeCheck },
  { key: "packed", label: "กำลังเตรียมสินค้า", icon: PackageCheck },
  { key: "shipped", label: "จัดส่งสำเร็จ", icon: Truck },
];

export function OrderTracking({ slug, token }: { slug: string; token: string }) {
  const order = useQuery({
    queryKey: ["public-order-track", slug, token],
    queryFn: () => api.get<TrackingData>(`/ecommerce/public/stores/${slug}/orders/${token}`),
    refetchInterval: 15_000,
    retry: false,
  });
  const [qr, setQr] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paid, setPaid] = useState(false);
  useEffect(() => {
    let active = true;
    if (!order.data?.qrPayload) return;
    void QRCode.toDataURL(order.data.qrPayload, { width: 220, margin: 1 }).then((url) => { if (active) setQr(url); });
    return () => { active = false; };
  }, [order.data?.qrPayload]);
  const verify = async () => {
    if (!file || !order.data) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.post<{ verified: boolean; message: string }>(`/ecommerce/public/stores/${slug}/orders/${token}/verify-slip`, await readFile(file));
      if (result.verified) {
        setPaid(true);
        void order.refetch();
      } else setError(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ตรวจสอบสลิปไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  if (order.isPending) return <StoreLoading />;
  if (!order.data) return <StoreUnavailable />;
  const currentIndex = ORDER_STEPS.findIndex((step) => step.key === (order.data?.status === "completed" ? "shipped" : order.data?.status));
  const expired = order.data.paymentStatus === "expired";
  return (
    <main className="store-shell min-h-dvh bg-[#f7f7fb] px-4 py-6 text-slate-950 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <Link href={`/shop/${slug}`} className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-violet-700"><ArrowLeft className="size-4" /> กลับไปหน้าร้าน</Link>
        <section className="mt-5 overflow-hidden rounded-[26px] border border-slate-200/80 bg-white shadow-[0_24px_70px_-55px_rgba(30,26,60,.5)]">
          <div className="bg-gradient-to-r from-slate-950 via-[#211840] to-violet-900 px-5 py-7 text-white sm:px-8">
            <p className="text-xs font-semibold tracking-[.16em] text-violet-200">ORDER TRACKING</p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-2xl font-semibold">{order.data.orderNo}</h1>
              <button type="button" onClick={() => void order.refetch()} className="inline-flex h-9 items-center gap-2 rounded-full border border-white/20 px-3 text-xs font-medium hover:bg-white/10"><Clock3 className="size-3.5" /> อัปเดตสถานะ</button>
            </div>
            <p className="mt-2 text-sm text-white/65">สั่งซื้อเมื่อ {formatDateTime(order.data.orderedAt)} · ผู้รับ {order.data.customerName}</p>
          </div>
          <div className="grid gap-6 p-5 sm:p-8 lg:grid-cols-[1fr_260px]">
            <div>
              {expired ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-semibold">รายการชำระเงินหมดอายุ</p><p className="mt-1 leading-6">สินค้าไม่ได้ถูกจองต่อ กรุณาติดต่อร้านค้าก่อนโอนเงินหรือสร้างคำสั่งซื้อใหม่</p></div>
              ) : (
                <ol className="store-timeline">
                  {ORDER_STEPS.map((step, index) => {
                    const Icon = step.icon;
                    const done = index <= currentIndex;
                    const active = index === currentIndex;
                    return <li key={step.key} className={`store-timeline-step ${done ? "is-done" : ""} ${active ? "is-active" : ""}`}>
                      <span className="store-timeline-dot"><Icon className="size-4" /></span><span><b>{step.label}</b>{active && <small className="block mt-0.5 text-slate-500">{step.key === "shipped" ? order.data.shipmentNote || "ร้านยืนยันการจัดส่งแล้ว" : "สถานะล่าสุดของคำสั่งซื้อ"}</small>}</span>
                    </li>;
                  })}
                </ol>
              )}
              {order.data.paymentStatus === "pending" && !expired && (
                <div className="mt-6 rounded-2xl bg-violet-50 p-4">
                  <div className="flex items-center justify-between gap-3"><div><p className="font-semibold">รอชำระเงิน</p><p className="mt-1 text-xs text-slate-600">ยอด {formatMoney(order.data.total)} บาท · เหลือเวลาสำรองสินค้า 30 นาที</p></div><Clock3 className="size-5 text-violet-600" /></div>
                  {qr && <div className="mx-auto mt-4 grid size-48 place-items-center rounded-xl bg-white p-3"><Image src={qr} alt="QR PromptPay" width={180} height={180} unoptimized className="size-full" /></div>}
                  <label className="mt-4 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-violet-300 bg-white px-3 text-sm font-medium text-violet-700">
                    <ArrowDown className="size-4" /> {file ? file.name : "แนบสลิปโอนเงิน"}
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
                  </label>
                  {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
                  <Button className="mt-3 w-full" disabled={!file || busy} onClick={() => void verify()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} ยืนยันการชำระเงิน</Button>
                </div>
              )}
              {paid && <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="mr-1 inline size-4" /> Slip2Go ตรวจสอบและยืนยันยอดแล้ว กำลังอัปเดตคำสั่งซื้อ</div>}
            </div>
            <aside className="h-fit rounded-2xl border border-slate-200 p-4">
              <h2 className="font-semibold">สรุปคำสั่งซื้อ</h2>
              <div className="mt-3 space-y-3">
                {order.data.items.map((item, index) => <div key={`${item.name}-${index}`} className="flex justify-between gap-3 text-xs"><span className="min-w-0">{item.name} × {item.quantity}</span><span className="shrink-0 font-medium">{formatMoney(item.total)} ฿</span></div>)}
              </div>
              <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-xs">
                <div className="flex justify-between text-slate-500"><span>ยอดสินค้า</span><span>{formatMoney(order.data.subtotal)} ฿</span></div>
                {order.data.discount > 0 && <div className="flex justify-between text-emerald-700"><span>ส่วนลด</span><span>-{formatMoney(order.data.discount)} ฿</span></div>}
                <div className="flex justify-between text-slate-500"><span>ค่าจัดส่ง</span><span>{formatMoney(order.data.shippingFee)} ฿</span></div>
                <div className="flex justify-between border-t border-slate-100 pt-2 text-sm font-bold text-slate-950"><span>รวมสุทธิ</span><span>{formatMoney(order.data.total)} ฿</span></div>
              </div>
            </aside>
          </div>
          <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 text-center text-[10px] text-slate-500 sm:text-xs">สถานะอัปเดตอัตโนมัติทุก 15 วินาที · ดูแลโดยร้านค้าโดยตรง</div>
        </section>
      </div>
    </main>
  );
}

function StoreLoading() {
  return <div className="grid min-h-dvh place-items-center bg-[#f7f7fb]"><Loader2 className="size-7 animate-spin text-violet-600" aria-label="กำลังโหลดร้านค้า" /></div>;
}

function StoreUnavailable() {
  return <main className="grid min-h-dvh place-items-center bg-[#f7f7fb] px-5 text-center"><div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"><MapPin className="mx-auto size-9 text-violet-500" /><h1 className="mt-3 text-xl font-semibold">ไม่พบร้านค้าออนไลน์</h1><p className="mt-2 text-sm leading-6 text-slate-500">ร้านอาจยังไม่เปิดให้บริการ หรือลิงก์นี้ไม่ถูกต้อง</p><Link href="/" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-violet-700">กลับหน้าแรก <ChevronRight className="size-4" /></Link></div></main>;
}
