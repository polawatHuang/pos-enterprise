"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, LogOut, MapPin, Package, Trash2, UserRound } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Account = {
  customer: { displayName: string; pictureUrl: string | null };
  addresses: {
    id: number;
    recipientName: string;
    phone: string;
    email: string | null;
    address: string;
    postalCode: string;
    isDefault: boolean;
  }[];
  orders: {
    id: number;
    orderNo: string;
    status: string;
    total: number;
    orderedAt: string;
    trackPath: string;
  }[];
};

const orderStatus: Record<string, string> = {
  pending: "รอชำระเงิน",
  paid: "ชำระแล้ว",
  packed: "กำลังเตรียมสินค้า",
  shipped: "จัดส่งแล้ว",
  completed: "สำเร็จ",
  cancelled: "ยกเลิก",
  expired: "หมดเวลาชำระ",
};

export function StoreAccount({ slug, storeName, loginEnabled }: { slug: string; storeName: string; loginEnabled: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const account = useQuery({
    queryKey: ["public-store-customer", slug],
    queryFn: () => api.get<Account>(`/ecommerce/public/stores/${slug}/customer/account`),
    retry: false,
  });
  const loginRequired = account.error instanceof ApiError && account.error.status === 401;
  const loginReason = searchParams.get("reason") ?? "";
  const loginError = {
    cancelled: "คุณยกเลิกการเข้าสู่ระบบ LINE สามารถกดปุ่มเข้าสู่ระบบเพื่อลองอีกครั้งได้",
    state: "สถานะเข้าสู่ระบบไม่ตรงกันหรือหมดอายุ กรุณาเริ่มเข้าสู่ระบบใหม่ และอนุญาต cookies สำหรับเว็บไซต์นี้",
    proxy: "ค่า ECOMMERCE_AUTH_PROXY_SECRET ระหว่าง Vercel กับ Backend ไม่ตรงกัน หรือยังไม่ได้ตั้งค่า ให้ตรวจทั้งสองฝั่งแล้ว deploy/restart ใหม่",
    line: "LINE ปฏิเสธการแลกเปลี่ยน authorization code ตรวจว่า LINE_LOGIN_CHANNEL_ID, LINE_LOGIN_CHANNEL_SECRET และ Callback URL ตรงกับ LINE Login channel เดียวกัน",
    config: "Backend ยังตั้งค่า LINE Login ไม่ครบ ตรวจ LINE_LOGIN_CHANNEL_ID, LINE_LOGIN_CHANNEL_SECRET, APP_PUBLIC_URL และ ECOMMERCE_AUTH_PROXY_SECRET",
    backend: "เชื่อมต่อ Backend เพื่อจบการเข้าสู่ระบบไม่ได้ ตรวจ Backend Logs และสถานะ /api/health",
    deploy: "Backend ยังไม่มี API สำหรับ LINE Login กรุณา deploy โค้ด Backend ล่าสุดและ Restart App",
    session: "Backend ยืนยันตัวตนแล้วแต่ข้อมูลร้านไม่ตรงกัน กรุณาเริ่มเข้าสู่ระบบใหม่และตรวจ APP_PUBLIC_URL",
  }[loginReason];

  useEffect(() => {
    if (searchParams.get("login") !== "failed") return;
    toast.error(`LINE Login ไม่สำเร็จ${loginReason ? ` [${loginReason.toUpperCase()}]` : ""}`, {
      description: loginError ?? "ไม่ทราบสาเหตุ กรุณาตรวจ Backend Logs และลองใหม่",
      duration: 20_000,
      closeButton: true,
      id: `line-login-${slug}-${loginReason || "unknown"}`,
    });
  }, [loginError, loginReason, searchParams, slug]);

  const removeAddress = async (id: number) => {
    try {
      await api.del(`/ecommerce/public/stores/${slug}/customer/addresses/${id}`);
      await queryClient.invalidateQueries({ queryKey: ["public-store-customer", slug] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ลบที่อยู่ไม่สำเร็จ");
    }
  };

  const logout = async () => {
    try {
      const response = await fetch(`/shop/customer/logout?slug=${encodeURIComponent(slug)}`, { method: "POST" });
      if (!response.ok) throw new Error("ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง");
      await queryClient.removeQueries({ queryKey: ["public-store-customer", slug] });
      router.replace(`/shop/${slug}`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ออกจากระบบไม่สำเร็จ");
    }
  };

  return (
    <main className="min-h-dvh bg-[#f7f7fb] px-4 py-6 text-slate-950 sm:px-7 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <Link href={`/shop/${slug}`} className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-violet-700">
          <ArrowLeft className="size-4" /> กลับไปยัง {storeName}
        </Link>
        <header className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-white p-5 shadow-sm sm:p-7">
          <div className="flex items-center gap-4">
            {account.data?.customer.pictureUrl ? (
              <span className="size-14 rounded-full bg-cover bg-center ring-2 ring-violet-100" style={{ backgroundImage: `url("${account.data.customer.pictureUrl.replaceAll('"', "%22")}")` }} aria-label="รูปโปรไฟล์ LINE" />
            ) : <span className="grid size-14 place-items-center rounded-full bg-violet-50 text-violet-700"><UserRound className="size-7" /></span>}
            <div>
              <p className="text-xs font-semibold tracking-wide text-violet-700">บัญชี POSWITHAI</p>
              <h1 className="mt-1 text-xl font-bold">{account.data?.customer.displayName ?? "บัญชีของฉัน"}</h1>
              <p className="mt-1 text-xs text-slate-500">ข้อมูลบัญชีและคำสั่งซื้อสำหรับร้าน {storeName}</p>
            </div>
          </div>
          {account.data && <Button variant="outline" className="rounded-xl" onClick={() => void logout()}><LogOut className="size-4" /> ออกจากระบบ</Button>}
        </header>
        {searchParams.get("login") === "success" && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">เชื่อมต่อ LINE สำเร็จแล้ว</p>}
        {searchParams.get("login") === "failed" && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm leading-6 text-rose-800">{loginError ?? "เข้าสู่ระบบ LINE ไม่สำเร็จ กรุณาตรวจการตั้งค่าแล้วลองใหม่อีกครั้ง"}</p>}
        {searchParams.get("login") === "unavailable" && <p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">LINE Login ยังไม่พร้อมใช้งาน กรุณาติดต่อร้านค้าหรือลองใหม่ภายหลัง</p>}

        {account.isPending ? (
          <div className="mt-5 rounded-2xl bg-white p-8 text-center text-sm text-slate-500">กำลังโหลดข้อมูลบัญชี...</div>
        ) : loginRequired ? (
          <section className="mt-5 rounded-3xl bg-white p-8 text-center shadow-sm sm:p-12">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#06c755]/10 text-[#06a94a]"><UserRound className="size-7" /></span>
            <h2 className="mt-4 text-xl font-bold">เข้าสู่ระบบด้วย LINE</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">บันทึกที่อยู่ ดูประวัติการสั่งซื้อ และรีวิวสินค้าที่คุณซื้อจากร้านนี้</p>
            {loginEnabled
              ? <a href={`/shop/line/login?slug=${encodeURIComponent(slug)}`} className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-[#06c755] px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-[#05b34d]">เข้าสู่ระบบด้วย LINE</a>
              : <p className="mt-5 text-sm text-amber-700">ร้านนี้ยังไม่ได้ตั้งค่า LINE Login</p>}
          </section>
        ) : account.isError ? (
          <div role="alert" className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">โหลดข้อมูลบัญชีไม่สำเร็จ: {account.error.message}</div>
        ) : account.data ? (
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <section className="rounded-3xl bg-white p-5 shadow-sm sm:p-6">
              <h2 className="flex items-center gap-2 text-lg font-bold"><MapPin className="size-5 text-violet-600" /> ที่อยู่จัดส่ง</h2>
              {account.data.addresses.length ? (
                <ul className="mt-4 space-y-3">
                  {account.data.addresses.map((address) => <li key={address.id} className="rounded-2xl border border-slate-100 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">{address.recipientName} · {address.phone}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-600">{address.address} {address.postalCode}</p>
                        {address.isDefault && <span className="mt-2 inline-flex rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-semibold text-violet-700">ค่าเริ่มต้น</span>}
                      </div>
                      <button type="button" onClick={() => void removeAddress(address.id)} aria-label="ลบที่อยู่" className="grid size-8 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="size-4" /></button>
                    </div>
                  </li>)}
                </ul>
              ) : <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">ยังไม่มีที่อยู่ที่บันทึกไว้ เมื่อสั่งซื้อสามารถเลือกบันทึกที่อยู่ได้</p>}
            </section>

            <section className="rounded-3xl bg-white p-5 shadow-sm sm:p-6">
              <h2 className="flex items-center gap-2 text-lg font-bold"><Package className="size-5 text-violet-600" /> ประวัติคำสั่งซื้อ</h2>
              {account.data.orders.length ? (
                <ul className="mt-4 space-y-3">
                  {account.data.orders.map((order) => <li key={order.id} className="rounded-2xl border border-slate-100 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="font-semibold">{order.orderNo}</p><p className="mt-1 text-xs text-slate-500">{formatDateTime(order.orderedAt)}</p></div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">{orderStatus[order.status] ?? order.status}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-sm"><span className="font-bold">{formatMoney(order.total)} ฿</span><Link href={order.trackPath} className="font-semibold text-violet-700 hover:underline">ติดตามคำสั่งซื้อ</Link></div>
                  </li>)}
                </ul>
              ) : <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">ยังไม่มีคำสั่งซื้อในร้านนี้</p>}
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
