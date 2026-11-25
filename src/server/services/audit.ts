import "server-only";
import { json, run } from "@/server/db";
import { clientInfo } from "@/server/request";

/**
 * Staff audit trail. Each row records who, what, the target, the detail (edits store
 * `{ before, after }`), the IP address and the browser. Only the writer lives here: sealing the rows
 * into a hash chain, the MongoDB copy and verification are run by the back-office app's scheduler.
 */
export async function audit(actorId: number | null, action: string, target: string | null, detail?: unknown, now = Date.now(), ip: string | null = null) {
  // Outside a request (scheduler, scripts) there are no headers: record what is known.
  const client = await clientInfo().catch(() => null);
  await run(
    "INSERT INTO audit_log (actor_id, action, target, detail, ip, ua, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    actorId,
    action.slice(0, 40),
    target?.slice(0, 60) ?? null,
    detail === undefined ? null : json.str(detail),
    ip ?? client?.ip ?? null,
    client?.userAgent?.slice(0, 255) ?? null,
    now,
  );
}

/** Only the fields that changed, as `{ before, after }`, for edit logs. */
export function changes<T extends Record<string, unknown>>(before: T, after: Partial<T>): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return { before: b, after: a };
}
