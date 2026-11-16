# Back-office controls: credit limits, member edits, fraud-proof logs, bank accounts

Date: 2026-11-08. Requested by the owner (5 items); proposals accepted with "ทำได้เลย". The bank-balance question was not answered, so the recommended answer was taken: balances move automatically with real transactions, plus manual adjustments.

## Goals

1. **Credit adjustment limits:** settings `adjustMin` / `adjustMax` (per adjustment, absolute amount, both directions). Defaults ฿1 and ฿100,000. Settings validation: ฿1 ≤ min ≤ max ≤ ฿10,000,000. The hard-coded ±฿10M limit goes away.
2. **Adjustment history on the member page** (no new menu): the last 50 `adjust` transactions with time, staff, amount, balance before → after, and reason. Needs `members.view`.
3. **Edit and close members:**
   - New permission `members.edit`: name, phone, bank code/account/account name. A reason is required. Phone and bank-account uniqueness are checked as in registration. Changing the phone ends the member's sessions.
   - New permission `members.delete`: delete means close the account, never a hard delete (bills and money history must stay). Closing requires all three wallets at zero and nothing open: no pending bills, no awaiting/pending deposits, no pending withdrawals. It sets status `closed` with `closed_at`, `closed_by`, `close_reason`, and ends sessions. The phone and bank account stay reserved, so they cannot be re-registered for new-member bonuses. "Reopen" sets the status back to active (same permission).
   - Every status check already requires `active`, so `closed` blocks sign-in, betting, and withdrawals everywhere.
4. **Logs that expose tampering:**
   - Each audit row gains the user agent.
   - Edits record `{before, after}`.
   - `gate()` logs refused attempts by signed-in users (`denied`, target `perm:<id>`).
   - A sealer in the scheduler takes unsealed rows older than a minute, in id order. It assigns each a sequence number and a SHA-256 hash chained to the previous row (`seq`, `prev_hash`, `hash`), then mirrors the sealed rows to MongoDB `audit_log` when configured.
   - An hourly verification walks the chain and stores the result in `system_status` (`audit_chain`). The audit page shows "intact" or the first broken sequence number. Editing or deleting a sealed row breaks the chain; the MongoDB copy keeps the original.
5. **Website bank accounts:**
   - **Tables:** `bank_accounts` (kind `deposit` or `withdraw`, bank, number, name, balance, active, sort, note, archived) and `bank_account_moves`. The moves table is append-only: amount, balance after, kind `deposit` / `withdrawal` / `adjust`, ref, note, staff, time.
   - **Deposits:** a new deposit is assigned the first active deposit account by sort order (snapshot kept in `to_bank`, id in `deposits.bank_account_id`). Approving it credits that account in the same transaction.
   - **Withdrawals:** marking one paid requires choosing an active withdraw account when any exists, and debits it (`withdrawals.paid_from_id`). Negative balances are allowed and shown in red: payouts never block on bookkeeping.
   - **Manual adjustments:** need `banks.adjust` and a reason.
   - **Add/edit:** need `banks.manage`; edits are logged before/after. A balance is never edited directly.
   - **Delete:** archive only, when the balance is 0 and no open deposit points at the account.
   - **Permissions:** `banks.view`, `banks.manage`, `banks.adjust` (finance group).
   - **Navigation:** a new "บัญชีธนาคาร" page in the finance menu.
   - **Migration:** existing receiving accounts in `settings.wallet` are copied into `bank_accounts`, and the settings page stops editing them.

## Non-goals

Transfers between accounts as one operation (two adjustments do it), automatic bank statement import, approval workflows for large adjustments.

## Constraints

Lock order inside money transactions stays: deposit or withdrawal row → member wallet → bank account → audit insert. No role other than the owner gains the new permissions automatically; the owner grants them on the staff page. Every new UI string ships in all 5 languages (the locales test enforces it).

## Approaches considered

Bank balances: (a) automatic with real transactions plus manual adjustments (chosen: the system balance can be reconciled against the bank app, which is what exposes theft); (b) manual only (simpler, but nothing ties recorded balances to approved deposits or paid withdrawals).

Log integrity: (a) hash chain sealed by the scheduler (chosen: no lock on the hot path, tampering is detectable); (b) chain at insert time (needs a global lock inside money transactions); (c) MongoDB copy only (deleting from both goes unnoticed).
