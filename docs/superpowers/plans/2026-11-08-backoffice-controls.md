# Back-office controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Credit-adjustment limits and history, member edit/close, tamper-evident audit log, website bank accounts with balances.

**Architecture:** MariaDB migration 3 adds columns and two tables. Money effects stay inside the existing finance transactions. The audit chain is sealed by the scheduler. Pure rules live in small tested modules; actions gate on new permissions.

**Tech Stack:** Next.js 16.4.5, TypeScript, mysql2 + MariaDB 10.5, MongoDB mirror, vitest.

**Spec:** `docs/superpowers/specs/2026-11-08-backoffice-controls-design.md`

## Global Constraints

- New permissions: `members.edit`, `members.delete`, `banks.view`, `banks.manage`, `banks.adjust`.
- Lock order: deposit/withdrawal row → member wallet → bank account → audit insert.
- Every UI string in th, en, lo, my, km (`src/i18n/locales.test.ts`).
- Money in integer satang; adjustments in baht from forms, converted with `Math.round(x * 100)`.

## Review Focus

1. Closing a member who still has cashback or affiliate balance (not just main balance) must be refused (closeBlockers test, Task 4).
2. A deposit approved twice concurrently must credit the bank account once (approval keeps `FOR UPDATE` on the deposit row; status check before credit; DB test).
3. Changing a member's bank account while a withdrawal is pending must not change that withdrawal's payout details (withdrawals keep their own copy; no code touches them).
4. A sealed audit row edited in the database must be reported as broken at its sequence number (verifyChain test, Task 2).
5. An adjustment of exactly `adjustMax` passes and one satang above fails (adjustLimitError test, Task 3).

---

### Task 1: Schema, permissions, labels
Files: `src/server/db/migrations.ts` (version 3), `src/domain/permissions.ts`, `src/i18n/locales/*/admin/shell.ts` (perm labels).
- [ ] Migration 3: users.status adds `closed` + `closed_at`, `closed_by`, `close_reason`; audit_log adds `ua`, `seq` (unique), `prev_hash`, `hash`; tables `bank_accounts`, `bank_account_moves`; deposits.`bank_account_id`; withdrawals.`paid_from_id`; copy `settings.wallet.receivingAccounts[0..4]` into `bank_accounts` (kind deposit).
- [ ] Permissions + labels; finance default role gains `banks.view`, `banks.adjust`.
- [ ] Locales test passes.

### Task 2: Tamper-evident audit
Files: create `src/server/services/audit-chain.ts`, `audit-chain.test.ts`; modify `audit.ts`, `actions/admin.ts` (`gate`), `scheduler.ts`, audit page + loader.
- Pure: `chainHash(prev: string, row: ChainRow): string`; `verifyChain(rows: SealedRow[], startPrev: string): { ok: true } | { ok: false; seq: number }`.
- [ ] Tests: identical input → identical hash; changing any field changes it; edited middle row → `{ok:false, seq}`; deleted row (seq gap) → broken at the gap.
- [ ] `sealAudit(now)` (rows older than 60 s, id order, ≤500 per run, mirror to MongoDB), `verifyAudit()` hourly → `system_status.audit_chain`.
- [ ] `audit()` stores the user agent (safe outside requests); `gate()` logs `denied`.
- [ ] Audit page: integrity banner, before/after shown.

### Task 3: Adjustment limits and history
Files: `catalog.ts` (WalletSettings `adjustMin`, `adjustMax`), settings action + form, `actions/admin.ts` (`adjustBalanceAction`), create `src/domain/adjust.ts` + test, member page + loader.
- Pure: `adjustLimitError(amountSatang: number, limits: {adjustMin: number; adjustMax: number}): "zero" | "min" | "max" | null`.
- [ ] Tests: 0 → zero; below min → min; exactly max passes; max+1 → max; negative uses absolute value.
- [ ] History section (last 50) on the member page.

### Task 4: Member edit and close
Files: create `src/server/services/members.ts`, `src/domain/members.ts` + test; actions; member page forms.
- Pure: `closeBlockers(s: { balance; cashback; affiliate; pendingBills; openDeposits; pendingWithdrawals }): string[]` (keys of what blocks).
- [ ] Tests: all zero → []; cashback only → ["cashback"]; pending withdrawal → ["withdrawals"].
- [ ] `updateMember`, `closeMember`, `reopenMember` (audit before/after; sessions revoked on phone change and close).

### Task 5: Bank accounts
Files: create `src/server/services/banks.ts`, `src/domain/banks-ledger.ts` + test, admin page `src/app/[lang]/admin/banks/page.tsx` + component; modify `finance.ts` (assign, credit, debit), finance page (pick account), settings form (remove receiving account), `data/wallet.ts`, seed, nav, i18n.
- Pure: `applyMove(balance: number, amount: number): number`, `archiveBlocker(a: { balance: number; openDeposits: number }): "balance" | "open" | null`.
- [ ] Tests for the pure helpers; DB test for approve-twice credits once.

### Task 6: Verify and document
- [ ] vitest, eslint, next build; docs (README, DEPLOY); report.
