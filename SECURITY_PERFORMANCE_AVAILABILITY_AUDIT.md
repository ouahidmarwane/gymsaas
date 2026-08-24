# GymFlow Security, Performance & Availability Audit

Audit date: 2026-08-18
Scope: current working tree, including uncommitted Messaging and schema/API work
Method: source/configuration review plus safe local validation; no production resources were accessed or changed

## 1. Executive Summary

GymFlow has a sound core tenant-isolation design: the authenticated server-side session selects one SQLite-backed Durable Object per club, raw SQL values are consistently parameterized, private R2 reads are proxied through authorization checks, and important payment mutations use local SQLite transactions and append-only reversals. The architecture should be hardened, not replaced.

No Critical issue or confirmed cross-club data escape was found. Five High findings should be addressed before additional product work: unresolved branch/discipline authorization scope, non-atomic irreversible tenant deletion, insufficient protection for catastrophic Superadmin actions, non-idempotent monetary mutations, and a member-list/photo design that fails operationally beyond 200 members and can create extreme browser/R2 load.

Overall scores:

| Area | Score | Explanation |
|---|---:|---|
| Security | 6.5/10 | Strong primitives and tenant boundary; CSRF, privileged-account protection, scope enforcement and headers need work. |
| Tenant Isolation | 8/10 | Separate DO per club and server-derived scope are strong; intra-club branch/discipline scope is not enforced. |
| Authentication | 7/10 | Good PBKDF2, opaque sessions, strict cookies and throttling; no MFA/recovery/verification and heavy session writes. |
| Authorization | 6/10 | Central role checks are consistent, but branch/discipline scope is effectively decorative and support defaults contradict policy comments. |
| Data Integrity | 6/10 | Good local transactions and reversal ledger; no idempotency and several D1/DO/R2 workflows can partially complete. |
| Performance | 5/10 | Efficient tenant-local SQL in many places, but raw photos, full client datasets, polling and frequent D1 session writes are material risks. |
| Scalability | 4.5/10 | The member UI already truncates above 200; reporting/message/payment queries need a deliberate large-club strategy. |
| Availability | 5.5/10 | Tenant separation limits blast radius, but migrations/deletion/cross-store writes lack recovery state machines. |
| Observability | 3.5/10 | Cloudflare observability is enabled, but there are no request IDs, structured logs, latency/error metrics or reconciliation telemetry. |
| Operational Safety | 5/10 | Typed deletion confirmation and audit logs help; irreversible actions lack re-authentication, dry-run/resume and complete auditing. |

Validation results:

