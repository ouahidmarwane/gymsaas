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

- Orchestrator: creates the task workspace, sequences stages, enforces cycle limits, and records state. It does not implement source changes itself.
- Architect: read-only planning; identifies relevant files, D1 versus Durable Object placement, auth, tenant isolation, runtime impact, tests, risks, and unknowns.
- Developer: a fresh Codex process that verifies the plan, implements the smallest coherent change, validates it, and writes `implementation.md`.
- Reviewer: an independent fresh read-only Codex process that challenges correctness, architecture, authorization, isolation, compatibility, SQL safety, and regression risk.
- Fixer: a fresh Codex process that fixes only concrete issues from the latest failing report and updates `implementation.md`.
- Tester: validates actual commands and changed behavior without redesigning or normally editing source.
- Security Reviewer: read-only review of only the changed attack surface, including authentication, authorization, isolation, SQL/XSS, R2, secrets, and privilege boundaries.
- Finalizer: report-driven final gate; approves only when architecture, review, tests, security, isolation, and Workers compatibility are acceptable.

## File-based workflow and context efficiency

Task state lives in `.ai/tasks/TASK-<id>/` with `task.md`, `architecture.md`, `implementation.md`, `review.md`, `tests.md`, `security.md`, `final.md`, and `state.json`. Reports, not conversational memory, are the handoff contract.

Do not reread the whole repository at every stage:

- Architect: task plus relevant modules only.
- Developer: task, architecture, and relevant code.
- Reviewer: task, architecture, implementation report, and current diff.
- Tester: implementation, package scripts, targeted code, and failing output.
- Security: changed attack surface and diff.
- Finalizer: reports first; diff only if needed.

Correction limits are three review/fix cycles, three test/fix cycles, and three security/fix cycles. Provider fallback is only for clear quota, rate-limit, unavailable-model/provider, insufficient-credit, or transient-service failures. A blocked plan, failed review, failed tests, or failed security review is a workflow result, not a provider failure.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may differ from training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code. Heed deprecation notices.

This block is written and re-added by `next dev`; keep it in the file so the working tree remains stable.

<!-- END:nextjs-agent-rules -->
