import type { MetadataRoute } from "next";
import { BRAND } from "@/config/brand";
import { LOTTO_CATALOG } from "@/server/catalog";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = BRAND.siteUrl;
  const pages = ["", "/lotto", "/results", "/payrate", "/rules", "/promotions", "/contact", "/register"];
  return [
    ...pages.map((p) => ({ url: `${base}${p}`, changeFrequency: "hourly" as const, priority: p === "" ? 1 : 0.7 })),
    ...LOTTO_CATALOG.map((l) => ({ url: `${base}/results/${l.slug}`, changeFrequency: "daily" as const, priority: 0.5 })),
  ];
}
