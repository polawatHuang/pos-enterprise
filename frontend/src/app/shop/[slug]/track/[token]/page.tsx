import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { OrderTracking } from "@/components/ecommerce/storefront";

type Props = { params: Promise<{ slug: string; token: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: "ติดตามคำสั่งซื้อ", robots: { index: false, follow: false, noarchive: true } };
}

export default function ShopOrderPage({ params }: Props) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#faf9fc]" />}>
      <ShopOrderPageContent params={params} />
    </Suspense>
  );
}

async function ShopOrderPageContent({ params }: { params: Promise<{ slug: string; token: string }> }) {
  await connection();
  const { slug, token } = await params;
  return <OrderTracking slug={slug} token={token} />;
}
