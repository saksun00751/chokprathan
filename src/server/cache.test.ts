import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidate, memo, setCacheEnabled } from "./cache";

const TTL = 1_000;
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A loader that answers "v1", "v2", ... and counts its calls. */
function counter() {
  let n = 0;
  const load = vi.fn(async () => `v${++n}`);
  return load;
}

describe("memo", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    setCacheEnabled(true);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves a value within its TTL without loading again", async () => {
    const load = counter();
    expect(await memo("t:fresh", TTL, load)).toBe("v1");
    vi.advanceTimersByTime(TTL - 1);
    expect(await memo("t:fresh", TTL, load)).toBe("v1");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("between TTL and the bound: answers the old value at once and refreshes once in the background", async () => {
    // The refresh is held until release(), so the old value is all there is to answer meanwhile.
    let release = () => {};
    let n = 0;
    const load = vi.fn(async () => {
      const v = `v${++n}`;
      if (n > 1) await new Promise<void>((resolve) => (release = resolve));
      return v;
    });
    await memo("t:swr", TTL, load);
    vi.advanceTimersByTime(TTL + 1);
    expect(await memo("t:swr", TTL, load)).toBe("v1");
    expect(await memo("t:swr", TTL, load)).toBe("v1");
    expect(load).toHaveBeenCalledTimes(2);
    release();
    await flush();
    expect(await memo("t:swr", TTL, load)).toBe("v2");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("older than the bound: waits for a fresh value and never answers the old one", async () => {
    const load = counter();
    await memo("t:old", TTL, load);
    vi.advanceTimersByTime(2 * TTL + 1);
    expect(await memo("t:old", TTL, load)).toBe("v2");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("older than the bound: concurrent callers share one load", async () => {
    const load = counter();
    await memo("t:share", TTL, load);
    vi.advanceTimersByTime(10 * TTL);
    const all = await Promise.all([memo("t:share", TTL, load), memo("t:share", TTL, load), memo("t:share", TTL, load)]);
    expect(all).toEqual(["v2", "v2", "v2"]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("invalidate() drops the value so the next read loads", async () => {
    const load = counter();
    await memo("t:inv", TTL, load);
    invalidate("t:inv");
    expect(await memo("t:inv", TTL, load)).toBe("v2");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("a failing background refresh does not reach the caller", async () => {
    let fail = false;
    const load = vi.fn(async () => {
      if (fail) throw new Error("db down");
      return "v1";
    });
    await memo("t:fail", TTL, load);
    fail = true;
    vi.advanceTimersByTime(TTL + 1);
    expect(await memo("t:fail", TTL, load)).toBe("v1");
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
