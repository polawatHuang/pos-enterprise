"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, BadgeCheck, MessageCircle, PackageCheck, Star, Truck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { PublicStoreSeoData } from "@/lib/ecommerce-seo";

type Product = PublicStoreSeoData["products"][number];
type ReviewData = {
  productName: string;
  count: number;
  average: number;
  reviews: { rating: number; text: string | null; createdAt: string; reviewer: string }[];
};
type EligibleOrder = { orderItemId: number; orderNo: string; orderedAt: string; quantity: number };

export function ProductDetail({
  slug,
  store,
  product,
}: {
  slug: string;
  store: PublicStoreSeoData;
  product: Product;
}) {
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(5);
  const [orderItemId, setOrderItemId] = useState("");
  const [text, setText] = useState("");
  const reviewsQuery = useQuery({
    queryKey: ["ecommerce-product-reviews", slug, product.id],
    queryFn: () => api.get<ReviewData>(`/ecommerce/public/stores/${slug}/products/${product.id}/reviews`),
    retry: false,
  });
  const eligibleQuery = useQuery({
    queryKey: ["ecommerce-reviewable-items", slug, product.id],
    queryFn: () => api.get<EligibleOrder[]>(`/ecommerce/public/stores/${slug}/products/${product.id}/reviewable`),
    enabled: Boolean(store.customerLoginEnabled),
    retry: false,
  });
  const similar = store.products
    .filter((item) => item.id !== product.id && (!product.category || item.category === product.category))
    .slice(0, 6);
  const reviewLoginRequired = eligibleQuery.error instanceof ApiError && eligibleQuery.error.status === 401;

  const submitReview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!orderItemId) return toast.error("เลือกรายการสั่งซื้อที่ต้องการรีวิว");
    try {
      await api.post(`/ecommerce/public/stores/${slug}/products/${product.id}/reviews`, {
        orderItemId: Number(orderItemId),
        rating,
        text,
      });
      setText("");
      setOrderItemId("");
      toast.success("ส่งรีวิวแล้ว ขอบคุณสำหรับความคิดเห็น");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ecommerce-product-reviews", slug, product.id] }),
        queryClient.invalidateQueries({ queryKey: ["ecommerce-reviewable-items", slug, product.id] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ส่งรีวิวไม่สำเร็จ");
    }
  };

  return (
    <main className="min-h-dvh bg-[#f7f7fb] px-4 py-6 text-slate-950 sm:px-7 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <Link href={`/shop/${slug}`} className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-violet-700">
          <ArrowLeft className="size-4" /> กลับไปยัง {store.store.name}
        </Link>
        <section className="mt-5 grid gap-6 rounded-3xl bg-white p-4 shadow-sm sm:p-7 lg:grid-cols-2 lg:gap-10">
          <div className="relative aspect-square overflow-hidden rounded-2xl bg-[#f0eff5]">
            {product.imageUrl ? (
              <div role="img" aria-label={product.name} className="size-full bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url("${product.imageUrl.replaceAll('"', "%22")}")` }} />
            ) : <div className="grid size-full place-items-center text-7xl font-bold text-violet-200">{product.name.slice(0, 1)}</div>}
          </div>
          <div className="flex flex-col py-1 sm:py-3">
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-violet-700">{product.category ?? store.store.name}</p>
            <h1 className="mt-3 text-2xl font-bold leading-tight tracking-tight sm:text-4xl">{product.name}</h1>
            <a href="#reviews" className="mt-4 inline-flex w-fit items-center gap-2 text-sm text-slate-600 hover:text-violet-700">
              <Star className="size-4 fill-amber-400 text-amber-400" />
              {reviewsQuery.data ? reviewsQuery.data.average.toFixed(1) : "—"}
              <span className="text-slate-400">({reviewsQuery.data?.count ?? 0} รีวิว)</span>
            </a>
            <p className="mt-5 rounded-2xl bg-violet-50 px-4 py-3 text-3xl font-bold text-violet-800">{formatMoney(product.price)} <small className="text-sm font-medium">บาท / {product.unit}</small></p>
            <p className="mt-5 whitespace-pre-line text-sm leading-7 text-slate-600">{product.description?.trim() || "สินค้าคุณภาพจากร้านค้า พร้อมจัดส่งจากสต๊อกจริง"}</p>
            <div className="mt-5 flex flex-wrap gap-3 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-3 py-2"><PackageCheck className="size-4 text-emerald-600" /> พร้อมส่ง {product.available} {product.unit}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-3 py-2"><Truck className="size-4 text-violet-600" /> จัดส่ง ฿{store.shippingFee}</span>
            </div>
            <div className="mt-auto flex flex-wrap gap-3 pt-8">
              <Link href={`/shop/${slug}#shop-products`} className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#452082] px-5 text-sm font-semibold text-white transition hover:bg-[#351565]">
                เลือกซื้อสินค้า <ArrowRight className="size-4" />
              </Link>
              {store.customerLoginEnabled && <Link href={`/shop/${slug}/account`} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <BadgeCheck className="size-4" /> บัญชีของฉัน
              </Link>}
            </div>
          </div>
        </section>

        <section id="reviews" className="mt-6 scroll-mt-24 rounded-3xl bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-violet-700">CUSTOMER VOICES</p><h2 className="mt-1 flex items-center gap-2 text-xl font-bold"><MessageCircle className="size-5 text-violet-600" /> รีวิวสินค้า</h2></div>
            <div className="text-right"><p className="text-2xl font-bold">{reviewsQuery.data?.average.toFixed(1) ?? "—"} <span className="text-amber-400">★</span></p><p className="text-xs text-slate-500">{reviewsQuery.data?.count ?? 0} รีวิวที่ยืนยันการซื้อ</p></div>
          </div>

          {store.customerLoginEnabled && (
            <div className="mt-5 rounded-2xl bg-violet-50/70 p-4 sm:p-5">
              <h3 className="font-semibold">เขียนรีวิวสินค้า</h3>
              {reviewLoginRequired ? (
                <p className="mt-2 text-sm text-slate-600">เข้าสู่ระบบด้วย LINE เพื่อค้นหารายการสินค้าที่คุณซื้อ <Link href={`/shop/${slug}/account`} className="font-semibold text-violet-700 underline">ไปที่บัญชีของฉัน</Link></p>
              ) : eligibleQuery.isPending ? (
                <p className="mt-2 text-sm text-slate-500">กำลังตรวจสอบสิทธิ์รีวิว...</p>
              ) : eligibleQuery.isError ? (
                <p role="alert" className="mt-2 text-sm text-rose-700">ตรวจสอบสิทธิ์รีวิวไม่สำเร็จ: {eligibleQuery.error.message}</p>
              ) : eligibleQuery.data?.length ? (
                <form className="mt-3 space-y-3" onSubmit={submitReview}>
                  <label className="block text-xs font-semibold text-slate-700">รายการสั่งซื้อ
                    <select required value={orderItemId} onChange={(event) => setOrderItemId(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal">
                      <option value="">เลือกรายการสินค้าที่ซื้อ</option>
                      {eligibleQuery.data.map((item) => <option key={item.orderItemId} value={item.orderItemId}>{item.orderNo} · {formatDateTime(item.orderedAt)} · {item.quantity} ชิ้น</option>)}
                    </select>
                  </label>
                  <div className="flex items-center gap-1" aria-label={`คะแนน ${rating} จาก 5`}>
                    {[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" onClick={() => setRating(value)} aria-label={`${value} ดาว`}><Star className={`size-6 ${value <= rating ? "fill-amber-400 text-amber-400" : "text-slate-300"}`} /></button>)}
                  </div>
                  <label className="block text-xs font-semibold text-slate-700">ความคิดเห็น (ไม่บังคับ)
                    <textarea maxLength={2000} rows={3} value={text} onChange={(event) => setText(event.target.value)} className="mt-1.5 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal" placeholder="บอกเล่าประสบการณ์การใช้สินค้า" />
                  </label>
                  <Button type="submit" className="rounded-xl">ส่งรีวิว</Button>
                </form>
              ) : <p className="mt-2 text-sm text-slate-600">รีวิวได้หลังชำระเงินสำหรับสินค้าที่ซื้อจากร้านนี้แล้วเท่านั้น</p>}
            </div>
          )}

          {reviewsQuery.isPending ? <p className="mt-5 text-sm text-slate-500">กำลังโหลดรีวิว...</p>
            : reviewsQuery.isError ? <p role="alert" className="mt-5 text-sm text-rose-700">โหลดรีวิวไม่สำเร็จ: {reviewsQuery.error.message}</p>
              : reviewsQuery.data.reviews.length ? <ul className="mt-5 divide-y divide-slate-100">
                {reviewsQuery.data.reviews.map((review, index) => <li key={`${review.createdAt}-${index}`} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold"><span className="grid size-8 place-items-center rounded-full bg-violet-50 text-violet-700"><BadgeCheck className="size-4" /></span>{review.reviewer}</div>
                    <time className="text-xs text-slate-400">{formatDateTime(review.createdAt)}</time>
                  </div>
                  <div className="mt-2 flex gap-0.5" aria-label={`${review.rating} ดาว`}>{[1, 2, 3, 4, 5].map((value) => <Star key={value} className={`size-3.5 ${value <= review.rating ? "fill-amber-400 text-amber-400" : "text-slate-200"}`} />)}</div>
                  {review.text && <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">{review.text}</p>}
                </li>)}
              </ul>
              : <p className="mt-5 rounded-2xl bg-slate-50 p-5 text-center text-sm text-slate-500">สินค้านี้ยังไม่มีรีวิว มาเป็นคนแรกที่รีวิวหลังซื้อสินค้าได้เลย</p>}
        </section>

        <section className="mt-6 rounded-3xl bg-white p-5 shadow-sm sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-violet-700">YOU MAY ALSO LIKE</p>
          <h2 className="mt-1 text-xl font-bold">สินค้าที่คล้ายกัน</h2>
          {similar.length ? <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {similar.map((item) => <Link key={item.id} href={`/shop/${slug}/products/${item.id}`} className="group rounded-2xl border border-slate-100 p-2 transition hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md">
              <div className="aspect-square overflow-hidden rounded-xl bg-[#f0eff5]">
                {item.imageUrl ? <div className="size-full bg-contain bg-center bg-no-repeat transition group-hover:scale-105" style={{ backgroundImage: `url("${item.imageUrl.replaceAll('"', "%22")}")` }} /> : <div className="grid size-full place-items-center text-3xl font-bold text-violet-200">{item.name.slice(0, 1)}</div>}
              </div>
              <p className="mt-2 line-clamp-2 min-h-10 text-xs font-semibold text-slate-800">{item.name}</p>
              <p className="mt-1 text-sm font-bold text-violet-700">{formatMoney(item.price)} ฿</p>
            </Link>)}
          </div> : <p className="mt-3 text-sm text-slate-500">ยังไม่มีสินค้าอื่นในหมวดหมู่นี้</p>}
        </section>
      </div>
    </main>
  );
}
