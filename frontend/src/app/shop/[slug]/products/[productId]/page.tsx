import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { ProductDetail } from "@/components/ecommerce/product-detail";
import { getPublicStoreSeoData } from "@/lib/ecommerce-seo";
import { siteOrigin } from "@/lib/site";

type Props = { params: Promise<{ slug: string; productId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, productId } = await params;
  const store = await getPublicStoreSeoData(slug);
  const product = store?.products.find((item) => item.id === Number(productId));
  if (!store || !product) return { title: "ไม่พบสินค้า", robots: { index: false, follow: false } };
  const canonical = `${siteOrigin}/shop/${encodeURIComponent(slug)}/products/${product.id}`;
  const description = product.description?.trim().slice(0, 300)
    || `เลือกซื้อ ${product.name} จาก ${store.store.name} สินค้าพร้อมส่งจากสต๊อกจริง`;
  const image = product.imageUrl || `${siteOrigin}/shop/${encodeURIComponent(slug)}/opengraph-image`;
  return {
    title: `${product.name} | ${store.store.name}`,
    description,
    keywords: [product.name, `${product.name} ราคา`, `${product.name} รีวิว`, store.store.name, "ซื้อสินค้าออนไลน์"],
    alternates: { canonical },
    openGraph: {
      type: "website",
      locale: "th_TH",
      siteName: store.store.name,
      title: `${product.name} | ${store.store.name}`,
      description,
      url: canonical,
      images: [{ url: image, alt: product.name }],
    },
    twitter: { card: "summary_large_image", title: product.name, description, images: [image] },
  };
}

export default function ShopProductPage({ params }: Props) {
  return <Suspense fallback={<div className="min-h-dvh bg-[#f7f7fb]" />}><ShopProductContent params={params} /></Suspense>;
}

async function ShopProductContent({ params }: Props) {
  await connection();
  const { slug, productId } = await params;
  if (!/^\d+$/.test(productId)) notFound();
  const store = await getPublicStoreSeoData(slug);
  const product = store?.products.find((item) => item.id === Number(productId));
  if (!store || !product) notFound();

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description || undefined,
    image: product.imageUrl || undefined,
    sku: product.sku,
    offers: {
      "@type": "Offer",
      priceCurrency: "THB",
      price: product.price.toFixed(2),
      availability: product.available > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: `${siteOrigin}/shop/${encodeURIComponent(slug)}/products/${product.id}`,
    },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
      <ProductDetail slug={slug} store={store} product={product} />
    </>
  );
}
