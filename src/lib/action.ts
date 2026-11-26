export type ActionResult<T = undefined> =
  | ({ ok: true; message?: string } & ([T] extends [undefined] ? { data?: undefined } : { data: T }))
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** The shape every action result shares, whatever its data. */
export type AnyActionResult = { ok: true; message?: string } | { ok: false; error: string };

/** The server's answer, or null when none came back (the connection dropped, the server restarted). */
export async function answered<T>(call: Promise<T>): Promise<T | null> {
  try {
    return await call;
  } catch {
    return null;
  }
}
