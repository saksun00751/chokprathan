import type { MetadataRoute } from "next";
import { BRAND } from "@/config/brand";
import { pickText } from "@/domain/branding";
import { getBranding } from "@/server/branding";

/** Colors are sRGB equivalents of the canvas/brand OKLCH tokens (launchers don't parse OKLCH). */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const b = await getBranding();
  return {
    name: pickText(b.name, "th") ?? BRAND.name,
    short_name: pickText(b.name, "th") ?? BRAND.shortName,
    description: pickText(b.description, "th") ?? BRAND.description,
    lang: "th",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f6f9",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon/small", sizes: "192x192", type: "image/png" },
      { src: "/icon/large", sizes: "512x512", type: "image/png" },
      { src: "/icon/large", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
