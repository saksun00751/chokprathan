import { ImageResponse } from "next/og";
import { brandIcon } from "@/server/brand-icon";
import { IconArt } from "./icon-art";

export const contentType = "image/png";

export function generateImageMetadata() {
  return [
    { id: "small", size: { width: 192, height: 192 }, contentType },
    { id: "large", size: { width: 512, height: 512 }, contentType },
  ];
}

export default async function Icon({ id }: { id: Promise<string> }) {
  const size = (await id) === "small" ? 192 : 512;
  return (await brandIcon(size)) ?? new ImageResponse(<IconArt size={size} />, { width: size, height: size });
}
