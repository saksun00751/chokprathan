import { connection } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, userFromToken } from "@/server/services/auth";
import { readImage } from "@/server/uploads";

/**
 * Uploaded images. Banners are public and immutable (names are random and never reused).
 * Transfer slips are private: only the member who uploaded one may see it here (staff review them in
 * the back-office app, which serves its own copy of this route).
 */
export async function GET(_request: Request, { params }: RouteContext<"/media/[name]">) {
  await connection();
  const { name } = await params;
  const file = await readImage(name);
  if (!file) return new Response("Not found", { status: 404 });
  const headers: Record<string, string> = {
    "Content-Type": file.type,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
  };
  if (file.kind === "slip") {
    const memberToken = (await cookies()).get(SESSION_COOKIE)?.value;
    const member = memberToken ? await userFromToken(memberToken) : null;
    const allowed = member?.role === "member" && member.id === file.ownerId;
    if (!allowed) return new Response("Not found", { status: 404 });
    headers["Cache-Control"] = "private, no-store";
  } else {
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  }
  return new Response(new Uint8Array(file.bytes), { headers });
}
