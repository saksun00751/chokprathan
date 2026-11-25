/**
 * Schema migrations for MariaDB 10.5+. Append only: never edit an entry that has shipped.
 * Each migration is a list of statements; `schema_migrations` records which have run.
 * DDL auto-commits in MariaDB, so every statement is written to be safe to re-run.
 * Money columns are integer satang unless the name says otherwise. Times are epoch ms.
 */
import { BANNER_I18N, PROMO_I18N } from "./content-i18n";

export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

const T = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "core schema",
    statements: [
      `CREATE TABLE IF NOT EXISTS settings (
        \`key\` VARCHAR(64) NOT NULL PRIMARY KEY,
        \`value\` MEDIUMTEXT NOT NULL,
        updated_at BIGINT NOT NULL DEFAULT 0
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS staff_roles (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(60) NOT NULL,
        description VARCHAR(200) NOT NULL DEFAULT '',
        permissions TEXT NOT NULL,
        is_owner TINYINT(1) NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        UNIQUE KEY staff_roles_name (name)
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS users (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        phone VARCHAR(15) NULL,
        username VARCHAR(40) NULL,
        password_hash VARCHAR(200) NOT NULL,
        name VARCHAR(100) NOT NULL DEFAULT '',
        role ENUM('member','staff') NOT NULL DEFAULT 'member',
        staff_role_id INT NULL,
        status ENUM('active','suspended') NOT NULL DEFAULT 'active',
        bank_code VARCHAR(20) NULL,
        bank_account VARCHAR(20) NULL,
        bank_name VARCHAR(100) NULL,
        ref_code VARCHAR(12) NOT NULL,
        upline1_id INT NULL,
        upline2_id INT NULL,
        balance BIGINT NOT NULL DEFAULT 0,
        cashback_balance BIGINT NOT NULL DEFAULT 0,
        affiliate_balance BIGINT NOT NULL DEFAULT 0,
        turnover_required BIGINT NOT NULL DEFAULT 0,
        is_simulated TINYINT(1) NOT NULL DEFAULT 0,
        totp_secret VARCHAR(64) NULL,
        totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
        totp_last_step BIGINT NULL,
        must_change_password TINYINT(1) NOT NULL DEFAULT 0,
        staff_note VARCHAR(255) NULL,
        created_at BIGINT NOT NULL,
        last_login_at BIGINT NULL,
        last_ip VARCHAR(45) NULL,
        first_deposit_at BIGINT NULL,
        UNIQUE KEY users_phone (phone),
        UNIQUE KEY users_username (username),
        UNIQUE KEY users_ref (ref_code),
        UNIQUE KEY users_bank (bank_code, bank_account),
        KEY users_upline1 (upline1_id),
        KEY users_upline2 (upline2_id),
        KEY users_role_created (role, created_at),
        KEY users_first_deposit (first_deposit_at),
        CONSTRAINT users_balance_ok CHECK (balance >= 0),
        CONSTRAINT users_cashback_ok CHECK (cashback_balance >= 0),
        CONSTRAINT users_affiliate_ok CHECK (affiliate_balance >= 0),
        CONSTRAINT users_upline1_fk FOREIGN KEY (upline1_id) REFERENCES users (id),
        CONSTRAINT users_upline2_fk FOREIGN KEY (upline2_id) REFERENCES users (id),
        CONSTRAINT users_staff_role_fk FOREIGN KEY (staff_role_id) REFERENCES staff_roles (id)
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS sessions (
        token_hash CHAR(64) NOT NULL PRIMARY KEY,
        user_id INT NOT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        last_seen_at BIGINT NOT NULL,
        ip VARCHAR(45) NULL,
        user_agent VARCHAR(255) NULL,
        KEY sessions_user (user_id),
        KEY sessions_expires (expires_at),
        CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS login_challenges (
        token_hash CHAR(64) NOT NULL PRIMARY KEY,
        user_id INT NOT NULL,
        next_path VARCHAR(200) NOT NULL DEFAULT '/',
        attempts INT NOT NULL DEFAULT 0,
        expires_at BIGINT NOT NULL,
        KEY login_challenges_expires (expires_at),
        CONSTRAINT login_challenges_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS login_attempts (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        identifier VARCHAR(100) NOT NULL,
        ip VARCHAR(45) NULL,
        at BIGINT NOT NULL,
        KEY login_attempts_ident (identifier, at),
        KEY login_attempts_ip (ip, at)
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS auth_log (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT NULL,
        identifier VARCHAR(100) NULL,
        event VARCHAR(30) NOT NULL,
        ip VARCHAR(45) NULL,
        user_agent VARCHAR(255) NULL,
        created_at BIGINT NOT NULL,
        KEY auth_log_user (user_id, created_at),
        KEY auth_log_created (created_at)
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS otps (
        phone VARCHAR(15) NOT NULL,
        purpose VARCHAR(16) NOT NULL,
        code_hash CHAR(64) NOT NULL,
        expires_at BIGINT NOT NULL,
        attempts INT NOT NULL DEFAULT 0,
        sent_at BIGINT NOT NULL,
        verified_at BIGINT NULL,
        PRIMARY KEY (phone, purpose)
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS rate_limits (
        bucket VARCHAR(120) NOT NULL,
        window_start BIGINT NOT NULL,
        hits INT NOT NULL DEFAULT 0,
        PRIMARY KEY (bucket, window_start),
        KEY rate_limits_window (window_start)
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS lottos (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        slug VARCHAR(40) NOT NULL,
        name VARCHAR(80) NOT NULL,
        short_name VARCHAR(40) NOT NULL,
        grp ENUM('thai','foreign','stock','yiki') NOT NULL,
        format ENUM('standard','thai_gov','laos4') NOT NULL,
        schedule TEXT NOT NULL,
        result_delay_min INT NOT NULL DEFAULT 20,
        auto_result TINYINT(1) NOT NULL DEFAULT 0,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        sort INT NOT NULL DEFAULT 0,
        flag VARCHAR(4) NULL,
        rates TEXT NOT NULL,
        limits TEXT NOT NULL,
        risk TEXT NOT NULL,
        updated_at BIGINT NOT NULL DEFAULT 0,
        UNIQUE KEY lottos_slug (slug)
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS rounds (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        lotto_id INT NOT NULL,
        round_no INT NULL,
        day_key CHAR(10) NOT NULL,
        opens_at BIGINT NOT NULL,
        closes_at BIGINT NOT NULL,
        draw_at BIGINT NOT NULL,
        status ENUM('scheduled','resulted','cancelled') NOT NULL DEFAULT 'scheduled',
        result TEXT NULL,
        resulted_at BIGINT NULL,
        resulted_by INT NULL,
        settled_at BIGINT NULL,
        UNIQUE KEY rounds_lotto_close (lotto_id, closes_at),
        KEY rounds_status_close (status, closes_at),
        KEY rounds_status_draw (status, draw_at),
        KEY rounds_lotto_status (lotto_id, status, closes_at),
        KEY rounds_day (day_key),
        KEY rounds_unsettled (status, settled_at),
        CONSTRAINT rounds_lotto_fk FOREIGN KEY (lotto_id) REFERENCES lottos (id)
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS bills (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(12) NOT NULL,
        user_id INT NOT NULL,
        round_id INT NOT NULL,
        total_stake BIGINT NOT NULL,
        total_payout BIGINT NOT NULL DEFAULT 0,
        status ENUM('pending','won','lost','cancelled','refunded') NOT NULL DEFAULT 'pending',
        note VARCHAR(255) NULL,
        created_at BIGINT NOT NULL,
        settled_at BIGINT NULL,
        UNIQUE KEY bills_code (code),
        KEY bills_user (user_id, created_at),
        KEY bills_round (round_id, status),
        KEY bills_created (created_at),
        KEY bills_settled (settled_at),
        KEY bills_status (status, created_at),
        CONSTRAINT bills_user_fk FOREIGN KEY (user_id) REFERENCES users (id),
        CONSTRAINT bills_round_fk FOREIGN KEY (round_id) REFERENCES rounds (id)
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS bill_items (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        bill_id BIGINT NOT NULL,
        round_id INT NOT NULL,
        bet_type VARCHAR(10) NOT NULL,
        number VARCHAR(4) NOT NULL,
        stake INT NOT NULL,
        segments TEXT NOT NULL,
        rate100 INT NOT NULL,
        potential BIGINT NOT NULL,
        status ENUM('pending','won','lost','cancelled','refunded') NOT NULL DEFAULT 'pending',
        payout BIGINT NOT NULL DEFAULT 0,
        KEY bill_items_bill (bill_id),
        KEY bill_items_round (round_id, status),
        KEY bill_items_number (round_id, bet_type, number),
        CONSTRAINT bill_items_bill_fk FOREIGN KEY (bill_id) REFERENCES bills (id) ON DELETE CASCADE
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS exposures (
        round_id INT NOT NULL,
        bet_type VARCHAR(10) NOT NULL,
        number VARCHAR(4) NOT NULL,
        total_stake BIGINT NOT NULL DEFAULT 0,
        potential BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (round_id, bet_type, number),
        KEY exposures_potential (round_id, potential)
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS manual_limits (
        round_id INT NOT NULL,
        bet_type VARCHAR(10) NOT NULL,
        number VARCHAR(4) NOT NULL,
        kind ENUM('percent','closed') NOT NULL,
        percent INT NULL,
        created_at BIGINT NOT NULL,
        created_by INT NULL,
        PRIMARY KEY (round_id, bet_type, number)
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS transactions (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        wallet ENUM('balance','cashback','affiliate') NOT NULL,
        type VARCHAR(20) NOT NULL,
        amount BIGINT NOT NULL,
        balance_after BIGINT NOT NULL,
        ref VARCHAR(40) NULL,
        note VARCHAR(255) NULL,
        actor_id INT NULL,
        created_at BIGINT NOT NULL,
        KEY tx_user (user_id, created_at),
        KEY tx_type (type, created_at),
        KEY tx_created (created_at),
        CONSTRAINT tx_user_fk FOREIGN KEY (user_id) REFERENCES users (id)
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS deposits (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        amount BIGINT NOT NULL,
        bonus BIGINT NOT NULL DEFAULT 0,
        promotion_id INT NULL,
        status ENUM('awaiting','pending','approved','rejected','expired') NOT NULL DEFAULT 'awaiting',
        to_bank TEXT NULL,
        slip VARCHAR(60) NULL,
        note VARCHAR(255) NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        confirmed_at BIGINT NULL,
        reviewed_at BIGINT NULL,
        reviewed_by INT NULL,
        KEY deposits_status (status, created_at),
        KEY deposits_user (user_id, created_at),
        KEY deposits_reviewed (status, reviewed_at),
        KEY deposits_amount (amount, status),
        CONSTRAINT deposits_user_fk FOREIGN KEY (user_id) REFERENCES users (id)
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS withdrawals (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        amount BIGINT NOT NULL,
        bank_code VARCHAR(20) NOT NULL,
        bank_account VARCHAR(20) NOT NULL,
        bank_name VARCHAR(100) NOT NULL,
        status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
        note VARCHAR(255) NULL,
        created_at BIGINT NOT NULL,
        reviewed_at BIGINT NULL,
        reviewed_by INT NULL,
        KEY withdrawals_status (status, created_at),
        KEY withdrawals_user (user_id, created_at),
        KEY withdrawals_reviewed (status, reviewed_at),
        CONSTRAINT withdrawals_user_fk FOREIGN KEY (user_id) REFERENCES users (id)
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS promotions (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(80) NOT NULL,
        summary VARCHAR(200) NOT NULL,
        details TEXT NOT NULL,
        bonus_percent INT NOT NULL DEFAULT 0,
        max_bonus BIGINT NOT NULL DEFAULT 0,
        min_deposit BIGINT NOT NULL DEFAULT 0,
        turnover_x INT NOT NULL DEFAULT 0,
        once_per_user TINYINT(1) NOT NULL DEFAULT 1,
        active TINYINT(1) NOT NULL DEFAULT 1,
        sort INT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS promotion_claims (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        promotion_id INT NOT NULL,
        user_id INT NOT NULL,
        deposit_id INT NULL,
        bonus BIGINT NOT NULL,
        created_at BIGINT NOT NULL,
        UNIQUE KEY promotion_claims_deposit (deposit_id),
        KEY promotion_claims_user (user_id, promotion_id),
        KEY promotion_claims_created (created_at),
        CONSTRAINT promotion_claims_promo_fk FOREIGN KEY (promotion_id) REFERENCES promotions (id),
        CONSTRAINT promotion_claims_user_fk FOREIGN KEY (user_id) REFERENCES users (id)
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS vouchers (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(20) NOT NULL,
        value BIGINT NOT NULL,
        max_uses INT NOT NULL DEFAULT 1,
        used INT NOT NULL DEFAULT 0,
        expires_at BIGINT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        note VARCHAR(80) NULL,
        created_by INT NULL,
        created_at BIGINT NOT NULL,
        UNIQUE KEY vouchers_code (code)
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS voucher_redemptions (
        voucher_id INT NOT NULL,
        user_id INT NOT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (voucher_id, user_id),
        KEY voucher_redemptions_created (created_at),
        CONSTRAINT voucher_redemptions_voucher_fk FOREIGN KEY (voucher_id) REFERENCES vouchers (id),
        CONSTRAINT voucher_redemptions_user_fk FOREIGN KEY (user_id) REFERENCES users (id)
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS number_sets (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        name VARCHAR(40) NOT NULL,
        items TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        KEY number_sets_user (user_id),
        CONSTRAINT number_sets_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS news (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(120) NOT NULL,
        body TEXT NOT NULL,
        pinned TINYINT(1) NOT NULL DEFAULT 0,
        published TINYINT(1) NOT NULL DEFAULT 1,
        created_at BIGINT NOT NULL,
        KEY news_list (published, pinned, created_at)
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS games (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        category ENUM('casino','slot','sport') NOT NULL,
        provider VARCHAR(60) NOT NULL,
        name VARCHAR(80) NOT NULL,
        tag VARCHAR(20) NULL,
        hue INT NOT NULL DEFAULT 282,
        sort INT NOT NULL DEFAULT 0,
        enabled TINYINT(1) NOT NULL DEFAULT 1
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS ref_clicks (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        at BIGINT NOT NULL,
        KEY ref_clicks_user (user_id, at),
        CONSTRAINT ref_clicks_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS audit_log (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        actor_id INT NULL,
        action VARCHAR(40) NOT NULL,
        target VARCHAR(60) NULL,
        detail TEXT NULL,
        ip VARCHAR(45) NULL,
        created_at BIGINT NOT NULL,
        KEY audit_created (created_at),
        KEY audit_actor (actor_id, created_at),
        KEY audit_action (action, created_at)
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS banners (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        tag VARCHAR(24) NOT NULL DEFAULT '',
        title VARCHAR(80) NOT NULL,
        subtitle VARCHAR(140) NOT NULL DEFAULT '',
        cta_label VARCHAR(30) NOT NULL DEFAULT '',
        cta_href VARCHAR(255) NOT NULL DEFAULT '/',
        art VARCHAR(20) NOT NULL DEFAULT 'gift',
        tone ENUM('violet','gold','red','night') NOT NULL DEFAULT 'violet',
        image VARCHAR(60) NULL,
        show_text TINYINT(1) NOT NULL DEFAULT 1,
        active TINYINT(1) NOT NULL DEFAULT 1,
        sort INT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS media (
        name VARCHAR(60) NOT NULL PRIMARY KEY,
        kind ENUM('banner','slip') NOT NULL,
        mime VARCHAR(30) NOT NULL,
        size INT NOT NULL,
        bytes MEDIUMBLOB NOT NULL,
        owner_id INT NULL,
        created_at BIGINT NOT NULL,
        KEY media_kind (kind, created_at)
      ) ${T}`,

      `CREATE TABLE IF NOT EXISTS system_status (
        name VARCHAR(40) NOT NULL PRIMARY KEY,
        \`value\` TEXT NOT NULL,
        updated_at BIGINT NOT NULL
      ) ${T}`,
    ],
  },
  {
    version: 2,
    name: "translatable content",
    statements: [
      // Per-language overrides: {"en": {...}, "lo": {...}}. The Thai columns stay the fallback.
      "ALTER TABLE banners ADD COLUMN IF NOT EXISTS i18n TEXT NULL",
      "ALTER TABLE promotions ADD COLUMN IF NOT EXISTS i18n TEXT NULL",
      "ALTER TABLE news ADD COLUMN IF NOT EXISTS i18n TEXT NULL",
      // Installs made before this migration get translations for the default banners and promotions.
      ...Object.entries(BANNER_I18N).map(
        ([title, tr]) => `UPDATE banners SET i18n = ${sqlText(JSON.stringify(tr))} WHERE i18n IS NULL AND title = ${sqlText(title)}`,
      ),
      ...Object.entries(PROMO_I18N).map(
        ([title, tr]) => `UPDATE promotions SET i18n = ${sqlText(JSON.stringify(tr))} WHERE i18n IS NULL AND title = ${sqlText(title)}`,
      ),
    ],
  },
  {
    version: 3,
    name: "back-office controls",
    statements: [
      // Members can be closed (never deleted: their money history stays).
      "ALTER TABLE users MODIFY status ENUM('active','suspended','closed') NOT NULL DEFAULT 'active'",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS closed_at BIGINT NULL, ADD COLUMN IF NOT EXISTS closed_by INT NULL, ADD COLUMN IF NOT EXISTS close_reason VARCHAR(255) NULL",
      // Tamper-evident audit: the scheduler seals rows into a hash chain (seq, prev_hash, hash).
      "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ua VARCHAR(255) NULL, ADD COLUMN IF NOT EXISTS seq BIGINT NULL, ADD COLUMN IF NOT EXISTS prev_hash CHAR(64) NULL, ADD COLUMN IF NOT EXISTS hash CHAR(64) NULL, MODIFY detail MEDIUMTEXT NULL",
      "ALTER TABLE audit_log ADD UNIQUE INDEX IF NOT EXISTS audit_seq (seq)",
      // The website's own bank accounts and every change to their balances.
      `CREATE TABLE IF NOT EXISTS bank_accounts (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        kind ENUM('deposit','withdraw') NOT NULL,
        bank_code VARCHAR(20) NOT NULL,
        account_no VARCHAR(20) NOT NULL,
        account_name VARCHAR(100) NOT NULL,
        balance BIGINT NOT NULL DEFAULT 0,
        active TINYINT NOT NULL DEFAULT 1,
        sort INT NOT NULL DEFAULT 0,
        note VARCHAR(255) NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        archived_at BIGINT NULL,
        archived_by INT NULL,
        KEY bank_accounts_kind (kind, archived_at, active, sort)
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS bank_account_moves (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        account_id INT NOT NULL,
        amount BIGINT NOT NULL,
        balance_after BIGINT NOT NULL,
        kind ENUM('deposit','withdrawal','adjust') NOT NULL,
        ref VARCHAR(40) NULL,
        note VARCHAR(255) NULL,
        actor_id INT NULL,
        created_at BIGINT NOT NULL,
        KEY bank_moves_account (account_id, id),
        KEY bank_moves_created (created_at),
        CONSTRAINT bank_moves_account_fk FOREIGN KEY (account_id) REFERENCES bank_accounts (id)
      ) ${T}`,
      "ALTER TABLE deposits ADD COLUMN IF NOT EXISTS bank_account_id INT NULL, ADD INDEX IF NOT EXISTS deposits_bank (bank_account_id, status)",
      "ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS paid_from_id INT NULL, ADD INDEX IF NOT EXISTS withdrawals_paid_from (paid_from_id)",
      // Receiving accounts used to live in settings.wallet; they move to bank_accounts.
      `INSERT INTO bank_accounts (kind, bank_code, account_no, account_name, created_at, updated_at, sort)
       SELECT 'deposit', JSON_UNQUOTE(JSON_EXTRACT(s.\`value\`, '$.receivingAccounts[0].bank')), JSON_UNQUOTE(JSON_EXTRACT(s.\`value\`, '$.receivingAccounts[0].account')),
              JSON_UNQUOTE(JSON_EXTRACT(s.\`value\`, '$.receivingAccounts[0].name')), UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000, 0
       FROM settings s WHERE s.\`key\` = 'wallet' AND JSON_EXTRACT(s.\`value\`, '$.receivingAccounts[0].account') IS NOT NULL`,
      `INSERT INTO bank_accounts (kind, bank_code, account_no, account_name, created_at, updated_at, sort)
       SELECT 'deposit', JSON_UNQUOTE(JSON_EXTRACT(s.\`value\`, '$.receivingAccounts[1].bank')), JSON_UNQUOTE(JSON_EXTRACT(s.\`value\`, '$.receivingAccounts[1].account')),
              JSON_UNQUOTE(JSON_EXTRACT(s.\`value\`, '$.receivingAccounts[1].name')), UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000, 1
       FROM settings s WHERE s.\`key\` = 'wallet' AND JSON_EXTRACT(s.\`value\`, '$.receivingAccounts[1].account') IS NOT NULL`,
      `INSERT INTO bank_accounts (kind, bank_code, account_no, account_name, created_at, updated_at, sort)
       SELECT 'deposit', JSON_UNQUOTE(JSON_EXTRACT(s.\`value\`, '$.receivingAccounts[2].bank')), JSON_UNQUOTE(JSON_EXTRACT(s.\`value\`, '$.receivingAccounts[2].account')),
              JSON_UNQUOTE(JSON_EXTRACT(s.\`value\`, '$.receivingAccounts[2].name')), UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000, 2
       FROM settings s WHERE s.\`key\` = 'wallet' AND JSON_EXTRACT(s.\`value\`, '$.receivingAccounts[2].account') IS NOT NULL`,
      `INSERT INTO bank_accounts (kind, bank_code, account_no, account_name, created_at, updated_at, sort)
       SELECT 'deposit', JSON_UNQUOTE(JSON_EXTRACT(s.\`value\`, '$.receivingAccounts[3].bank')), JSON_UNQUOTE(JSON_EXTRACT(s.\`value\`, '$.receivingAccounts[3].account')),
              JSON_UNQUOTE(JSON_EXTRACT(s.\`value\`, '$.receivingAccounts[3].name')), UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000, 3
       FROM settings s WHERE s.\`key\` = 'wallet' AND JSON_EXTRACT(s.\`value\`, '$.receivingAccounts[3].account') IS NOT NULL`,
      `INSERT INTO bank_accounts (kind, bank_code, account_no, account_name, created_at, updated_at, sort)
       SELECT 'deposit', JSON_UNQUOTE(JSON_EXTRACT(s.\`value\`, '$.receivingAccounts[4].bank')), JSON_UNQUOTE(JSON_EXTRACT(s.\`value\`, '$.receivingAccounts[4].account')),
              JSON_UNQUOTE(JSON_EXTRACT(s.\`value\`, '$.receivingAccounts[4].name')), UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000, 4
       FROM settings s WHERE s.\`key\` = 'wallet' AND JSON_EXTRACT(s.\`value\`, '$.receivingAccounts[4].account') IS NOT NULL`,
    ],
  },
  {
    version: 4,
    name: "one session per account",
    statements: [
      // Signing in on a new device ends the other sessions of that account. Why each one ended is
      // kept for a while so the device that lost it can say so ("signed in on another device").
      `CREATE TABLE IF NOT EXISTS session_ends (
        token_hash CHAR(64) NOT NULL PRIMARY KEY,
        user_id INT NOT NULL,
        reason VARCHAR(20) NOT NULL,
        ended_at BIGINT NOT NULL,
        by_ip VARCHAR(45) NULL,
        KEY session_ends_at (ended_at),
        KEY session_ends_user (user_id)
      ) ${T}`,
    ],
  },
  {
    version: 5,
    name: "loyalty points",
    statements: [
      // Each member's point balance, kept apart from users so the money tables stay untouched.
      `CREATE TABLE IF NOT EXISTS member_points (
        user_id INT NOT NULL PRIMARY KEY,
        points BIGINT NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL,
        CONSTRAINT member_points_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ${T}`,
      // Every change to a balance: earned on a deposit or a staff top-up, or added/deducted by staff.
      `CREATE TABLE IF NOT EXISTS point_moves (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        amount BIGINT NOT NULL,
        balance_after BIGINT NOT NULL,
        kind VARCHAR(20) NOT NULL,
        ref VARCHAR(40) NULL,
        note VARCHAR(255) NULL,
        actor_id INT NULL,
        created_at BIGINT NOT NULL,
        KEY point_moves_user (user_id, id),
        KEY point_moves_created (created_at)
      ) ${T}`,
    ],
  },
  {
    version: 6,
    name: "member blocklist",
    statements: [
      // Blocked bank accounts (bank_code NULL = at any bank), phones, and names, stored normalized
      // (src/domain/blocklist.ts). Lifting a block keeps the row with who lifted it and why.
      `CREATE TABLE IF NOT EXISTS blocklist (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        kind VARCHAR(10) NOT NULL,
        bank_code VARCHAR(20) NULL,
        value VARCHAR(130) NOT NULL,
        display VARCHAR(160) NOT NULL,
        reason VARCHAR(255) NOT NULL,
        created_by INT NULL,
        created_at BIGINT NOT NULL,
        removed_at BIGINT NULL,
        removed_by INT NULL,
        remove_reason VARCHAR(255) NULL,
        KEY blocklist_lookup (kind, value, removed_at),
        KEY blocklist_created (created_at)
      ) ${T}`,
    ],
  },
  {
    version: 7,
    name: "point activities",
    statements: [
      // Every spin of the lucky wheel: the points it cost and the credit it paid (0 = try again).
      `CREATE TABLE IF NOT EXISTS wheel_spins (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        cost INT NOT NULL,
        slot INT NOT NULL,
        prize BIGINT NOT NULL,
        created_at BIGINT NOT NULL,
        KEY wheel_user (user_id, created_at),
        KEY wheel_created (created_at)
      ) ${T}`,
      // Guesses of a round's bottom two digits; settled when the result is in, refunded if cancelled.
      `CREATE TABLE IF NOT EXISTS point_guesses (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        round_id INT NOT NULL,
        number CHAR(2) NOT NULL,
        cost INT NOT NULL,
        promised BIGINT NOT NULL,
        status VARCHAR(10) NOT NULL DEFAULT 'pending',
        paid BIGINT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        settled_at BIGINT NULL,
        UNIQUE KEY guess_once (round_id, user_id, number),
        KEY guess_round (round_id, status),
        KEY guess_user (user_id, created_at)
      ) ${T}`,
    ],
  },
  {
    version: 8,
    name: "game aggregator",
    statements: [
      // Products the aggregator lets this agent offer; staff switch each on or off.
      `CREATE TABLE IF NOT EXISTS game_products (
        product_id VARCHAR(40) NOT NULL PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        grp VARCHAR(10) NOT NULL,
        enabled TINYINT NOT NULL DEFAULT 1,
        available TINYINT NOT NULL DEFAULT 1,
        sort INT NOT NULL DEFAULT 0,
        games INT NOT NULL DEFAULT 0,
        synced_at BIGINT NULL,
        KEY game_products_grp (grp, enabled, available, sort)
      ) ${T}`,
      // Each product's games, replaced on every catalog sync.
      `CREATE TABLE IF NOT EXISTS game_catalog (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        product_id VARCHAR(40) NOT NULL,
        code VARCHAR(120) NOT NULL,
        name VARCHAR(160) NOT NULL,
        names TEXT NULL,
        type VARCHAR(30) NULL,
        img VARCHAR(500) NULL,
        rank_no INT NOT NULL DEFAULT 0,
        UNIQUE KEY game_code (product_id, code),
        KEY game_product (product_id, rank_no)
      ) ${T}`,
      // Every provider transaction (bet, settle, refund, tip, reward, fishing move) and its state.
      // bet/payout are what the provider reported; debited/credited are what really moved.
      `CREATE TABLE IF NOT EXISTS game_txns (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        product_id VARCHAR(40) NOT NULL,
        txn_id VARCHAR(120) NOT NULL,
        round_id VARCHAR(120) NULL,
        game_code VARCHAR(120) NULL,
        play_info VARCHAR(255) NULL,
        status VARCHAR(10) NOT NULL,
        kind VARCHAR(8) NOT NULL,
        bet BIGINT NOT NULL DEFAULT 0,
        debited BIGINT NOT NULL DEFAULT 0,
        payout BIGINT NOT NULL DEFAULT 0,
        credited BIGINT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        UNIQUE KEY game_txn (product_id, txn_id),
        KEY game_txn_round (product_id, user_id, round_id),
        KEY game_txn_user (user_id, id),
        KEY game_txn_created (created_at)
      ) ${T}`,
      // Every change a game made to a member's balance, in order, for reconciliation.
      // shortfall > 0: money a rollback or void should have taken back but the balance did not cover.
      `CREATE TABLE IF NOT EXISTS game_moves (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        product_id VARCHAR(40) NOT NULL,
        txn_id VARCHAR(120) NOT NULL,
        action VARCHAR(16) NOT NULL,
        amount BIGINT NOT NULL,
        shortfall BIGINT NOT NULL DEFAULT 0,
        balance_after BIGINT NOT NULL,
        request_id VARCHAR(80) NULL,
        created_at BIGINT NOT NULL,
        KEY game_moves_user (user_id, id),
        KEY game_moves_shortfall (shortfall, id),
        KEY game_moves_created (created_at)
      ) ${T}`,
      // Each member's game result per day (by when bets settled) and the cashback it earned.
      `CREATE TABLE IF NOT EXISTS game_daily (
        day_key CHAR(10) NOT NULL,
        user_id INT NOT NULL,
        bets BIGINT NOT NULL DEFAULT 0,
        paid BIGINT NOT NULL DEFAULT 0,
        cashback BIGINT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (day_key, user_id),
        KEY game_daily_user (user_id, day_key)
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS game_days (
        day_key CHAR(10) NOT NULL PRIMARY KEY,
        members INT NOT NULL DEFAULT 0,
        done_at BIGINT NOT NULL
      ) ${T}`,
    ],
  },
  {
    version: 9,
    name: "remove staff from users",
    statements: [
      // Runs only after the admin runbook step 6.2 pre-check has passed: every users row with role = 'staff'
      // exists in employees with the same id (no staff missing from employees). This delete cannot be undone.
      // Every statement is safe to re-run (IF EXISTS, MariaDB 10.5+): a failure midway is fixed by migrating again.
      "DELETE FROM users WHERE role = 'staff'",
      "ALTER TABLE users DROP FOREIGN KEY IF EXISTS users_staff_role_fk",
      "ALTER TABLE users DROP COLUMN IF EXISTS staff_role_id, DROP COLUMN IF EXISTS totp_secret, DROP COLUMN IF EXISTS totp_enabled, DROP COLUMN IF EXISTS totp_last_step, DROP COLUMN IF EXISTS must_change_password",
      "DROP TABLE IF EXISTS staff_roles",
    ],
  },
  {
    version: 10,
    name: "lotto groups",
    statements: [
      // Managed in the back office. A built-in keeps an empty name until renamed, so the apps show their own label.
      `CREATE TABLE IF NOT EXISTS lotto_groups (
        code VARCHAR(40) NOT NULL PRIMARY KEY,
        name VARCHAR(60) NOT NULL DEFAULT '',
        i18n TEXT NOT NULL,
        art VARCHAR(20) NOT NULL DEFAULT 'ticket',
        sort INT NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL DEFAULT 0
      ) ${T}`,
      `INSERT IGNORE INTO lotto_groups (code, name, i18n, art, sort) VALUES
        ('thai', '', '{}', 'ticket', 10), ('foreign', '', '{}', 'coins', 20), ('stock', '', '{}', 'chart', 30), ('yiki', '', '{}', 'balls', 40)`,
      "ALTER TABLE lottos MODIFY grp VARCHAR(40) NOT NULL",
    ],
  },
  {
    version: 11,
    name: "per-lottery automatic round creation",
    // Off: the back office makes this lottery's rounds by hand.
    statements: ["ALTER TABLE lottos ADD COLUMN IF NOT EXISTS auto_rounds TINYINT(1) NOT NULL DEFAULT 1"],
  },
  {
    version: 12,
    name: "price packages and round configs",
    // Additive only: lottos.rates / limits / risk stay until betting reads round_configs.
    statements: [
      `CREATE TABLE IF NOT EXISTS price_packages (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(40) NOT NULL,
        name VARCHAR(60) NOT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        sort INT NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL,
        UNIQUE KEY price_packages_code (code)
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS package_rates (
        package_id INT NOT NULL,
        bet_type VARCHAR(10) NOT NULL,
        rate100 INT NOT NULL,
        discount_bp INT NOT NULL DEFAULT 0,
        PRIMARY KEY (package_id, bet_type),
        CONSTRAINT package_rates_ok CHECK (rate100 > 0 AND discount_bp BETWEEN 0 AND 9999),
        CONSTRAINT package_rates_fk FOREIGN KEY (package_id) REFERENCES price_packages (id) ON DELETE CASCADE
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS risk_profiles (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(60) NOT NULL,
        name VARCHAR(60) NOT NULL,
        profile TEXT NOT NULL,
        updated_at BIGINT NOT NULL,
        UNIQUE KEY risk_profiles_code (code)
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS lotto_bet_types (
        lotto_id INT NOT NULL,
        bet_type VARCHAR(10) NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        min_stake INT NOT NULL,
        max_per_number INT NOT NULL,
        risk_profile_id INT NOT NULL,
        PRIMARY KEY (lotto_id, bet_type),
        CONSTRAINT lotto_bet_types_lotto_fk FOREIGN KEY (lotto_id) REFERENCES lottos (id) ON DELETE CASCADE,
        CONSTRAINT lotto_bet_types_risk_fk FOREIGN KEY (risk_profile_id) REFERENCES risk_profiles (id)
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS lotto_packages (
        lotto_id INT NOT NULL,
        package_id INT NOT NULL,
        PRIMARY KEY (lotto_id, package_id),
        CONSTRAINT lotto_packages_lotto_fk FOREIGN KEY (lotto_id) REFERENCES lottos (id) ON DELETE CASCADE,
        CONSTRAINT lotto_packages_package_fk FOREIGN KEY (package_id) REFERENCES price_packages (id) ON DELETE CASCADE
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS lotto_rate_overrides (
        lotto_id INT NOT NULL,
        package_id INT NOT NULL,
        bet_type VARCHAR(10) NOT NULL,
        rate100 INT NULL,
        discount_bp INT NULL,
        PRIMARY KEY (lotto_id, package_id, bet_type),
        CONSTRAINT lotto_rate_overrides_ok CHECK ((rate100 IS NULL OR rate100 > 0) AND (discount_bp IS NULL OR discount_bp BETWEEN 0 AND 9999)),
        CONSTRAINT lotto_rate_overrides_lotto_fk FOREIGN KEY (lotto_id) REFERENCES lottos (id) ON DELETE CASCADE,
        CONSTRAINT lotto_rate_overrides_package_fk FOREIGN KEY (package_id) REFERENCES price_packages (id) ON DELETE CASCADE
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS round_configs (
        round_id INT NOT NULL,
        version INT NOT NULL,
        config MEDIUMTEXT NOT NULL,
        created_at BIGINT NOT NULL,
        created_by INT NULL,
        PRIMARY KEY (round_id, version),
        CONSTRAINT round_configs_round_fk FOREIGN KEY (round_id) REFERENCES rounds (id) ON DELETE CASCADE
      ) ${T}`,
    ],
  },
  {
    version: 13,
    name: "bills priced from round configs",
    // total_stake stays what the member paid; discount is the difference to the stake bet.
    statements: [
      `ALTER TABLE bills
        ADD COLUMN IF NOT EXISTS discount BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS package_id INT NULL,
        ADD COLUMN IF NOT EXISTS config_version INT NULL,
        ADD COLUMN IF NOT EXISTS request_id VARCHAR(40) NULL`,
      "ALTER TABLE bills ADD UNIQUE KEY IF NOT EXISTS bills_request (user_id, request_id)",
      "ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS discount BIGINT NOT NULL DEFAULT 0",
    ],
  },
  {
    version: 14,
    name: "two-person results and settlement runs",
    statements: [
      // pending_confirm: a result was typed and waits for a second person. planned_close: the scheduled close of a round closed early.
      "ALTER TABLE rounds MODIFY status ENUM('scheduled','pending_confirm','resulted','cancelled') NOT NULL DEFAULT 'scheduled'",
      "ALTER TABLE rounds ADD COLUMN IF NOT EXISTS planned_close BIGINT NULL",
      `CREATE TABLE IF NOT EXISTS round_results (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        round_id INT NOT NULL,
        kind ENUM('result','correction','cancel') NOT NULL DEFAULT 'result',
        result TEXT NULL,
        status ENUM('pending','confirmed','rejected','superseded') NOT NULL DEFAULT 'pending',
        entered_by INT NULL,
        entered_at BIGINT NOT NULL,
        confirmed_by INT NULL,
        confirmed_at BIGINT NULL,
        reason VARCHAR(255) NULL,
        KEY round_results_round (round_id, status),
        CONSTRAINT round_results_round_fk FOREIGN KEY (round_id) REFERENCES rounds (id) ON DELETE CASCADE
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS settlement_runs (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        round_id INT NOT NULL,
        round_result_id BIGINT NULL,
        kind ENUM('result','cancel') NOT NULL,
        status ENUM('running','done','mismatch') NOT NULL DEFAULT 'running',
        report TEXT NULL,
        created_at BIGINT NOT NULL,
        finished_at BIGINT NULL,
        KEY settlement_runs_round (round_id, id),
        CONSTRAINT settlement_runs_round_fk FOREIGN KEY (round_id) REFERENCES rounds (id) ON DELETE CASCADE
      ) ${T}`,
      "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS run_id BIGINT NULL",
      "ALTER TABLE transactions ADD KEY IF NOT EXISTS transactions_run (run_id)",
      "ALTER TABLE bills ADD COLUMN IF NOT EXISTS settlement_run_id BIGINT NULL",
      "ALTER TABLE bills ADD KEY IF NOT EXISTS bills_run (settlement_run_id)",
    ],
  },
];

