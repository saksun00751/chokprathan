import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import sharp from "sharp";
import { THEME_CACHE_S } from "@/server/cache-ttl";
import { getBranding } from "@/server/branding";
import { readImage } from "@/server/uploads";

async function iconBase64(size: number, opaque: boolean): Promise<string | null> {
  "use cache";
  cacheTag("branding");
  cacheLife({ stale: THEME_CACHE_S, revalidate: THEME_CACHE_S, expire: 86_400 });
  try {
    const { icon } = await getBranding();
    const file = icon ? await readImage(icon) : null;
    if (!file) return null;
    const image = sharp(file.bytes).resize(size, size);
    return (await (opaque ? image.flatten({ background: "#ffffff" }) : image).png().toBuffer()).toString("base64");
  } catch {
    return null;
  }
}

/** The uploaded icon as a PNG response, or null to draw the built-in one. `opaque` for home screens, which paint transparency black. */
export async function brandIcon(size: number, opaque = false): Promise<Response | null> {
  const png = await iconBase64(size, opaque);
  return png ? new Response(new Uint8Array(Buffer.from(png, "base64")), { headers: { "Content-Type": "image/png" } }) : null;
}
