# GymFlow AI Engineering Rules

This file is the single source of truth for every AI agent working in this repository. Read it before acting. Work only on the active GymFlow SaaS; never restore the removed mono-club application.

## Active architecture

- Runtime: Cloudflare Workers/workerd, Next.js 16.3, React 19.2, TypeScript, `@opennextjs/cloudflare`, and Wrangler.
- Control plane: Cloudflare D1 stores users, organizations/clubs, memberships, sessions, billing, security data, and platform settings.
- Tenant business data: one SQLite-backed Durable Object per club stores members, payments, attendance, grades, club settings, and other club-specific records.
- Files: Cloudflare R2.
- Data access: raw parameterized SQL. Do not introduce Prisma, Drizzle, Sequelize, TypeORM, or another ORM unless explicitly requested.
- Authentication: custom WebCrypto authentication using PBKDF2-SHA256 password derivation, opaque session tokens, SHA-256 server-side token hashes, secure cookies, and constant-time verification. Inspect `src/auth/` before changing authentication.
- Do not introduce JWT, NextAuth, Clerk, Supabase Auth, Lucia, or Supabase packages. The active SaaS does not use Supabase.

## Tenant isolation and authorization

Club isolation is a critical security boundary. Every club-scoped operation must validate the authenticated user, current organization membership, authorization level, and correct server-derived Durable Object selection. Never trust a client-provided club ID by itself. Club A must never read or mutate Club B data. Explicitly test negative cross-club cases when tenant-scoped behavior changes.

Use D1 only for control-plane concerns. Use the club Durable Object for tenant business data. Call out cross-storage consistency limitations. Use parameterized SQL only.

## Cloudflare compatibility

Do not introduce Node-only runtime APIs without verifying workerd/Cloudflare Workers compatibility. Check the installed Next.js 16 documentation under `node_modules/next/dist/docs/` before relying on changed framework behavior. Preserve the Worker entry point, bindings, Durable Object migrations, and OpenNext configuration.

## Safety

- Never push, merge, rebase, force-push, switch branches, deploy, or run production migrations automatically.
- Never use destructive Git resets or discard user work.
- Never expose or commit `.env*`, `.dev.vars`, credentials, tokens, or Cloudflare secrets.
- Do not add dependencies or redesign architecture unless the task requires it.
- Prefer Windows PowerShell-compatible commands and `npm.cmd`.
- Keep changes scoped. Inspect `git diff` and preserve unrelated work.

## Validation

Inspect `package.json` before choosing commands. Prefer targeted tests, then `npm.cmd run typecheck`, `npm.cmd run test:static`, and `npm.cmd run build` when warranted. Never hide failures or run remote database commands.

## Agent roles

- Orchestrator: a fresh Codex process creates/loads task state, sequences stages, classifies provider failures, enforces cycle limits, records state, and produces the final workflow status. It coordinates only and must never implement application source.
- Architect: one Nemotron 3.5 Lightning Free attempt performs read-only planning with a hard 120-second maximum; a helper-enforced timeout or clear provider/quota failure falls back immediately to a fresh read-only Codex Architect without retrying or polling OpenCode.
- Developer: a fresh Codex process that verifies the plan, implements the smallest coherent change, validates it, and writes `implementation.md`.
- Reviewer: an independent fresh read-only Codex process that challenges correctness, architecture, authorization, isolation, compatibility, SQL safety, and regression risk.
- Fixer: a fresh Codex process that fixes only concrete issues from the latest failing report and updates `implementation.md`.
- Tester: a fresh independent Codex process validates actual commands, feature tests, regressions, authorization, isolation, and database behavior without redesigning.
- Security Reviewer: a fresh independent read-only Codex process is the authoritative security gate for the changed attack surface, including authentication, authorization, IDOR, impersonation, isolation, D1/DO placement, SQL/XSS, R2, secrets, Superadmin/support-mode abuse, and privilege boundaries.
- Optional Security Second Opinion: one Nemotron 3.5 Lightning Free attempt may supplement Codex Security for high-risk tasks. It is non-authoritative, never retried, and never blocks on provider failure.
- Finalizer: one minimal-context Nemotron 3 Ultra Free attempt is the final gate; clear provider/quota/timeout failure falls back immediately to a fresh read-only Codex Finalizer.

Reviewer, Tester, Security Reviewer, and every Fixer must run in fresh Codex processes. Reviewer, Tester, and Security must not inherit the Developer's conversation context. Developer completion alone is never approval.

## File-based workflow and context efficiency

Task state lives in `.ai/tasks/TASK-<id>/` with `task.md`, `architecture.md`, `implementation.md`, `review.md`, `tests.md`, `security.md`, `final.md`, and `state.json`. Reports, not conversational memory, are the handoff contract.

Do not reread the whole repository at every stage:

- Architect: task plus relevant modules only.
- Developer: task, architecture, and relevant code.
- Reviewer: task, architecture, implementation report, and current diff.
- Tester: implementation, package scripts, targeted code, and failing output in an independent session.
- Security: changed attack surface and diff in an independent session.
- Finalizer: reports first; diff only if needed.

Correction limits are three review/fix cycles, three test/fix cycles, and three security/fix cycles. Each free-model stage gets one normal attempt only. Provider fallback is only for a deterministic helper-enforced `PROVIDER_TIMEOUT`, clear HTTP 429/502/503/504, upstream timeout, quota/rate-limit, unavailable-model/provider, insufficient-credit/token-quota, or temporarily unavailable failures. Local launcher/runtime failures are orchestration failures and do not automatically permit fallback. A blocked plan, failed review, failed tests, failed security review, architecture rejection, or invalid application code is a workflow result, not a provider failure.

Full mode is the default and required for auth, authorization, security, messaging/private communications, billing/payments, permissions, database/migrations, multi-tenancy, support mode, Superadmin, secrets, recovery, and large features. Fast mode is only for clearly low-risk work and runs Architect, Developer, Reviewer, and targeted Codex testing; it must refuse high-risk tasks.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
