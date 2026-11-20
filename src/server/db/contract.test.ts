import { describe, expect, it } from "vitest";
import { hasTestDb } from "@/test/db";
import { q1 } from "@/server/db";

const column = (col: string) =>
  q1("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = ?", col);

describe.skipIf(!hasTestDb)("contract migration 9", () => {
  it("removes the staff columns and staff_roles from the member schema", async () => {
    for (const col of ["staff_role_id", "totp_secret", "totp_enabled", "totp_last_step", "must_change_password"]) {
      expect(await column(col), col).toBeUndefined();
    }
    expect(await q1("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_roles'")).toBeUndefined();
  });

  it("keeps users.role and users.staff_note (the admin filters role = 'member' and writes staff_note as the member note)", async () => {
    for (const col of ["role", "staff_note"]) expect(await column(col), col).toBeTruthy();
  });
});
