import "server-only";
import sharp from "sharp";

/** Every upload is stored as WebP inside 1600×1600. Slips keep more detail: staff read numbers and QR codes. */
const QUALITY = { banner: 82, slip: 85 } as const;
/** More pixels than this is refused before decoding (a small file can hide a huge picture). */
const MAX_PIXELS = 40_000_000;

export type Compressed = { ok: true; bytes: Buffer; width: number; height: number } | { ok: false };

/** Resize and re-encode an uploaded image. Metadata is dropped; the first frame of an animation is kept. */
export async function compressImage(input: Uint8Array, profile: keyof typeof QUALITY): Promise<Compressed> {
  try {
    const { data, info } = await sharp(input, { limitInputPixels: MAX_PIXELS })
      .autoOrient()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: QUALITY[profile], alphaQuality: 100 })
      .toBuffer({ resolveWithObject: true });
    return { ok: true, bytes: data, width: info.width, height: info.height };
  } catch {
    return { ok: false };
  }
}
