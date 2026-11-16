import { connection } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, STAFF_COOKIE, can, userFromToken } from "@/server/services/auth";
import { readImage } from "@/server/uploads";

/**
 * Uploaded images. Banners are public and immutable (names are random and never reused).
 * Transfer slips are private: only their owner and staff who review deposits may see them.
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
    // Two sessions: staff reviewing deposits (console cookie) or the member who uploaded it.
    const jar = await cookies();
    const staffToken = jar.get(STAFF_COOKIE)?.value;
    const memberToken = jar.get(SESSION_COOKIE)?.value;
    const staff = staffToken ? await userFromToken(staffToken) : null;
    const member = memberToken ? await userFromToken(memberToken) : null;
    const allowed = (staff?.role === "staff" && can(staff, "finance.view")) || (member?.role === "member" && member.id === file.ownerId);
    if (!allowed) return new Response("Not found", { status: 404 });
    headers["Cache-Control"] = "private, no-store";
  } else {
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  }
  return new Response(new Uint8Array(file.bytes), { headers });
}
