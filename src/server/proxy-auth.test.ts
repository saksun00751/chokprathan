import { describe, expect, it } from "vitest";
import { isRemovedPath } from "./proxy-auth";

// The back office moved to its own app: the member site answers 404 for its old addresses.
describe("isRemovedPath", () => {
  it("matches the old back-office and console addresses", () => {
    for (const p of ["/admin", "/admin/", "/admin/members", "/admin/login", "/console", "/console/x"]) expect(isRemovedPath(p), p).toBe(true);
  });

  it("leaves member pages and look-alike paths alone", () => {
    for (const p of ["/", "/lotto", "/login", "/administrator", "/consoles", "/account/admin"]) expect(isRemovedPath(p), p).toBe(false);
  });
});
