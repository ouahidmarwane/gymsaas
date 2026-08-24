# GymFlow Remediation Plan

This document converts the findings in `SECURITY_PERFORMANCE_AVAILABILITY_AUDIT.md` into isolated correction batches. It is planning only; no application or schema change is included.

## Batch 1 — Authorization scope and privileged access

Findings addressed: H-01, H-03, M-02
Risk: High
Dependencies: product-owner decision on branch/discipline semantics; MFA/step-up method and recovery policy

Affected files:

- `src/auth/session.ts`
- `src/api.ts`
- `src/club/club-database.ts`
- `src/control-plane/schema.sql` or a future versioned D1 migration
- `components/Shell.tsx`
- authorization/isolation/support tests

Expected modifications:

1. Define an immutable server-side data scope from membership branch/discipline.
2. Pass scope to every sensitive DO method and enforce target ownership before reads/writes.
3. Decide admin/owner bypass and encode it centrally.
4. Make support entry read-only by default; use a short explicit write grant.
5. Introduce step-up state for catastrophic Superadmin actions and rotate/bind privileged session state.
6. Keep private Messaging unavailable to support mode.

Required tests:

- Full role × branch × discipline × endpoint negative matrix.
- Member, payment, grade, document/photo and dashboard isolation inside one club.
- Support default read-only, explicit write, timeout and audit.
- Normal club user cannot obtain platform step-up.
- Stolen/stale ordinary Superadmin session cannot invoke protected routes.

Rollback considerations:

- Scope enforcement may reveal existing staff relying on club-wide access. Provide an explicit membership-scope migration/audit before enforcement.
- Step-up rollout needs an emergency but audited recovery path to avoid locking out the only operator.

Dependencies on earlier batches: none. This is the first batch.

## Batch 2 — Idempotency and financial integrity

Findings addressed: H-04, part of M-12
Risk: High
Dependencies: Batch 1 authorization helpers should be stable before changing endpoint contracts

Affected files:

- `src/api.ts`
- `src/club/club-database.ts`
- `src/club/schema.ts`
- `src/control-plane/schema.sql` / future D1 migrations
- payment, ledger, billing and cron tests

Expected modifications:

1. Define idempotency-key scope: actor + organization + route/operation.
2. Store payload digest and prior result for payment, subscription renewal, insurance renewal and invoice creation.
3. Add safe business uniqueness for SaaS invoice coverage periods.
4. Make proof review and paid/unpaid transitions conditional on expected state.
5. Return the original result for identical retries and conflict for key/payload mismatch.

Required tests:

- Concurrent duplicate payment/renewal.
- Response lost after commit followed by retry.
- Same key/different body rejected.
- Separate legitimate payments allowed.
- Two overlapping cron jobs create one invoice.
- Reversal remains append-only and cannot be duplicated.

Rollback considerations:

- Do not add a uniqueness constraint until existing duplicate periods are detected and resolved.
- Preserve old clients temporarily if an idempotency header becomes mandatory.

Dependencies on earlier batches: Batch 1.

## Batch 3 — Resumable deletion and cross-store consistency

Findings addressed: H-02, M-04, L-04
Risk: High
Dependencies: privileged step-up from Batch 1; observability event format may be coordinated with Batch 6

Affected files:

- `src/api.ts`
- `src/control-plane/schema.sql` / future D1 migrations
- `src/club/club-database.ts`
- R2/document/provisioning/Superadmin tests

Expected modifications:

1. Add organization lifecycle/deletion job state with phase, attempts and last safe error.
2. Record deletion request audit before mutation and revoke sessions immediately.
3. Prevent normal operations while `deleting`.
4. Delete tenant DO and every R2 namespace: branding, member photos/docs, messaging and billing proofs.
5. Make every phase idempotent/resumable.
6. Finalize D1 metadata only after completion and preserve an immutable audit tombstone.
7. Standardize upload compensation and add orphan reconciliation.

Required tests:

- Failure after each DO/R2/D1 phase and subsequent resume.
- Concurrent delete attempts collapse to one job.
- All R2 prefixes empty after completion.
- Normal users lose access at deletion start.
- Metadata failure after upload creates a reconciliable object, not silent leakage.

Rollback considerations:

- Destructive phases cannot be rolled back; rollout should initially support dry-run/inventory only.
- Keep the current direct-delete route disabled once the state machine is active.

Dependencies on earlier batches: Batch 1.

## Batch 4 — Member scalability and database query shape

Findings addressed: H-05, M-12, performance part of M-07
Risk: Medium/High
Dependencies: stable authorization scope from Batch 1, because pagination queries must include scope predicates

Affected files:

- `app/members/page.tsx`
- `components/MemberExportModal.tsx`
- member photo components
- `src/api.ts`
- `src/club/club-database.ts`
- `src/club/schema.ts`

Expected modifications:

1. Introduce cursor-paginated server search/filter/sort with total/summary endpoints.
2. Make CSV export complete and server-paged/streamed rather than based on current client rows.
3. Produce bounded thumbnails at photo upload and retain original for detail view.
4. Cursor-page payment history and use date-range predicates rather than `strftime` filters.
5. Measure SQLite query plans before adding composite indexes.

Required tests:

- 201, 500, 1,000, 5,000-member representative fixtures.
- Stable pagination under insert/update/archive.
- Search/export includes records older than first page.
- Branch/discipline scope persists on every page.
- List loads thumbnail only; original authorization unchanged.
- Payment totals remain independent of visible page.

Rollback considerations:

- Keep old endpoint temporarily versioned while UI migrates.
- Do not delete original photos when creating thumbnails.

Dependencies on earlier batches: Batch 1.

## Batch 5 — Migration and availability hardening [CLOSED]

Findings addressed: M-03, M-05, L-05
Status: CLOSED
Risk: High for migration changes
Dependencies: product decisions on SaaS grace/read-only/limits

Affected files:

- `src/club/club-database.ts`
- `src/club/schema.ts`
- `src/api.ts`
- `src/auth/session.ts`
- `src/env.ts`
- `migrations/0005_batch5_availability_entitlements.sql`
- `test/batch5-migrations-entitlements.test.mjs`

Completed modifications & guarantees:

1. **Atomic DO Migrations (M-03)**: Each migration version and its `_schema_version` insert are wrapped synchronously inside `this.ctx.storage.transactionSync(() => { ... })`. Any mid-migration failure triggers an automatic rollback of the entire version and prevents `_schema_version` corruption.
2. **Nullable Mutation Semantics (L-05)**: Dynamic allowlisted `SET` clauses distinguish omitted properties (`undefined`) from explicit `null`/`""`. Omitted properties strictly retain existing values, while explicit `null` updates clear columns to SQLite `NULL`.
3. **SaaS Entitlement Evaluation & Enforcement (M-05)**: Implemented central `evaluateEntitlement(env, orgId)` computing `state` (`active`, `trial`, `grace`, `expired`, `suspended`, `cancelled`, `deleting`, `deleted`) and `readOnly` status (with 7-day grace window). Gated write endpoints via `assertEntitledWrite`, `assertMemberCap`, `assertBranchCap`, and `assertStaffCap` with support-mode and observe-mode capabilities.
4. **D1 Control Plane Indexes**: Added `0005_batch5_availability_entitlements.sql` indexing `organizations(status)`, `organizations(plan)`, and `org_billing(expires_at)`.
5. **Rigorous Verification**: 20 automated tests in `test/batch5-migrations-entitlements.test.mjs` covering atomic migration replay, rollback on fault injection, nullable clearing vs omission preservation, entitlement matrix, plan caps, and observe mode.

Dependencies on earlier batches: Batches 1-3.

## Batch 6 — Request efficiency, Messaging and observability

Findings addressed: M-07, M-08, M-11, L-06
Risk: Medium
Dependencies: correlation/event conventions should be agreed before implementation

Affected files:

- `src/auth/session.ts`
- `src/api.ts`
- `app/messagerie/page.tsx`
- `worker.ts`
- `test/helpers.mjs`
- observability configuration

Expected modifications:

1. Conditionally update session last-seen only after a coarse interval.
2. Replace repeated full Messaging reloads with a lightweight cursor/delta endpoint.
3. Refresh inactive-conversation unread state in the same navigation delta.
4. Pause/background-backoff polling and add jitter.
5. Add request IDs and structured allowlisted route/dependency/latency logs.
6. Emit cron summaries, migration failures and reconciliation alerts.
7. Make test harness fail once with captured Worker stderr and cancel dependent tests.

Required tests:

- Idle timeout under conditional touches.
- Messaging delta ordering, no duplicates, unread correctness and reconnect/backoff.
- Hidden-tab behavior.
- Request correlation across API/DO/R2 failure logs.
- PII/secret redaction assertions.
- Intentional test Worker crash classification.

Rollback considerations:

- Keep old Messaging polling behind a temporary fallback until delta endpoint is proven.
- Observability volume/sample rates must be cost-bounded.

Dependencies on earlier batches: Batch 1; ideally Batch 3 event-state design.

## Batch 7 — Web and account defense in depth

Findings addressed: M-01, M-06, M-09, M-10, L-01, L-02, L-03, L-07
Risk: Medium
Dependencies: email delivery and MFA/recovery choices; CSP source inventory

Affected files:

- `src/api.ts`
- `src/auth/session.ts`
- `next.config.ts`
- `app/layout.tsx`
- staff/account/login UI
- upload validators
- relevant security tests

Expected modifications:

1. Enforce same-origin requests on unsafe methods.
2. Replace rate-limit count/read races with an atomic bounded design.
3. Add invitation, activation, verification, recovery and individual session revocation.
4. Deploy CSP in report-only mode, then enforcement; add HSTS/COOP/CORP as compatible.
5. Verify magic bytes for rendered types and define risky attachment policy.
6. Decide self-hosted font/map policy and graceful fallbacks.

Required tests:

- Foreign/missing Origin matrix.
- Parallel/distributed rate-limit tests.
- Invitation/recovery expiry and replay.
- Header/CSP browser smoke tests for fonts, maps, uploads and Messaging.
- MIME/signature mismatch.
- Third-party network blocked without core-app failure.

Rollback considerations:

- CSP begins report-only to avoid breaking assets.
- Origin validation needs an explicit local-development and future trusted-client policy.
- Account lifecycle rollout must not strand existing users.

Dependencies on earlier batches: Batch 1 for privileged identity; other work can proceed after P0.