/** A MariaDB string literal (only for the fixed, trusted text above). */
function sqlText(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

/** Every table the app owns, children first (safe order for DROP). */
export const APP_TABLES = [
  "game_days",
  "game_daily",
  "game_moves",
  "game_txns",
  "game_catalog",
  "game_products",
  "point_guesses",
  "wheel_spins",
  "blocklist",
  "point_moves",
  "member_points",
  "bank_account_moves",
  "bank_accounts",
  "system_status",
  "media",
  "banners",
  "audit_log",
  "ref_clicks",
  "games",
  "news",
  "number_sets",
  "voucher_redemptions",
  "vouchers",
  "promotion_claims",
  "promotions",
  "withdrawals",
  "deposits",
  "transactions",
  "manual_limits",
  "exposures",
  "bill_items",
  "bills",
  "settlement_runs",
  "round_results",
  "round_configs",
  "lotto_rate_overrides",
  "lotto_packages",
  "lotto_bet_types",
  "rounds",
  "lottos",
  "lotto_groups",
  "package_rates",
  "price_packages",
  "risk_profiles",
  "rate_limits",
  "otps",
  "auth_log",
  "login_attempts",
  "login_challenges",
  "session_ends",
  "sessions",
  "users",
  "settings",
  "schema_migrations",
] as const;
