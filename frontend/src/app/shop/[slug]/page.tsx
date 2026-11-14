import { Suspense } from "react";
import { connection } from "next/server";
import { Storefront } from "@/components/ecommerce/storefront";

export default function ShopPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#faf9fc]" />}>
      <ShopPageContent params={params} />
    </Suspense>
  );
}

async function ShopPageContent({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  return <Storefront slug={slug} />;
}
