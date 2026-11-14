import { cache } from "react";

export type PublicStoreSeoData = {
  store: { name: string; slug: string; warehouseName: string | null };
  shippingFee: number;
  paymentReady: boolean;
  customerLoginEnabled?: boolean;
  products: {
    id: number;
    sku: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    price: number;
    unit: string;
    category: string | null;
    available: number;
  }[];
};

export type PublicStoreIndexItem = { slug: string; updatedAt: string; productIds: number[] };

function publicApiOrigin() {
  const raw = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL;
  if (!raw) throw new Error("BACKEND_URL or NEXT_PUBLIC_API_URL is required for public storefront SEO");
  return new URL(raw).origin;
}

export const getPublicStoreSeoData = cache(async (slug: string): Promise<PublicStoreSeoData | null> => {
  const response = await fetch(`${publicApiOrigin()}/api/ecommerce/public/stores/${encodeURIComponent(slug)}`, {
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Could not load public storefront metadata (HTTP ${response.status})`);
  const body = await response.json() as { data: PublicStoreSeoData };
  return body.data;
});

export async function getPublicStoreIndex(): Promise<PublicStoreIndexItem[]> {
  const response = await fetch(`${publicApiOrigin()}/api/ecommerce/public/stores`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load public storefront sitemap (HTTP ${response.status})`);
  const body = await response.json() as { data: PublicStoreIndexItem[] };
  return body.data;
}
