import { connection } from "next/server";
import { roundLimits } from "@/server/services/risk";
import { getRound, phaseOf } from "@/server/services/rounds";
import { limitLocal } from "@/server/services/ratelimit";

/**
 * Live cut rates for a round. Public: it only reveals what the bet page already shows.
 * Every open bet page polls this, so the answer is cached for a few seconds per round.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/rounds/[roundId]/limits">) {
  await connection();
  const ip = request.headers.get(process.env.TRUST_PROXY === "1" ? "x-real-ip" : "x-forwarded-for")?.split(",").at(-1)?.trim() ?? "?";
  if (!limitLocal(`limits:${ip}`, 60, 60_000).ok) return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "30" } });
  const { roundId } = await params;
  const id = Number(roundId);
  const round = Number.isInteger(id) && id > 0 ? await getRound(id) : undefined;
  if (!round) return Response.json({ error: "not_found" }, { status: 404 });
  const now = Date.now();
  return Response.json(
    { serverNow: now, phase: phaseOf(round, now), badges: await roundLimits(id) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
