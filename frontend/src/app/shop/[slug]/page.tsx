import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Storefront } from "@/components/ecommerce/storefront";
import { getPublicStoreSeoData } from "@/lib/ecommerce-seo";
import { siteOrigin } from "@/lib/site";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPublicStoreSeoData(slug);
  if (!data) {
    return { title: "ไม่พบหน้าร้าน", robots: { index: false, follow: false } };
  }

  const { name } = data.store;
  const { products } = data;
  const categories = [...new Set(products.map((product) => product.category).filter((category): category is string => Boolean(category)))];
  const description = [
    `เลือกซื้อสินค้าออนไลน์จาก ${name} ดูสินค้า${products.length ? ` ${products.length} รายการ` : ""}`,
    categories.length ? ` เช่น ${categories.slice(0, 4).join(", ")}` : "",
    ` จัดส่งทั่วไทย ค่าจัดส่ง ${data.shippingFee} บาท ชำระผ่าน QR PromptPay`,
  ].join("");
  const title = `${name} | ร้านค้าออนไลน์`;
  const canonical = `${siteOrigin}/shop/${encodeURIComponent(slug)}`;
  const image = `${canonical}/opengraph-image`;
  const keywords = [...new Set([
    `${name} ร้านค้าออนไลน์`,
    `ซื้อสินค้า ${name}`,
    "ร้านค้าออนไลน์",
    "สั่งซื้อสินค้าออนไลน์",
    "ช้อปปิ้งออนไลน์",
    ...categories.slice(0, 8),
    ...products.slice(0, 12).map((product) => product.name),
  ])];

  return {
    title,
    description,
    keywords,
    alternates: { canonical },
    applicationName: name,
    openGraph: {
      type: "website",
      locale: "th_TH",
      siteName: name,
      title,
      description,
      url: canonical,
      images: [{ url: image, width: 1200, height: 630, alt: `${name} — ร้านค้าออนไลน์` }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
    robots: {
      index: products.length > 0,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
    },
  };
}

export default function ShopPage({ params }: Props) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#faf9fc]" />}>
      <ShopPageContent params={params} />
    </Suspense>
  );
}

async function ShopPageContent({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const storeData = await getPublicStoreSeoData(slug);
  if (!storeData) notFound();

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    name: storeData.store.name,
    url: `${siteOrigin}/shop/${encodeURIComponent(slug)}`,
    image: `${siteOrigin}/shop/${encodeURIComponent(slug)}/opengraph-image`,
    description: `ร้านค้าออนไลน์ ${storeData.store.name} จัดส่งทั่วไทย ค่าจัดส่ง ${storeData.shippingFee} บาท`,
    inLanguage: "th-TH",
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: `สินค้า ${storeData.store.name}`,
      itemListElement: storeData.products.slice(0, 50).map((product, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
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
            url: `${siteOrigin}/shop/${encodeURIComponent(slug)}`,
          },
        },
      })),
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
      <Storefront slug={slug} initialData={storeData} />
    </>
  );
}
