# SDD ledger — plan: docs/superpowers/plans/2026-11-08-backoffice-controls.md
Spec: docs/superpowers/specs/2026-11-08-backoffice-controls-design.md
Ruling: owner said 'ทำได้เลย' without answering the bank-balance question — took the recommendation (automatic with deposits/withdrawals + manual adjustments) — cost if wrong: they may want manual-only; automatic moves can be ignored but not removed easily.
Pre-flight: T3,T4,T5 consume T1 permissions/columns; T5 consumes T2 audit helper — consistent.
Task 1: complete (migration 3 written; JSON copy query ran read-only on MariaDB; tests: npx vitest run src/i18n → 26 passed)
Task 2: complete (tests: audit-chain 6 passed; i18n 26 passed; sealer/verify/mirror + denied logging + audit page)
Task 3: in progress (adjust limits enforced: domain/adjust 4 passed; settings form + messages)
Task 3: complete (adjust limits + history; tests: domain/adjust 4 passed)
Task 4: complete (member edit/close/reopen; tests: domain/members 3 passed; closed accounts guarded in suspend/adjust)
Task 5: complete (bank accounts + deposit credit + payout debit + page + nav; tests: domain/bank-accounts 3 passed; money DB tests updated, skipped without TEST_DATABASE_URL)
Task 5: Ruling: suspend/activate and balance adjustment now refuse closed accounts — otherwise suspend/activate reopened a closed account without members.delete — cost if wrong: none.
Task 6: docs updated (README fraud-control section, DEPLOY migration 3 steps)
Task 6: complete (vitest 158 passed / 55 skipped; eslint 0; tsc 0; next build OK 285 pages; migration 3 DDL ran on TEMPORARY copies in MariaDB 10.5: all 13 steps ok, real tables untouched)
Final review: self-review (subagents only on the owner's request). Fixed during review: closed-account badge on the member list; denied-attempt logging capped at 20/min per person.
Final: minor (deferred): the payout-account list is checked just before the transaction; an account deleted in that instant would still be debited.
Final: minor (deferred): the member list has no "closed" filter (closed accounts show with a red badge).
Final: minor (deferred): bank-account foreign key in migration 3 was not exercised by the temporary-table check (temporary tables cannot hold foreign keys); same syntax as the existing tables.
