import { describe, expect, test } from "vitest";
import { answered } from "./action";

describe("answered", () => {
  test("passes on what the server said", async () => {
    expect(await answered(Promise.resolve({ ok: true }))).toEqual({ ok: true });
  });
  test("is null when no answer came back, so the screen can stay as it is", async () => {
    expect(await answered(Promise.reject(new TypeError("Failed to fetch")))).toBeNull();
  });
});
