import type { MetadataRoute } from "next";
import { getPublicStoreIndex } from "@/lib/ecommerce-seo";
import { siteOrigin } from "@/lib/site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const stores = await getPublicStoreIndex();
  return [
    { url: `${siteOrigin}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${siteOrigin}/pricing`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${siteOrigin}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${siteOrigin}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${siteOrigin}/data-deletion`, changeFrequency: "yearly", priority: 0.2 },
    ...stores.flatMap((store) => [
      {
        url: `${siteOrigin}/shop/${encodeURIComponent(store.slug)}`,
        lastModified: new Date(store.updatedAt),
        changeFrequency: "daily" as const,
        priority: 0.7,
      },
      ...store.productIds.map((productId) => ({
        url: `${siteOrigin}/shop/${encodeURIComponent(store.slug)}/products/${productId}`,
        lastModified: new Date(store.updatedAt),
        changeFrequency: "weekly" as const,
        priority: 0.6,
      })),
    ]),
  ];
}
