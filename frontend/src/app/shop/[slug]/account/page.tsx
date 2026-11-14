import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { StoreAccount } from "@/components/ecommerce/store-account";
import { getPublicStoreSeoData } from "@/lib/ecommerce-seo";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const store = await getPublicStoreSeoData(slug);
  return {
    title: store ? `บัญชีของฉัน | ${store.store.name}` : "ไม่พบร้านค้า",
    robots: { index: false, follow: false },
  };
}

export default function ShopAccountPage({ params }: Props) {
  return <Suspense fallback={<div className="min-h-dvh bg-[#f7f7fb]" />}><ShopAccountContent params={params} /></Suspense>;
}

async function ShopAccountContent({ params }: Props) {
  await connection();
  const { slug } = await params;
  const store = await getPublicStoreSeoData(slug);
  if (!store) notFound();
  return <StoreAccount slug={slug} storeName={store.store.name} loginEnabled={Boolean(store.customerLoginEnabled)} />;
}
