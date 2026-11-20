import { connection } from "next/server";
import { q1 } from "@/server/db";

/**
 * For uptime monitors and container health checks. Reveals nothing beyond up or down. `scheduler`
 * is this app's own scheduler (heartbeat row `member_scheduler`); rounds and payouts are watched
 * through the back-office app's health check.
 */
export async function GET() {
  await connection();
  try {
    await q1("SELECT 1 AS ok");
    const sched = await q1<{ updated_at: number }>("SELECT updated_at FROM system_status WHERE name = 'member_scheduler'");
    const schedulerOk = !!sched && Date.now() - sched.updated_at < 120_000;
    return Response.json({ ok: true, db: "up", scheduler: schedulerOk ? "ok" : "stale" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false, db: "down" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
