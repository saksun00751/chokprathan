import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { compressImage } from "./images";

const photo = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 20, g: 90, b: 160 } } })
    .jpeg()
    .toBuffer();

describe("compressImage", () => {
  test("stores a slip as WebP inside 1600×1600", async () => {
    const r = await compressImage(await photo(3200, 2000), "slip");
    if (!r.ok) throw new Error("refused");
    expect([(await sharp(r.bytes).metadata()).format, r.width, r.height]).toEqual(["webp", 1600, 1000]);
  });

  test("never enlarges, and turns a photo the way its EXIF says", async () => {
    const r = await compressImage(await sharp(await photo(400, 200)).withMetadata({ orientation: 6 }).toBuffer(), "slip");
    if (!r.ok) throw new Error("refused");
    expect([r.width, r.height]).toEqual([200, 400]);
  });

  test("refuses a file that only looks like an image", async () => {
    expect(await compressImage(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), "slip")).toEqual({ ok: false });
  });
});
