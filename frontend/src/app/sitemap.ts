import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${siteOrigin}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${siteOrigin}/pricing`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${siteOrigin}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${siteOrigin}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${siteOrigin}/data-deletion`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
