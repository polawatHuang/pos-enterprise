import { Suspense } from "react";
import { connection } from "next/server";
import { OrderTracking } from "@/components/ecommerce/storefront";

export default function ShopOrderPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
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
