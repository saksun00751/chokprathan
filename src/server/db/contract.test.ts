import { describe, expect, it } from "vitest";
import { hasTestDb } from "@/test/db";
import { q1, run } from "@/server/db";
import { MIGRATIONS } from "@/server/db/migrations";

const column = (col: string) =>
  q1("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = ?", col);

const STAFF_COLUMNS = ["staff_role_id", "totp_secret", "totp_enabled", "totp_last_step", "must_change_password"];

describe.skipIf(!hasTestDb)("contract migration 9", () => {
  it("removes the staff columns and staff_roles from the member schema", async () => {
    for (const col of STAFF_COLUMNS) {
      expect(await column(col), col).toBeUndefined();
    }
    expect(await q1("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_roles'")).toBeUndefined();
  });

  it("keeps users.role and users.staff_note (the admin filters role = 'member' and writes staff_note as the member note)", async () => {
    for (const col of ["role", "staff_note"]) expect(await column(col), col).toBeTruthy();
  });

  it("migration 9 can run twice (DDL auto-commits, so a failure midway must be recoverable by re-running)", async () => {
    const m9 = MIGRATIONS.find((m) => m.version === 9);
    expect(m9).toBeDefined();
    for (const statement of m9!.statements) await run(statement);
    for (const col of STAFF_COLUMNS) expect(await column(col), col).toBeUndefined();
    for (const col of ["role", "staff_note"]) expect(await column(col), col).toBeTruthy();
  });

  it("migration 9 recovers from a half-applied state (FK, some columns and staff_roles still present)", async () => {
    // Rebuild a state a failure midway could leave: staff_roles and the FK exist, only some staff columns exist.
    await run(`CREATE TABLE staff_roles (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(60) NOT NULL,
      description VARCHAR(200) NOT NULL DEFAULT '',
      permissions TEXT NOT NULL,
      is_owner TINYINT(1) NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await run(
      "ALTER TABLE users ADD COLUMN staff_role_id INT NULL, ADD COLUMN totp_secret VARCHAR(64) NULL, ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0, ADD CONSTRAINT users_staff_role_fk FOREIGN KEY (staff_role_id) REFERENCES staff_roles (id)",
    );
    const role = await run("INSERT INTO staff_roles (name, permissions, created_at, updated_at) VALUES ('rehearsal', '[]', 0, 0)");
    const staff = await run(
      "INSERT INTO users (username, password_hash, role, staff_role_id, ref_code, created_at) VALUES ('m9-staff', 'x', 'staff', ?, 'M9STAFF', 0)",
      role.lastId,
    );

    for (const statement of MIGRATIONS.find((m) => m.version === 9)!.statements) await run(statement);

    expect(await q1("SELECT 1 FROM users WHERE id = ?", staff.lastId)).toBeUndefined();
    for (const col of STAFF_COLUMNS) expect(await column(col), col).toBeUndefined();
    for (const col of ["role", "staff_note"]) expect(await column(col), col).toBeTruthy();
    expect(await q1("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_roles'")).toBeUndefined();
    expect(
      await q1("SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'users_role_created'"),
    ).toBeTruthy();
  });
});
