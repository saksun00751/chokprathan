import { ImageResponse } from "next/og";
import { brandIcon } from "@/server/brand-icon";
import { IconArt } from "./icon-art";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  return (await brandIcon(180, true)) ?? new ImageResponse(<IconArt size={180} padding={0.18} />, size);
}
