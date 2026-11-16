import type { MetadataRoute } from "next";
import { BRAND } from "@/config/brand";

/** Colors are sRGB equivalents of the canvas/brand OKLCH tokens (launchers don't parse OKLCH). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.shortName,
    description: BRAND.description,
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