- `npm.cmd audit --json`: 0 known vulnerabilities across 576 dependencies.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run test:static`: 8/8 passed.
- `npm.cmd run build`: passed; all 16 application routes built.
- `npm.cmd test`: began successfully and many security/domain tests passed, but the local Worker died during the suite. Subsequent tests failed with `ECONNREFUSED 127.0.0.1:8787`; the suite result is therefore infrastructure-inconclusive, not a clean pass or evidence that every later feature is broken.

## 2. Architecture Reviewed

- Next.js 16.3 and React 19.2.8, built through `@opennextjs/cloudflare`.
- Custom Worker entry wraps OpenNext and exports `ClubDatabase` plus a five-minute scheduled handler (`worker.ts`).
- Central D1 `CONTROL`: users, organizations, memberships, sessions, security, platform audit, SaaS billing, support messages, announcements and cached organization statistics (`src/control-plane/schema.sql`).
- One SQLite Durable Object selected through `env.CLUB.idFromName(serverDerivedOrgId)` per organization (`src/api.ts:52-55`).
- R2 `MEDIA`: branding, member photos/identity documents, billing proofs and message attachments.
- Raw parameterized D1 and Durable Object SQL; no ORM.
- Browser API calls use same-origin cookie credentials through one catch-all Next route (`app/api/[[...path]]/route.ts`).
- Cron purges old security/session data, refreshes up to 50 stale organization-stat rows and creates upcoming invoices (`src/api.ts:3115-3192`).

Data flow:

```text
Browser
  -> static/client-rendered Next.js route
  -> /api/* catch-all Worker route
  -> opaque cookie -> D1 session/user/membership resolution
  -> centralized atLeast() authorization
  -> either CONTROL D1
     or server-selected Club Durable Object -> tenant SQLite
     or authorized R2 proxy

Cron -> CONTROL D1 -> up to 50 Club DOs -> CONTROL org_stats
Superadmin -> CONTROL D1 or audited support scope -> selected Club DO
```

Trust boundaries:

1. Internet/browser to Worker: all request data is untrusted, including identifiers, MIME declarations and lengths.
2. Session cookie to principal: only a SHA-256 hash is stored; membership and organization status are rechecked.
3. Principal to club DO: organization comes from session/support state, never ordinary club query parameters.
4. DO to SQLite: tenant data is physically separated by object identity.
5. API to R2: metadata lives in D1/DO; binary operations are not transactionally coupled to metadata.
6. Superadmin boundary: a platform flag unlocks all tenants and irreversible platform operations.

## 3. Attack Surface

- Public: `/api/health`, `/api/auth/signup`, `/api/auth/login`, static login page.
- Authenticated club APIs: member, payment, grade, branch, discipline, branding, layout, staff, audit, subscription and account endpoints.
- Messaging: DMs/groups/team stored in tenant DO; support/announcements in D1; authorized R2 attachments.
- Superadmin: club creation/deletion, billing, proofs, blocklist, security events, session revocation, support mode, branding/configuration and announcements.
- Upload surface: raw request bodies up to 2/4/8/10 MB depending on route.
- Scheduled surface: five-minute stats refresh, retention purge and invoice issuance.
- Third party: Google Fonts and OpenStreetMap tiles from the browser; `wa.me` links.

## 4. Critical Findings

No Critical findings were confirmed.

## 5. High Findings

### H-01

ID: H-01
CATEGORY: Authorization / tenant scope
TITLE: Branch and discipline restrictions are resolved into the principal but not enforced
SEVERITY: HIGH
CONFIDENCE: CONFIRMED

AFFECTED FILES: `src/auth/session.ts`, `src/api.ts`, `src/club/club-database.ts`
AFFECTED FUNCTIONS/ROUTES: `resolveSession`; nearly all `/api/members`, `/api/payments`, `/api/finance`, `/api/grades`, `/api/branches`, `/api/disciplines`, file and dashboard routes

DESCRIPTION: Membership rows contain `branch_id` and `discipline_id`, and these fields are loaded into `Principal`, but `atLeast()` checks only role. Business queries accept optional client filters or return the whole club. A branch-scoped receptionist therefore receives club-wide data and can mutate records outside their intended scope.

EVIDENCE: `src/auth/session.ts:89-113,162-173`; `src/api.ts:95-114`; `/api/members` forwards a client-selected discipline at `src/api.ts:1727-1742`; payment/finance filters are also client-selected at `src/api.ts:1329-1420`. No common scope predicate is applied.

ATTACK / FAILURE SCENARIO: A staff account restricted in D1 to Branch A requests `/api/members?disciplineId=all`, guesses a member ID from Branch B, reads its photo, edits it, records payment or renews it. This is not Club A -> Club B escape, but it defeats the advertised intra-club scope boundary and exposes personal/financial data.

IMPACT: Unauthorized access and mutation inside a multi-branch club; overbroad staff access to identity documents and accounting operations.

LIKELIHOOD: High once branch-scoped roles are used; trivial requests, no special race or exploit tooling.

RECOMMENDED FIX: Define a server-side scope object and enforce it in every DO read/write method. Validate target member/payment/grade/branch against principal branch/discipline before action. Do not treat query filters as authorization. Decide explicitly whether admins/owners bypass scope.

REGRESSION TEST REQUIRED: Branch-A staff cannot list/read/edit/pay/renew/download Branch-B records; discipline-scoped negative cases; admin/owner policy cases; support-mode cases.

ESTIMATED FIX COMPLEXITY: Large
BREAKING-CHANGE RISK: High

### H-02

ID: H-02
CATEGORY: Reliability / data integrity / privacy
TITLE: Permanent organization deletion is irreversible and non-atomic across Durable Object, R2 and D1
SEVERITY: HIGH
CONFIDENCE: CONFIRMED

AFFECTED FILES: `src/api.ts`, `src/club/club-database.ts`
AFFECTED FUNCTIONS/ROUTES: `DELETE /api/admin/clubs/:orgId`; `ClubDatabase.destroyAll`

DESCRIPTION: Deletion destroys tenant SQLite first, then enumerates selected R2 prefixes, then deletes D1 metadata, users and sessions, then writes an audit event. These systems cannot share a transaction and there is no deletion state, retry ledger, tombstone, backup or resume operation.

EVIDENCE: Ordered destructive sequence at `src/api.ts:2390-2471`; `destroyAll()` calls `storage.deleteAll()` at `src/club/club-database.ts:2258-2261`. R2 cleanup omits `messaging/{orgId}/` and `billing-proofs/{orgId}/`, leaving sensitive orphan files. Platform audit is attempted only after destruction.

ATTACK / FAILURE SCENARIO: DO deletion succeeds, R2 times out, and the route returns 500. D1 still advertises an active club whose operational database is empty. Retrying may progress further, but there is no state or UI explaining what was destroyed. A completed deletion also leaves messaging attachments and billing proofs in R2.

IMPACT: Irrecoverable tenant data loss, inconsistent live organization, incomplete privacy deletion, missing audit trail.

LIKELIHOOD: Moderate; any transient R2/D1 failure during a long destructive request is sufficient.

RECOMMENDED FIX: Implement a resumable deletion state machine in D1: mark `deleting`, revoke access, record each phase, enumerate every known prefix, retry safely, and finalize metadata last. Require backup/export policy and immutable audit initiation before destructive work.

REGRESSION TEST REQUIRED: Inject failure after every phase; retry/resume; verify all R2 prefixes including messaging and proofs; verify sessions revoked immediately; verify audit survives every failure.

ESTIMATED FIX COMPLEXITY: Large
BREAKING-CHANGE RISK: High

### H-03

ID: H-03
CATEGORY: Superadmin security
TITLE: Catastrophic Superadmin actions require only an ordinary session
SEVERITY: HIGH
CONFIDENCE: HIGH CONFIDENCE

AFFECTED FILES: `src/api.ts`, `src/auth/session.ts`, `app/admin/page.tsx`, `app/facturation/page.tsx`, `app/supervision/page.tsx`
AFFECTED FUNCTIONS/ROUTES: all `/api/admin/*`, especially club deletion, support, billing, blocklist, session revocation and announcements

DESCRIPTION: `is_platform_admin` plus a normal 12-hour cookie is sufficient for every platform capability. There is no MFA, recent-password/re-authentication requirement, step-up session, privileged IP/device policy or short-lived destructive-action grant.

EVIDENCE: Superadmin routes perform boolean checks such as `if (!principal.isPlatformAdmin)` throughout `src/api.ts:2182-3095`. Club deletion adds typed slug confirmation, but no cryptographic/user re-authentication. Sessions use the same cookie and TTL for club users and Superadmins (`src/auth/session.ts:54-81,291-295`).

ATTACK / FAILURE SCENARIO: A stolen Superadmin cookie can enter any club with write access, read broad platform metadata, change billing, block users, revoke sessions, publish announcements and permanently delete tenants.

IMPACT: Platform-wide compromise and irreversible customer data loss.

LIKELIHOOD: Requires Superadmin session compromise; impact makes it High, not Critical absent a demonstrated way to steal that session.

RECOMMENDED FIX: Add MFA and step-up authentication for platform accounts; require recent re-auth for deletion, support-write escalation, billing proof acceptance, blocklist and session revocation; narrow privileged session TTL and optionally restrict trusted devices/networks.

REGRESSION TEST REQUIRED: Ordinary/stale privileged session rejected for step-up routes; completed step-up expires; club sessions can never obtain grant; audit includes challenge and action without secrets.

ESTIMATED FIX COMPLEXITY: Large
BREAKING-CHANGE RISK: Medium

### H-04

ID: H-04
CATEGORY: Data integrity / concurrency
TITLE: Monetary and renewal mutations are not idempotent
SEVERITY: HIGH
CONFIDENCE: CONFIRMED

AFFECTED FILES: `src/api.ts`, `src/club/club-database.ts`, `src/control-plane/schema.sql`
AFFECTED FUNCTIONS/ROUTES: `POST /api/payments`, member renew/insurance routes, manual/automatic invoice creation, proof review and mark-paid routes

DESCRIPTION: New random IDs are generated server-side on every request and no request idempotency key or business uniqueness constraint protects retries. DO serialization prevents simultaneous execution but does not identify duplicate sequential requests. Cron invoice issuance checks `NOT EXISTS` before insert without a unique `(org_id, period_start, period_end)` constraint.

EVIDENCE: payment creation `src/club/club-database.ts:749-800`; renewals `:607-700`; invoice cron `src/api.ts:3165-3192`; invoice schema has indexes but no period uniqueness at `src/control-plane/schema.sql:236-252`.

ATTACK / FAILURE SCENARIO: The Worker commits a renewal/payment but the response is lost. The browser/user retries, advancing expiry another month and recording another payment. Overlapping cron invocations can both pass `NOT EXISTS` and insert duplicate SaaS invoices.

IMPACT: Incorrect member expiry, duplicated charges/ledger lines and SaaS invoices; manual reconciliation required.

LIKELIHOOD: Moderate to high under mobile networks, impatient double clicks, client retries or overlapping scheduled executions.

RECOMMENDED FIX: Accept scoped idempotency keys for critical writes, persist result hashes, add justified business uniqueness constraints, and make proof/paid transitions conditional on current state. Preserve reversal semantics.

REGRESSION TEST REQUIRED: Same key twice returns same result; different payload with same key rejected; lost-response retry; concurrent cron issuance creates one period; separate legitimate operations remain possible.

ESTIMATED FIX COMPLEXITY: Medium
BREAKING-CHANGE RISK: Medium

### H-05

ID: H-05
CATEGORY: Performance / scalability / availability
TITLE: Member screen silently truncates at 200 and loads original photos as thumbnails
SEVERITY: HIGH
CONFIDENCE: CONFIRMED

AFFECTED FILES: `app/members/page.tsx`, `src/club/club-database.ts`, `lib/member-status.ts`, `src/api.ts`
AFFECTED FUNCTIONS/ROUTES: `GET /api/members`; member CSV exports; member photo GET

DESCRIPTION: The UI requests 500 members, but `listMembers` clamps the result to 200. Search, filters, counts and CSV exports operate on that truncated client array. Every row may request the original photo, whose allowed size is 8 MB; no thumbnail derivative is produced.

EVIDENCE: request at `app/members/page.tsx:57`; clamp at `src/club/club-database.ts:295-337`; client filtering/export at `app/members/page.tsx:94-168`; photo size rationale acknowledges the risk at `src/api.ts:442-457`.

ATTACK / FAILURE SCENARIO: A 500-member club sees only its newest 200 members and exports incomplete data. In the worst allowed case, 200 thumbnail requests represent up to 1.6 GB of original-image transfer before caching; ordinary phones can exhaust bandwidth/memory and repeatedly load R2/Worker.

IMPACT: Incorrect operational results and exports, severe page latency, browser instability and avoidable R2/Worker cost.

LIKELIHOOD: Certain above 200 members; photo impact depends on adoption and image sizes.

RECOMMENDED FIX: Add server-side cursor pagination/search/counts, make export a paged/server-streamed complete operation, generate bounded thumbnails at upload, lazy-load them and keep originals only for detail view.

REGRESSION TEST REQUIRED: 201/500/1,000-member fixtures; complete export; server search finds old rows; stable cursor under inserts; thumbnail dimensions/size and authorization; original not fetched in list.

ESTIMATED FIX COMPLEXITY: Large
BREAKING-CHANGE RISK: Medium

## 6. Medium Findings

### M-01

ID: M-01
CATEGORY: CSRF / API security
TITLE: Cookie-authenticated mutations rely on SameSite=Lax without explicit origin verification
SEVERITY: MEDIUM
CONFIDENCE: HIGH CONFIDENCE

AFFECTED FILES: `src/auth/session.ts`, `src/api.ts`, `app/api/[[...path]]/route.ts`
AFFECTED FUNCTIONS/ROUTES: all POST/PUT/PATCH/DELETE routes

DESCRIPTION: There is no CSRF token or Origin/Referer validation. SameSite=Lax blocks normal cross-site cookie submission in modern browsers, and JSON/raw bodies make many form attacks harder, but cookie policy alone is a browser-dependent defense and some destructive routes accept methods/content types without a shared gate.

EVIDENCE: cookie at `src/auth/session.ts:291-299`; no Origin/Referer/CSRF check in the catch-all router.

ATTACK / FAILURE SCENARIO: A future endpoint becomes form-compatible, a browser policy exception applies, or same-site sibling content is compromised and can submit authenticated state changes.

IMPACT: Authenticated actions performed without user intent, potentially including privileged actions.

LIKELIHOOD: Low today for cross-site form attacks; material defense gap because one central fix protects all future routes.

RECOMMENDED FIX: Enforce allowed Origin/Host on every unsafe method before routing; retain SameSite and add a CSRF token if cross-origin trusted clients are introduced.

REGRESSION TEST REQUIRED: Missing/foreign Origin rejected on unsafe methods; same-origin accepted; GET/HEAD unaffected; local-development behavior explicit.

ESTIMATED FIX COMPLEXITY: Small
BREAKING-CHANGE RISK: Low

### M-02

ID: M-02
CATEGORY: Support mode / operational safety
TITLE: Support mode defaults to write access while authorization comments describe read-only default
SEVERITY: MEDIUM
CONFIDENCE: CONFIRMED

AFFECTED FILES: `src/auth/session.ts`, `src/api.ts`, `components/Shell.tsx`
AFFECTED FUNCTIONS/ROUTES: `beginSupport`; `POST /api/admin/clubs/:id/support`

DESCRIPTION: `beginSupport(..., readOnly=false)` sets write access immediately, and the route passes `body.readOnly === true`. Comments above `atLeast` and the support route say observation/read-only is the default. The code, session documentation and UI policy are inconsistent.

EVIDENCE: `src/auth/session.ts:179-198`; `src/api.ts:87-108,3001-3024`.

ATTACK / FAILURE SCENARIO: An operator intending to inspect a club enters support normally and accidentally modifies tenant data; the action is audited but not prevented.

IMPACT: Unauthorized-by-intent customer data changes and support-policy breach.

LIKELIHOOD: Moderate operational likelihood; requires Superadmin.

RECOMMENDED FIX: Make read-only the default and require explicit, step-up-protected write escalation; align comments/UI/tests to one policy.

REGRESSION TEST REQUIRED: Default entry cannot mutate; explicit escalation can; expiration removes scope; every write is audited.

ESTIMATED FIX COMPLEXITY: Small
BREAKING-CHANGE RISK: Medium

### M-03

ID: M-03
CATEGORY: Durable Objects / deployment safety
TITLE: Durable Object migrations are multi-statement and non-transactional
SEVERITY: MEDIUM
CONFIDENCE: HIGH CONFIDENCE

AFFECTED FILES: `src/club/club-database.ts`, `src/club/schema.ts`
AFFECTED FUNCTIONS/ROUTES: constructor, `migrate`

DESCRIPTION: Each statement is executed sequentially and the version row is inserted afterward, without `transactionSync`. A failure can leave half a migration applied but no version marker. Retry safety depends on each statement being independently idempotent; `ALTER TABLE ADD COLUMN` and table-rebuild migrations are not universally retry-safe.

EVIDENCE: `src/club/club-database.ts:25-53`; migrations 3-8 in `src/club/schema.ts` include rebuilds and ALTER operations.

ATTACK / FAILURE SCENARIO: Deployment reaches a club whose migration fails mid-sequence due to runtime/limit/schema drift. That club remains unavailable and retries may fail on already-added columns.

IMPACT: Per-club outage or schema inconsistency introduced during deployment.

LIKELIHOOD: Moderate over repeated production migrations.

RECOMMENDED FIX: Apply each migration and its version marker inside one synchronous storage transaction; add migration-from-every-supported-version tests and recovery guidance.

REGRESSION TEST REQUIRED: Fault injection after every statement; rollback leaves old version intact; retry succeeds; all historical versions reach latest.

ESTIMATED FIX COMPLEXITY: Medium
BREAKING-CHANGE RISK: High

### M-04

ID: M-04
CATEGORY: R2 / data integrity
TITLE: Cross-store uploads can create orphaned files or stale metadata
SEVERITY: MEDIUM
CONFIDENCE: CONFIRMED

AFFECTED FILES: `src/api.ts`
AFFECTED FUNCTIONS/ROUTES: branding, member photo/document, billing proof and attachment uploads

DESCRIPTION: R2 and D1/DO writes cannot be atomic. Some routes clean up a new object when metadata creation fails (messaging), but others do not. Billing proof replacement also does not delete the prior file after changing `file_key`.

EVIDENCE: messaging compensates at `src/api.ts:697-710`; member upload sequences at `:1862-1975`; proof upload at `:2493-2539`; organization deletion omits messaging/proof prefixes at `:2427-2436`.

ATTACK / FAILURE SCENARIO: R2 upload succeeds and D1/DO update fails, leaving sensitive unreferenced content. Repeated proof replacement accumulates prior proofs. Metadata can also point to a missing file if later deletion succeeds while metadata cleanup fails.

IMPACT: Privacy retention failures, storage growth and broken downloads.

LIKELIHOOD: Moderate over time and transient failures.

RECOMMENDED FIX: Standardize staged upload/commit/compensation, retain previous key until commit, enqueue/reconcile orphan cleanup, and enumerate every prefix during tenant deletion.

REGRESSION TEST REQUIRED: R2 failure, metadata failure and previous-file delete failure for every file type; reconciliation identifies only true orphans.

ESTIMATED FIX COMPLEXITY: Medium
BREAKING-CHANGE RISK: Medium

### M-05

ID: M-05
CATEGORY: SaaS authorization / business integrity
TITLE: SaaS expiry and plan limits are not enforced server-side
SEVERITY: MEDIUM
CONFIDENCE: CONFIRMED

AFFECTED FILES: `src/control-plane/schema.sql`, `components/Shell.tsx`, `src/api.ts`
AFFECTED FUNCTIONS/ROUTES: all club APIs; signup/create club

DESCRIPTION: `max_members`, `max_branches`, `max_staff`, plan and trial dates are stored but never checked. Expired billing triggers a best-effort client redirect only, and comments explicitly keep APIs open.

EVIDENCE: fields at `src/control-plane/schema.sql:34-43`; redirect at `components/Shell.tsx:160-178`; no matching limit checks in `src/api.ts`.

ATTACK / FAILURE SCENARIO: A club bypasses UI navigation and continues full API use after expiry or beyond negotiated limits.

IMPACT: Revenue leakage and inconsistent entitlement behavior; not tenant escape.

LIKELIHOOD: High if commercial limits are promised.

RECOMMENDED FIX: Decide grace/read-only policies, then enforce entitlements centrally server-side with explicit exceptions for billing/account/export and support.

REGRESSION TEST REQUIRED: Expired/grace/active states; each resource cap; support access; no lockout from payment/account routes.

ESTIMATED FIX COMPLEXITY: Medium
BREAKING-CHANGE RISK: High

### M-06

ID: M-06
CATEGORY: Authentication / abuse prevention
TITLE: Rate limiting is D1-count based, non-atomic and unavailable when client IP is absent
SEVERITY: MEDIUM
CONFIDENCE: HIGH CONFIDENCE

AFFECTED FILES: `src/api.ts`, `src/control-plane/schema.sql`
AFFECTED FUNCTIONS/ROUTES: `throttled`, `recordAttempt`, signup/login

DESCRIPTION: Limits count previous rows and record the current attempt separately. Concurrent attempts can all observe a count below threshold. IP-based protections disappear if `CF-Connecting-IP` is unavailable and the controlled local fallback is disabled. Identifier limits remain, but distributed identifier attacks and D1 write load remain possible.

EVIDENCE: `src/api.ts:165-216,559-577`; `login_attempts` indexes at `src/control-plane/schema.sql:116-125`.

ATTACK / FAILURE SCENARIO: Parallel login attempts race the count or distribute across IPs; each password attempt also writes D1, increasing cost during abuse.

IMPACT: Weaker brute-force resistance and D1 resource pressure.

LIKELIHOOD: Moderate for deliberate attacks.

RECOMMENDED FIX: Use an atomic rate-limit primitive/counter strategy appropriate to Workers, retain identifier+IP dimensions, cap global abuse, and define fail-safe behavior when D1 is degraded.

REGRESSION TEST REQUIRED: Parallel threshold test; distributed IP/one identifier; one IP/many identifiers; D1 failure policy; successful login reset.

ESTIMATED FIX COMPLEXITY: Medium
BREAKING-CHANGE RISK: Low

### M-07

ID: M-07
CATEGORY: Performance / D1 cost
TITLE: Every authenticated API request writes session last-seen state to D1
SEVERITY: MEDIUM
CONFIDENCE: CONFIRMED

AFFECTED FILES: `src/auth/session.ts`
AFFECTED FUNCTIONS/ROUTES: `resolveSession`; all authenticated APIs

DESCRIPTION: Session resolution performs a D1 UPDATE on every request. Messaging polling amplifies this. An open conversation polls every eight seconds and causes multiple authenticated requests, each writing the same session row.

EVIDENCE: `src/auth/session.ts:147-151`; Messaging calls and polling at `app/messagerie/page.tsx:101-150`.

ATTACK / FAILURE SCENARIO: Many active clients create a steady D1 write workload unrelated to business changes. D1 latency/outage then affects all authenticated requests, even tenant-local reads.

IMPACT: Cost, contention and broader login/application blast radius.

LIKELIHOOD: High as concurrent usage grows.

RECOMMENDED FIX: Touch last-seen only after a minimum interval using a conditional update or coarser heartbeat; avoid writes for each poll while preserving idle timeout accuracy.

REGRESSION TEST REQUIRED: Requests within touch window do not write; idle expiry remains correct; concurrent touches cannot extend revoked sessions.

ESTIMATED FIX COMPLEXITY: Small
BREAKING-CHANGE RISK: Low

### M-08

ID: M-08
CATEGORY: Messaging performance / consistency
TITLE: Active messaging polling over-fetches while conversation unread state remains stale
SEVERITY: MEDIUM
CONFIDENCE: CONFIRMED

AFFECTED FILES: `app/messagerie/page.tsx`, `src/club/club-database.ts`, `src/api.ts`
AFFECTED FUNCTIONS/ROUTES: conversation load/history/info/read; support and announcement polling

DESCRIPTION: Every eight seconds an active club conversation requests history and group info, then posts read state—three API/auth paths. The conversation navigation list itself is not refreshed by that interval, so other-conversation unread counts can remain stale. The latest 40 messages are repeatedly transferred.

EVIDENCE: `app/messagerie/page.tsx:101-150`; history limit at `src/api.ts:734-745`.

ATTACK / FAILURE SCENARIO: 1,000 simultaneously open club chats imply roughly 375 authenticated API requests/second by architectural calculation (3 requests / 8 seconds / client), before support and announcement traffic. This is an inference, not a benchmark.

IMPACT: DO/D1/Worker cost and latency while still delivering imperfect unread synchronization.

LIKELIHOOD: Low now, high at large customer concurrency.

RECOMMENDED FIX: Poll a lightweight delta/list endpoint with `after` cursor and update unread/navigation in one response; pause when tab hidden; apply backoff/jitter. Evaluate push only after measuring the optimized polling model.

REGRESSION TEST REQUIRED: Delta cursor; unread from inactive conversations; hidden-tab pause; network backoff; no duplicate messages.

ESTIMATED FIX COMPLEXITY: Medium
BREAKING-CHANGE RISK: Medium

### M-09

ID: M-09
CATEGORY: Frontend security headers
TITLE: Global security headers omit CSP, HSTS, COOP and cross-origin resource policy
SEVERITY: MEDIUM
CONFIDENCE: CONFIRMED

AFFECTED FILES: `next.config.ts`, `app/layout.tsx`, `app/globals.css`
AFFECTED FUNCTIONS/ROUTES: all pages

DESCRIPTION: X-Frame-Options, nosniff, Referrer-Policy and Permissions-Policy are present. There is no page CSP, HSTS, COOP or CORP. Inline styles, a constant inline skin script and Google Fonts require deliberate CSP design.

EVIDENCE: `next.config.ts:10-26`; inline script `app/layout.tsx:21-39`; external font import `app/globals.css:1`.

ATTACK / FAILURE SCENARIO: A future injection bug has fewer browser containment barriers; transport downgrade protection relies only on hosting defaults.

IMPACT: Reduced defense in depth against XSS/clickjacking-adjacent and cross-origin attacks.

LIKELIHOOD: Depends on another bug; current dynamic content is rendered safely and uploaded SVG is rejected.

RECOMMENDED FIX: Deploy report-only CSP first, move/nonce the inline script, enumerate required font/map/image/connect sources, then enforce CSP and add HSTS/COOP/CORP where deployment domains permit.

REGRESSION TEST REQUIRED: Header assertions on pages/API/files; CSP browser smoke test across map, fonts, uploads and messaging.

ESTIMATED FIX COMPLEXITY: Medium
BREAKING-CHANGE RISK: Medium

### M-10

ID: M-10
CATEGORY: Account lifecycle
TITLE: Staff provisioning and recovery do not establish secure account ownership
SEVERITY: MEDIUM
CONFIDENCE: CONFIRMED

AFFECTED FILES: `src/api.ts`, `app/staff/page.tsx`
AFFECTED FUNCTIONS/ROUTES: `POST /api/staff`; login/password routes

DESCRIPTION: New staff receive a manually communicated provisional password displayed as text, with no forced change, expiry, activation token or email verification. If the email already belongs to a global user, the supplied password is ignored and the account is linked to the club without the user accepting. No password recovery exists.

EVIDENCE: `src/api.ts:2069-2101`; `app/staff/page.tsx:174-229`; only authenticated password change exists at `src/api.ts:2141-2160`.

ATTACK / FAILURE SCENARIO: A temporary password is retained/shared insecurely, or an admin links an existing global account to a club without informed acceptance. A locked-out owner requires out-of-band database/operator intervention.

IMPACT: Account takeover risk and operational lockout; confusing multi-club memberships.

LIKELIHOOD: Moderate in ordinary operations.

RECOMMENDED FIX: Use expiring single-use invitations/activation, verify email ownership, require password establishment/change, add secure recovery and notify existing users of membership additions.

REGRESSION TEST REQUIRED: Expired/reused invite; existing-user consent; forced password change; recovery revokes sessions; no account-enumerating response.

ESTIMATED FIX COMPLEXITY: Large
BREAKING-CHANGE RISK: Medium

### M-11

ID: M-11
CATEGORY: Observability / reliability
TITLE: Production failures cannot be correlated to a request, tenant or dependency phase
SEVERITY: MEDIUM
CONFIDENCE: CONFIRMED

AFFECTED FILES: `src/api.ts`, `worker.ts`, `wrangler.jsonc`
AFFECTED FUNCTIONS/ROUTES: global API catch, cron, all critical workflows

DESCRIPTION: Cloudflare observability is enabled, and exceptions are logged with `console.error`, but there are no request/correlation IDs, structured event schema, route/tenant-safe tags, latency metrics, dependency timing, failure counters or reconciliation alerts.

EVIDENCE: generic catch at `src/api.ts:3098-3104`; cron log at `:3215-3217`; `observability.enabled` in `wrangler.jsonc`.

ATTACK / FAILURE SCENARIO: A proof upload or deletion phase fails. Operators see a generic client 500 and possibly an unstructured error but cannot answer which step committed, which tenant was affected or whether retries are safe.

IMPACT: Longer outages, unsafe manual recovery and undetected partial failure.

LIKELIHOOD: Certain during real production faults.

RECOMMENDED FIX: Generate/request a correlation ID, emit structured allowlisted logs for route, status, duration, dependency and hashed/internal tenant ID; add cron summaries, migration failures, orphan reconciliation and critical-action alerts. Never log message bodies, identity numbers, tokens or documents.

REGRESSION TEST REQUIRED: Correlation header/log presence; secret/PII redaction; simulated D1/DO/R2 failures produce actionable phase codes.

ESTIMATED FIX COMPLEXITY: Medium
BREAKING-CHANGE RISK: Low

### M-12

ID: M-12
CATEGORY: Database performance
TITLE: Several growing-history queries use bounded-but-nonpageable scans or unindexed expressions
SEVERITY: MEDIUM
CONFIDENCE: HIGH CONFIDENCE

AFFECTED FILES: `src/club/club-database.ts`, `src/control-plane/schema.sql`, `src/api.ts`
AFFECTED FUNCTIONS/ROUTES: payment listing/reporting, outstanding, support messages, Superadmin supervision/billing

DESCRIPTION: Payments are capped at 500 without cursor pagination; filters use `strftime()` on `paid_at`, preventing normal date-index use. Support messages return a fixed recent list without cursor UI. Member listing uses OFFSET, which grows linearly. Dashboard/report queries repeatedly scan tenant tables by status/date.

EVIDENCE: `listPayments` at `src/club/club-database.ts:712-746`; payment indexes in `src/club/schema.ts`; member OFFSET at `src/club/club-database.ts:295-337`; support message schema/index at `src/control-plane/schema.sql:326-337`.

ATTACK / FAILURE SCENARIO: A long-lived 5,000-member club with years of payments experiences increasingly expensive accounting requests and incomplete histories.

IMPACT: Higher DO CPU, latency and incomplete operator views.

LIKELIHOOD: High with customer longevity/scale.

RECOMMENDED FIX: Use range predicates and cursor pagination; inspect actual query plans before adding targeted composite indexes such as payment date/branch patterns. Preserve bounded response sizes.

REGRESSION TEST REQUIRED: Query-plan assertions or representative fixtures; stable pagination; complete totals independent of page; response limits.

ESTIMATED FIX COMPLEXITY: Medium
BREAKING-CHANGE RISK: Medium

## 7. Low Findings

### L-01

ID: L-01
CATEGORY: Authentication privacy
TITLE: Public signup confirms whether an email already exists
SEVERITY: LOW
CONFIDENCE: CONFIRMED

AFFECTED FILES: `src/api.ts`
AFFECTED FUNCTIONS/ROUTES: `POST /api/auth/signup`

DESCRIPTION: Existing email returns 409 with a specific message. The code recognizes the oracle and limits it, but it remains enumerable at the allowed rate.

EVIDENCE: `src/api.ts:3231-3263`.

ATTACK / FAILURE SCENARIO: An attacker tests likely operator emails and learns account presence.

IMPACT: Privacy/reconnaissance aid.

LIKELIHOOD: Moderate; rate limited and no signup UI exists.

RECOMMENDED FIX: Return a uniform accepted response and use email verification/activation.

REGRESSION TEST REQUIRED: Existing/new email response equivalence; no duplicate account.

ESTIMATED FIX COMPLEXITY: Medium
BREAKING-CHANGE RISK: Medium

### L-02

ID: L-02
CATEGORY: Session management
TITLE: Users can view but cannot revoke individual sessions themselves
SEVERITY: LOW
CONFIDENCE: CONFIRMED

AFFECTED FILES: `app/account/page.tsx`, `src/api.ts`
AFFECTED FUNCTIONS/ROUTES: `/api/account/sessions`

DESCRIPTION: The account page lists sessions, but only password change revokes other sessions; individual self-service revocation is absent.

EVIDENCE: `src/api.ts:2141-2177`; `app/account/page.tsx:42-154`.

ATTACK / FAILURE SCENARIO: A user spots an unknown session but cannot terminate it without changing password.

IMPACT: Slower stolen-session response.

LIKELIHOOD: Low.

RECOMMENDED FIX: Add session IDs safe for display and self-revocation; protect current-session behavior.

REGRESSION TEST REQUIRED: User can revoke own other session only; cross-user IDs rejected.

ESTIMATED FIX COMPLEXITY: Small
BREAKING-CHANGE RISK: Low

### L-03

ID: L-03
CATEGORY: File security
TITLE: Upload validation trusts declared MIME and does not inspect file signatures
SEVERITY: LOW
CONFIDENCE: CONFIRMED

AFFECTED FILES: `src/api.ts`
AFFECTED FUNCTIONS/ROUTES: all upload routes

DESCRIPTION: MIME allowlists, size limits, SVG rejection, nosniff and disposition controls are good, but content bytes are not magic-byte validated. ZIP/Office/text attachments are intentionally downloadable.

EVIDENCE: `src/api.ts:442-492,678-730`.

ATTACK / FAILURE SCENARIO: An authenticated user labels arbitrary bytes as an allowed type and shares the file; the recipient may execute/open it locally.

IMPACT: Limited stored-malware/social-engineering vector, not same-origin code execution under current headers.

LIKELIHOOD: Low.

RECOMMENDED FIX: Verify signatures for rendered images/PDF; force attachment for risky types; consider malware scanning based on threat model.

REGRESSION TEST REQUIRED: MIME/signature mismatch rejected; safe formats preserved.

ESTIMATED FIX COMPLEXITY: Medium
BREAKING-CHANGE RISK: Low

### L-04

ID: L-04
CATEGORY: Audit completeness
TITLE: Some privileged mutations are not recorded in platform audit
SEVERITY: LOW
CONFIDENCE: CONFIRMED

AFFECTED FILES: `src/api.ts`
AFFECTED FUNCTIONS/ROUTES: location changes, invoice deletion/unpaid, bank details, event handling and selected billing updates

DESCRIPTION: Important actions such as support entry, blocklist and invoice paid are audited, but audit coverage is inconsistent across Superadmin writes.

EVIDENCE: compare audited routes at `src/api.ts:2924-2988,3020-3022` with unaudited location/bank/invoice delete paths at `:2360-2387,2848-2858,2930-2939`.

ATTACK / FAILURE SCENARIO: A privileged operator changes billing configuration or deletes an invoice and the action cannot be attributed through the platform audit table.

IMPACT: Reduced accountability and incident reconstruction.

LIKELIHOOD: Moderate operationally.

RECOMMENDED FIX: Centralize privileged-action audit and define mandatory event types/result state.

REGRESSION TEST REQUIRED: Every Superadmin mutation emits exactly one durable audit record, including failed destructive initiation where appropriate.

ESTIMATED FIX COMPLEXITY: Small
BREAKING-CHANGE RISK: Low

### L-05

ID: L-05
CATEGORY: Data correctness
TITLE: COALESCE-based updates cannot intentionally clear several nullable fields
SEVERITY: LOW
CONFIDENCE: CONFIRMED

AFFECTED FILES: `src/club/club-database.ts`, `src/api.ts`
AFFECTED FUNCTIONS/ROUTES: member and group updates

DESCRIPTION: `undefined` and explicit `null` collapse to SQL NULL, then `COALESCE(?, existing)` retains the old value. Email, branch, discipline, grade, dates, notes and group descriptions therefore cannot always be cleared through the generic update.

EVIDENCE: `src/club/club-database.ts:396-435,2168-2173`.

ATTACK / FAILURE SCENARIO: An operator removes an obsolete email/note/assignment, sees apparent success, but sensitive/stale data remains.

IMPACT: Data-quality and privacy-retention defect.

LIKELIHOOD: Moderate.

RECOMMENDED FIX: Distinguish omitted field from explicit null and write dynamic allowlisted SET clauses or presence flags.

REGRESSION TEST REQUIRED: Omitted retains; explicit null clears; empty-string policy explicit.

ESTIMATED FIX COMPLEXITY: Medium
BREAKING-CHANGE RISK: Medium

### L-06

ID: L-06
CATEGORY: Test reliability
TITLE: Full integration suite can lose its shared local Worker and cascade false failures
SEVERITY: LOW
CONFIDENCE: CONFIRMED

AFFECTED FILES: `test/helpers.mjs`, integration tests, package scripts
AFFECTED FUNCTIONS/ROUTES: shared test Worker lifecycle

DESCRIPTION: During this audit, many tests passed, one layout test ran for ~37 seconds, then the Worker became unreachable and all following tests failed immediately with ECONNREFUSED. Sequential tests sharing one server turn one infrastructure death into dozens of misleading feature failures.

EVIDENCE: observed `npm.cmd test` output on 2026-08-18; server helper is centralized in `test/helpers.mjs`.

ATTACK / FAILURE SCENARIO: CI reports broad product regression when the harness process died; engineers cannot distinguish app failure from test infrastructure failure.

IMPACT: False confidence when tests are skipped/retried and wasted debugging time.

LIKELIHOOD: Demonstrated locally.

RECOMMENDED FIX: Capture Worker stdout/stderr, fail fast on process exit with the root cause, use per-suite lifecycle or health restart policy, and publish a machine-readable summary.

REGRESSION TEST REQUIRED: Intentional Worker crash is classified once; remaining tests are cancelled, not reported as feature failures.

ESTIMATED FIX COMPLEXITY: Small
BREAKING-CHANGE RISK: Low

### L-07

ID: L-07
CATEGORY: Dependency/privacy surface
TITLE: Browser pages depend on external fonts and map tiles without an explicit availability/privacy policy
SEVERITY: LOW
CONFIDENCE: CONFIRMED

AFFECTED FILES: `app/globals.css`, `components/ClubsMap.tsx`
AFFECTED FUNCTIONS/ROUTES: all styled pages; Superadmin supervision map

DESCRIPTION: Outfit is imported from Google Fonts and map tiles from OpenStreetMap. Failure degrades presentation/map, and requests disclose client IP/user-agent to those services.

EVIDENCE: `app/globals.css:1`; `components/ClubsMap.tsx:107-108`.

ATTACK / FAILURE SCENARIO: Third-party outage or blocking changes typography/map availability; external service receives operator network metadata.

IMPACT: Limited availability/privacy impact.

LIKELIHOOD: Moderate.

RECOMMENDED FIX: Decide and document whether to self-host fonts/proxy tiles or accept graceful degradation; do not couple club operations to map availability.

REGRESSION TEST REQUIRED: Application remains usable with third-party requests blocked.

ESTIMATED FIX COMPLEXITY: Small
BREAKING-CHANGE RISK: Low

## 8. Security Findings

Security priorities are H-01, H-03, M-01, M-02, M-06, M-09 and M-10. No SQL injection was found: dynamic WHERE/IN construction builds only SQL fragments controlled by code, with one `?` placeholder per user value (`messagingPeople`, member/payment filters). No user-controlled table or column names were found.

No exploitable XSS was confirmed. React escapes member/message/group/announcement strings. `dangerouslySetInnerHTML` is used for two compile-time constants: the skin bootstrap and an HTML comment. Message links are extracted only with an `https?://` regex. SVG uploads are rejected and file responses set `nosniff`; branding responses additionally use a sandbox CSP.

No SSRF path was found. The server does not fetch user-provided URLs. Redirect destinations are fixed application paths. File keys are server-built and tenant ownership is validated before R2 retrieval.

## 9. Multi-Tenant Isolation Audit

**TENANT ISOLATION: PASS WITH ISSUES**

Club-to-club isolation is well designed and existing tests demonstrate negative member, document, photo, finance, theme and messaging cases. `clubOf()` derives the DO name from `activeScope(principal)`, and ordinary client identifiers cannot select another DO. Superadmin-only endpoints that accept organization IDs verify the platform flag and, where relevant, organization existence.

Specific verdicts:

| Path | Verdict |
|---|---|
| Club A -> Club B member/payment/grade/branch/discipline/accounting | Pass through separate DO selection |
| Club A -> Club B member files | Pass; metadata lookup occurs in Club A DO before R2 get |
| Club A -> Club B messaging | Pass; participant discovery is D1 org-scoped and conversation is tenant-local |
| Club A -> Club B support data | Pass; non-platform callers are forced to principal.orgId |
| Club A -> arbitrary R2 key | Pass on reviewed routes; branding key prefix and metadata ownership are checked |
| Client -> foreign DO | Pass for club APIs; only Superadmin helper accepts client organization ID |
| Branch A staff -> Branch B data in same club | **Fail: H-01** |

## 10. Authentication Audit

Well designed:

- PBKDF2-SHA256 with random 16-byte salt, 200,000 total chained work and workerd-compatible per-call ceiling.
- Constant-time comparison.
- 256-bit opaque session token; only SHA-256 hash stored.
- Strict HTTPS `__Host-` cookie with HttpOnly, Secure, SameSite=Lax and Path=/.
- 12-hour absolute and 60-minute idle expiry.
- Membership/user/organization status revalidated on every request.
- Unknown-user dummy hash reduces timing disclosure.
- Password change verifies current password and revokes other sessions.
- Logout destroys server state.
- Known-IP/security-event tracking and IP blocklist.

Gaps: H-03, M-06, M-07, M-10, L-01 and L-02. Session tokens are not rotated on privilege escalation/support-write activation. Step-up authentication should rotate or bind a short-lived privileged grant.

## 11. Authorization Matrix

`S` means server-derived active club; `P` means Superadmin organization parameter after platform check; `B/D` currently not enforced unless noted.

| Endpoint group | Minimum role | Tenant | B/D scope | Support | Superadmin | Access |
|---|---|---|---|---|---|---|
| `/api/me`, account profile/password/sessions | authenticated | session user | N/A | own session | own account | R/W |
| branches/disciplines GET | viewer | S | No | admin-equivalent read | via support/P helper | R |
| branches/disciplines POST/PATCH/DELETE, ladders | admin | S | No | write flag | P routes available | W |
| setup/status, dashboard, alerts, branding GET | viewer | S | No | read | via support | R |
| layout GET | viewer | S | No | read | via support | R |
| layout PUT/DELETE | admin; non-dashboard platform-only exception | S | No | write flag | limited | W |
| members GET | viewer | S | client discipline filter only | read | via support | R |
| members create/update/archive | staff | S | **No: H-01** | write flag | via support | W |
| member photo GET | viewer | S metadata | **No** | read | via support | R |
| member photo upload/delete | staff | S metadata | **No** | write flag | via support | W |
| member ID document GET | staff | S metadata | **No** | read | via support | R |
| member ID document upload | staff; delete admin | S | **No** | write flag | via support | R/W |
| import | admin | S | No | write flag | via support | W |
| renew subscription/insurance | staff | S | **No** | write flag | via support | W |
| payments GET / finance GET | admin | S | client branch filter only | read | via support | R |
| payment POST | staff | S | **No** | write flag | via support | W |
| payment reverse, prices PUT | admin | S | **No** | write flag | via support | W |
| grades GET | viewer | S | client discipline filter only | read | via support | R |
| grade schedule/decision | staff | S | **No** | write flag | via support | W |
| grade settings/correction | admin | S | **No** | write flag | via support | W |
| staff GET/POST/PATCH/DELETE | admin | S via D1 org condition | N/A | write flag where mutation | via support admin rank | R/W |
| internal messaging participants/conversations/messages/groups | staff | S/member mode only | No | explicitly denied | platform has no private access | R/W |
| support thread/messages | owner/admin or platform | S for club, P for platform | N/A | separate system | all orgs | R/W |
| announcements GET/read | authenticated | visible global rows | N/A | allowed | manage flag | R/W-read |
| announcements create/update | platform only | global | N/A | N/A | required | W |
| subscription GET/proof PUT | viewer/admin | S and invoice org match | N/A | write flag | separate admin routes | R/W |
| `/api/admin/*` clubs/billing/security/support/location | platform only | P | N/A | manages support state | required | R/W |

## 12. Superadmin Audit

All reviewed platform routes contain explicit `principal.isPlatformAdmin` checks or pass through `clubAsPlatformAdmin`. Superadmin access is not inferred from a club role. Private club messaging is explicitly denied in support mode. Major concerns are H-03, H-02, M-02 and L-04.

Actions warranting step-up authentication: club deletion, support-write escalation, billing proof acceptance/rejection, invoice deletion/paid reversal, IP block/unblock, user-session revocation, bank details and announcement publication.

## 13. Support Mode Audit

- Scope is attached to the platform session, not impersonated membership.
- Only platform administrators receive live support scope.
- Support expiry is checked during session resolution.
- Support is limited to admin rank, not owner.
- Private club Messaging is explicitly denied.
- Writes call `atLeast(..., true)` and are rejected if `supportWrite` is false.
- Entry/exit/escalation and many support writes are audited and visible to the club.

Verdict: technically bounded, but M-02 must align default behavior with the stated read-only policy. The constant `SUPPORT_WRITE_TTL_MINUTES` is declared but unused; write mode currently shares/extends the 30-minute support expiration rather than the apparent intended 10-minute duration (`src/auth/session.ts:176-208`).

## 14. API Security

- JSON body size is capped at 64 KB before parsing.
- Upload lengths are checked both from header and actual byte length.
- Input length/date/enum checks are widespread.
- Generic 500 responses do not expose stack traces; internal errors are logged.
- Parameterized SQL is consistently used.
- Route identifiers remain untrusted but are constrained by selected DO or D1 org predicates.
- Unknown HTTP paths return 404; all non-public routes resolve a valid session first.

Gaps: explicit CSRF origin gate (M-01), idempotency (H-04), branch/discipline authorization (H-01), privileged step-up (H-03), and rate-limit atomicity (M-06).

## 15. R2 / File Security

Strengths:

- Bucket is private and keys are never used as public URLs.
- Authorization precedes message upload; reads recheck conversation membership.
- Member files are found through tenant DO metadata.
- Billing proof invoice is constrained by organization.
- Branding proxy enforces `isOwnLogoKey`.
- SVG is rejected; rendered responses use `nosniff`; branding uses sandbox CSP.
- Size limits exist and actual lengths are rechecked.

Gaps: M-04, L-03 and H-02. Identity documents use `Content-Disposition: inline`; sandbox CSP is not set on that response, though allowed types and nosniff reduce browser execution. A conservative policy would use `attachment` for non-image documents or an isolated viewer origin.

## 16. Database Integrity

Strengths:

- Primary/foreign keys, role/status CHECKs and relevant uniqueness constraints are common.
- Money is stored in integer cents.
- Payment reversal is append-only and locally transactional.
- Member/payment/grade actions usually write their audit event in the same DO transaction.
- D1 batches group same-database account/membership changes.
- Tenant timestamps use consistent UTC ISO-second forms.

Risks:

- H-04: no write idempotency/business uniqueness.
- M-03: migration partial application.
- H-02/M-04: cross-store partial completion.
- L-05: explicit null cannot clear fields.
- `archiveMember` records an audit event even if a nonexistent ID updates zero rows; several update methods do not assert affected-row existence.
- D1 `PRAGMA foreign_keys = ON` in a schema file is connection-sensitive; deletion wisely does not depend solely on cascades, but ordinary production migration/application behavior should verify FK enforcement at runtime.

## 17. Concurrency / Race Conditions

Durable Objects serialize calls per club, making local read-modify-write payment reversals, grade decisions and group admin counts safer. `transactionSync` correctly couples many local state/audit mutations.

Serialization does not solve:

- duplicate sequential/retried requests (H-04);
- cross-store R2/DO/D1 operations (H-02/M-04);
- D1 count-then-insert rate limiting (M-06);
- overlapping cron `NOT EXISTS` invoice creation without uniqueness;
- platform operations acting on the same invoice/proof without conditional state transitions;
- Superadmin deletion racing an in-flight tenant operation.

## 18. Performance Audit

### Database

- Per-club SQLite avoids global tenant predicates and cross-tenant scans.
- Dashboard consolidates many metrics into one DO RPC, but internally executes multiple full/partial queries.
- Member and payment response caps protect memory but currently truncate product behavior.
- Date expressions using `strftime` weaken index use; use normalized range boundaries.
- Offset pagination should become cursor pagination for members.
- D1 Superadmin overview correctly uses cached `org_stats` rather than waking all DOs on page load.

### API/browser

- Most parallelizable dashboard/accounting requests already use `Promise.all`.
- Every authenticated call performs D1 session lookup and last-seen write.
- Members, branches and disciplines are loaded together, followed by client filtering/sorting.
- Original member photos are used for 36-pixel thumbnails.
- Recharts and the very large global CSS/client pages add hydration/bundle cost; no bundle-analyzer measurement was run, so no numeric claim is made.

### Messaging

- History cursor design is sound and bounded.
- Active polling repeats whole latest pages and group info.
- Navigation unread state is not synchronized by active polling.
- Attachments are proxied through Worker/R2 on every view; private no-store behavior prevents unsafe shared caching but increases origin traffic.

## 19. Availability / Failure Analysis

| Workflow | What can fail / user experience | Data risk | Safe retry / recovery |
|---|---|---|---|
| Login | D1/PBKDF2 failure -> generic 500/network error | No credential corruption | Retry; D1 is mandatory SPOF |
| Member create/edit | DO failure -> generic 500 | Usually atomic local operation | Create is not idempotent; retry can duplicate |
| Renewal/payment | Lost response after DO commit | Duplicate expiry/payment | Not safe without idempotency |
| Refund | Local transaction protects inverse+audit; lost response | Second request rejected by existing reverse check | Generally safe after lookup, but client must reconcile 409 |
| Member upload | R2 or DO step fails | Orphan or missing metadata possible | Partial compensation inconsistent |
| Messaging text | DO failure/response loss | Duplicate message on retry; mentions not wrapped with message in explicit transaction | No idempotency |
| Messaging attachment | R2 then DO; code deletes new R2 object on DO error | Good compensation, but retry duplicates if commit response lost | Partially safe |
| Support message | D1 batch groups message/read/update | Duplicate on retry | D1 outage isolated from DO data but page unavailable |
| Club creation | D1 batch atomic; DO lazy | No partial DO provisioning | Retry constrained by unique slug/email; response loss requires lookup |
| Club deletion | DO -> R2 -> D1 -> audit | Catastrophic partial deletion | Unsafe; H-02 |
| Billing proof | R2 -> D1 | Orphan/new old proof leak | Retry can replace metadata; cleanup absent |
| Billing mutation | D1 operations | Duplicate invoices, state races | Not consistently safe |
| Cron | Purge failure aborts later stats/invoice work; per-club stat failure is isolated | Stale stats/invoice delay; overlapping issue can duplicate | Next cron retries, but invoice uniqueness absent |

Graceful degradation:

- R2 outage should not prevent member rows/accounting, but member list currently emits many R2 image requests; broken images should remain nonfatal.
- A single club DO failure affects that club, not other clubs.
- D1 outage affects authentication for every request and is the largest runtime SPOF.
- Cron failure leaves ordinary club operations intact; Superadmin cached stats become stale and invoices may be delayed.
- Support D1 failure should not affect tenant DO operations, but shared session D1 dependency still couples all authenticated access.
- Messaging tenant-DO failure should not affect accounting routes, subject to the same DO instance health; DO isolation is per club, not per module.

## 20. Cloudflare Architecture Audit

### D1

Appropriate for central identity/control-plane data. Risks are per-request session writes, abuse-attempt writes, non-atomic cross-service workflows and global authentication dependency. Queries are parameterized. Schema evolution uses a replayable SQL file rather than a versioned D1 migration chain, increasing deployment discipline requirements.

### Durable Objects

One SQLite DO per organization is a strong isolation and consistency boundary. `blockConcurrencyWhile` prevents requests during migration. Local transactions are used well. Risks are nontransactional migration steps, hot-club serialization and large synchronous analytical scans.

### R2

Private proxy model is correct. Missing thumbnail derivatives, lifecycle/reconciliation and complete deletion prefixes create cost/privacy risk.

### Workers/OpenNext

No accidental Node runtime API was found in request-path source; WebCrypto and Web APIs are used. `next.config.ts` imports `node:url`, but only during build/config and `nodejs_compat` is enabled. Build completed successfully. `global_fetch_strictly_public` is compatible with current external browser services; server does not make user-controlled fetches.

### Cron

Fifty stale clubs per five minutes supports approximately 1,000 clubs with a worst-case full refresh cycle around 100 minutes if every run completes and all clubs remain active; frequently stale clubs are prioritized. This is architectural arithmetic, not measured latency. Purge failure currently prevents stats and invoices in that invocation. Invoice uniqueness must be enforced.

### Cost risks

- D1 read+write for every authenticated request.
- 8-second Messaging polling.
- Original image transfer through Worker/R2.
- Cron DO wakeups.
- Full report queries in large hot-club DOs.
- Abuse attempts intentionally generating D1 writes.

## 21. Observability Audit

Current mechanisms: Cloudflare observability enabled, security-event tables, tenant/platform audit logs, generic exception logs and per-club cron failure log.

Missing answers:

- What failed? Only generic exception text, no standardized phase/error code.
- Which club? Sometimes org ID appears in cron logs, not ordinary API errors.
- Which request? No request/correlation ID.
- When? Cloudflare log timestamp only; application event structure absent.
- Why? Dependency timing and failure phase absent.
- How many users? No counters, service-level indicators or alert thresholds.

Do not log member names, phones, email, identity numbers, message bodies, tokens, password data or file content. Use internal IDs only where operationally necessary and protect log access.

## 22. Dependency Audit

`npm audit` reported zero known advisories on 2026-08-18. This is evidence about the current advisory database, not proof of absence of vulnerabilities.

- Production dependencies are small and purposeful: Next/React, Recharts, Leaflet, Lucide and clsx.
- Cloudflare/OpenNext/Wrangler are development/build dependencies but critical to deployment/runtime packaging.
- No ORM/auth SDK or unexpected server framework is installed.
- No confirmed exploitable or potentially relevant known advisory was found.
- Lockfile should remain mandatory in CI with reproducible install and advisory review.

## 23. Test Coverage Audit

Strong existing areas:

- Tenant isolation and ignored client org ID.
- Authentication crypto/workerd PBKDF2 ceiling.
- Login throttling and blocklist.
- Support-mode authorization.
- Superadmin boundaries.
- Payment reversal invariants.
- Member import validation.
- Member documents/photos and cross-club reads.
- Messaging cross-club membership, mentions, group admin, support and announcements.
- Grade invariants and correction rules.

Missing critical regression coverage:

- H-01 branch/discipline scope on every record type/file.
- H-02 failure injection/resumable deletion and all R2 prefixes.
- H-03 step-up/MFA because capability is absent.
- H-04 duplicate/lost-response/concurrent financial requests.
- H-05 201+ member end-to-end list/search/export and thumbnail transfer behavior.
- CSRF Origin tests.
- Migration fault/retry from every historical version.
- D1/R2/DO failure injection and reconciliation.
- Cron overlap and D1 purge failure isolation.
- Performance/load budgets and query-plan checks.
- Security-header browser tests.

False-confidence risk: the full test script shares a local Worker process. This audit observed cascading connection failures after that process died, so a long list of failed cases did not represent independent assertions.

## 24. Privacy / Sensitive Data Review

| Data | Storage | Access | Retention/deletion observations |
|---|---|---|---|
| User name/email/password hash | D1 users | self, club admins list staff, platform supervision | Orphan users deleted with club; no account self-delete policy |
| Member name/phone/email/birth date/notes | Club DO | viewer/staff according to route; branch scope unenforced | Member archival retains indefinitely |
| Member photo | R2 + DO key | viewer read; staff write | Explicit delete; archive retains |
| Identity document/number | R2 + DO fields | staff read/write; admin delete | Audited actions; no expiry/retention policy |
| Payment history | Club DO | admins read, staff create | Append-only reversal; retained with archived member |
| Internal messages/attachments | Club DO + R2 | active conversation members | No user deletion/retention UI; tenant deletion misses R2 prefix |
| Support messages | D1 | club owner/admin and platform | No retention policy |
| Billing proofs | R2 + D1 | owning club submission/platform review | Replacement/deletion cleanup incomplete |
| IP/user agent/session metadata | D1 | account session page/platform supervision | session purge; login attempts 30d; handled security events 90d |

No legal-compliance claim is made. Technical priorities are least-privilege scope enforcement, explicit retention schedules, complete resumable deletion and auditable access to identity documents/support mode.

## 25. Scalability Forecast

These are architectural inferences, not benchmark results.

### Members per club

| Scale | Expected behavior |
|---:|---|
| 100 | Current member UI should function; raw photos can still dominate load. DO analytics are modest. |
| 500 | UI shows only 200; search/export/count filters on the page are incomplete. Photo and client-state cost become material. |
| 1,000 | Same functional truncation. Full dashboard/accounting scans remain plausible but should be measured; OFFSET/page strategy required. |
| 5,000 | Current member operations are unsuitable. Payment history/report scans and serialized analytical work can contend with front-desk writes. |
| 10,000 | Requires server pagination/search/export, thumbnails, query-plan/index work and separation/scheduling of expensive analytical reads within the same tenant DO. The one-DO-per-club design remains viable only if individual request CPU/result sizes are bounded. |

### Number of clubs

| Scale | Expected behavior |
|---:|---|
| 10 | Cron can refresh all within one run; platform overview straightforward. |
| 100 | Two cron runs at 50/run for a full pass; still reasonable if DO calls are healthy. |
| 1,000 | At least 20 runs/~100 minutes for a full pass; platform stats may be substantially stale. Messaging/session D1 load, not tenant SQL isolation, becomes the common bottleneck. |

## 26. Failure Matrix

| Component | Failure | User impact | Data risk | Recovery | Severity |
|---|---|---|---|---|---|
| D1 | unavailable | All authentication/control-plane APIs fail | Usually none; partial D1 sequences possible | Provider recovery/retry | High operational |
| Club DO | one object unavailable | One club business operations fail | Local transaction usually protects state | Retry/provider recovery | Medium |
| R2 | unavailable | Images/docs/proofs/attachments fail | Upload workflows may orphan/stale metadata | Retry + reconciliation needed | Medium |
| Worker/OpenNext | timeout/crash | Request/network failure | Committed mutation may be retried/duplicated | Idempotency needed | High for money |
| Cron | fails | Stats stale; invoices delayed; purge delayed | Low immediately | Next run; alert required | Medium |
| Cron | overlaps | Mostly harmless stats; invoices can duplicate | Billing inconsistency | Unique constraint/idempotency | High |
| Browser/network | closes after commit | User sees failure | Duplicate retry | Request status/idempotency | High for money |
| Migration | fails mid-version | Club unavailable/schema drift | Partial schema | Transactional migration/recovery | Medium/High |
| Club deletion | fails after DO destroy | Active empty/corrupt tenant | Irreversible loss | No current safe recovery | High |
| Platform stats cache | stale | Superadmin sees old metrics | No tenant-data loss | Cron refresh | Low |
| Support subsystem | D1 queries fail | Support unavailable | No club DO corruption | D1 recovery | Low/Medium |
| External fonts/map | unavailable | Styling/map degradation | None | Browser retry/fallback | Low |

## 27. Prioritized Remediation Roadmap

### P0 — FIX BEFORE ANY NEW FEATURE

1. **Enforce membership branch/discipline scope** (H-01). Dependency: product decision on admin/owner and cross-branch permissions. Complexity: Large. Tests: full negative authorization matrix.
2. **Make tenant deletion resumable and complete** (H-02, M-04). Dependency: deletion/retention/backup policy. Complexity: Large. Tests: phase fault injection and every R2 prefix.
3. **Protect Superadmin with step-up/MFA** (H-03, M-02, L-04). Dependency: chosen MFA/recovery policy. Complexity: Large. Tests: privileged-session matrix/audit.
4. **Add idempotency to monetary/renewal operations** (H-04). Dependency: request-key storage and business uniqueness design. Complexity: Medium. Tests: concurrent/lost-response retries and cron overlap.

### P1 — FIX BEFORE PRODUCTION EXPANSION

1. Server-pagination/search/export and thumbnails (H-05, M-12). Complexity: Large.
2. Transactional DO migrations and migration matrix (M-03). Complexity: Medium; deploy carefully before further schema additions.
3. Explicit unsafe-method Origin validation (M-01). Complexity: Small.
4. Reduce D1 session write frequency (M-07) and optimize Messaging polling (M-08). Complexity: Medium.
5. Add request/phase observability and reconciliation telemetry (M-11, M-04). Complexity: Medium.
6. Enforce agreed SaaS entitlement policy (M-05). Complexity: Medium; business decision required.

### P2 — FIX SOON

1. Secure invitation, activation and recovery lifecycle (M-10, L-01, L-02). Complexity: Large.
2. Deploy CSP/HSTS and related headers safely (M-09). Complexity: Medium.
3. Make rate limiting atomic and abuse-efficient (M-06). Complexity: Medium.
4. Fix nullable clearing and affected-row validation (L-05). Complexity: Medium.
5. Complete privileged audit coverage (L-04). Complexity: Small.

### P3 — HARDENING / OPTIMIZATION

1. File signature validation/malware policy (L-03).
2. Stabilize test Worker lifecycle and add load/failure suites (L-06).
3. Decide external font/map privacy and graceful-degradation policy (L-07).
4. Measure query plans, DO CPU and bundle/hydration before further tuning.

## 28. Quick Wins

- Default support entry to read-only and use the intended shorter write TTL.
- Add a central same-origin check for unsafe methods.
- Touch `last_seen_at` only when sufficiently stale.
- Add missing R2 prefixes to deletion immediately, while the larger deletion state machine is designed.
- Add unique SaaS invoice period constraint with a safe duplicate-cleanup migration plan.
- Fail the test suite once with Worker stderr when the harness exits.
- Audit every Superadmin mutation through one helper.
- Stop asking for 500 members while returning 200; surface pagination/total explicitly until full redesign.

## 29. Things That Are Already Well Designed

- One server-selected SQLite Durable Object per club is a strong isolation boundary.
- Session organization is derived server-side and ordinary client org IDs are ignored.
- Custom authentication uses appropriate WebCrypto primitives, salts, opaque tokens and strict cookies.
- Membership and organization status are revalidated per request.
- Centralized authorization reduces route drift.
- SQL is parameterized; dynamic fragments are code-generated/allowlisted.
- Payment reversals are append-only and transactionally audited.
- Many DO mutations couple data and audit writes in `transactionSync`.
- Messaging checks conversation membership, same-club participant discovery and mention authorization.
- Support messaging is deliberately separate from private club messaging.
- R2 is private; file reads are proxied and authorization checked.
- SVG rejection, file-size checks, `nosniff`, response dispositions and branding sandbox CSP are solid controls.
- Cached platform metrics avoid N-club fan-out on every Superadmin page load.
- Per-club cron failures are caught so one bad tenant does not stop all later refreshes.
- Existing tests cover many important tenant, payment, grade, file, support and messaging invariants.

## 30. Final Verdict

**B — CONTINUE ONLY AFTER P0 FIXES**

The underlying architecture is defensible and no confirmed tenant escape or authentication bypass was found. However, intra-club authorization scope is currently unenforced, irreversible deletion cannot recover safely from partial failure, Superadmin compromise has catastrophic unchecked reach, and financial retries can duplicate state. Those issues should be stabilized before feature development resumes. The platform is not being classified D because the tenant boundary, cryptography, SQL handling and file authorization are materially sound; it is not being classified A because the P0 risks affect confidentiality, integrity and recoverability.
