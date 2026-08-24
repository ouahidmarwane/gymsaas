# GymFlow 🏋️

**Open-source-ready, multi-tenant sports club management platform built on Cloudflare.**

GymFlow is a management platform for gyms and sports clubs. It combines member and subscription management, disciplines and grading, financial workflows, team permissions, club messaging, support tooling, branding, supervision, and strong tenant isolation in a single platform.

> Current development version: `0.1.0`

## Highlights

- 🏢 Multi-club / multi-tenant architecture
- 👥 Member, staff, branch, discipline, grade and subscription management
- 💳 Financial workflows with idempotency protections
- 💬 Club messaging with group conversations, direct messages, reactions and attachments
- 📣 Platform support and announcements
- 🔐 Role-based access control, support mode and step-up security
- 🧱 Physical tenant data isolation using one Durable Object database per club
- 📦 Resumable and controlled organization deletion
- 🎟️ Entitlements and feature availability controls
- 🎨 Club branding, themes, logos, banners and configurable dashboards
- 📍 Platform supervision with OpenStreetMap / Leaflet
- 🗂️ R2-backed media and document storage
- 🧪 Extensive HTTP, security, isolation, finance, migration and messaging tests

## Architecture

GymFlow runs on **Next.js 16** and is deployed to **Cloudflare Workers** through **OpenNext**.

### Control plane — Cloudflare D1

A central D1 database stores platform-level information such as:

- identities and accounts;
- club catalogue and memberships;
- sessions and security state;
- subscriptions and entitlements;
- cached aggregates;
- platform audit information;
- support and announcement metadata.

Business data belonging to an individual club is intentionally kept outside the central database.

### Club data — Durable Objects

Each club receives its own Durable Object, addressed from its organization identifier. Its SQLite storage contains club-specific business data such as members, payments, alerts, disciplines, branches, grades and club audit history.

This creates a strong tenant boundary: club A and club B do not merely share tables protected by an application filter — they use separate databases.

Durable Objects also make self-service provisioning possible without adding a new static D1 binding and redeploying the Worker every time a club is created.

### Files — Cloudflare R2

Media, documents, club logos, banners and messaging attachments are stored in R2 with organization-scoped object keys. Browser-facing operations pass through authenticated application routes so authorization remains enforced by GymFlow.

## Security model

Security is treated as an architectural requirement rather than only a UI concern.

The platform includes:

- organization isolation and server-side organization resolution;
- role and capability enforcement on API routes;
- platform administrator boundaries;
- read-only and explicit write support modes;
- step-up security for sensitive operations;
- session revocation and blocklist controls;
- password derivation compatible with the Cloudflare Workers runtime;
- financial idempotency protections;
- controlled and resumable organization deletion;
- audit-oriented platform and club workflows;
- migration and regression tests for security-sensitive behavior.

Client-supplied organization identifiers are never treated as authorization.

## Messaging

GymFlow includes an integrated communication surface for clubs and the platform:

- group conversations;
- direct messages;
- message reactions;
- attachments;
- club conversations;
- platform support messaging;
- announcements.

Messaging follows the same organization and support-mode authorization boundaries as the rest of the platform.

## Platform supervision

The platform supervision area provides cross-club operational visibility for authorized platform administrators.

Club locations are displayed with **Leaflet + OpenStreetMap**, requiring no proprietary map account or API key. OpenStreetMap attribution remains visible as required.

## Technology stack

| Layer | Technology |
| --- | --- |
| Application | Next.js 16 / React 19 / TypeScript |
| Edge runtime | Cloudflare Workers |
| Next.js adapter | OpenNext for Cloudflare |
| Control-plane database | Cloudflare D1 |
| Per-club storage | Cloudflare Durable Objects + SQLite |
| Object storage | Cloudflare R2 |
| Deployment / local Worker runtime | Wrangler / workerd |
| Maps | Leaflet + OpenStreetMap |
| Charts | Recharts |
| UI | Tailwind CSS + application CSS |
| Tests | Node.js test runner + HTTP integration tests |

## Local development

### Requirements

- Node.js
- npm
- Cloudflare Wrangler

Clone the repository and install dependencies:

```bash
git clone https://github.com/ouahidmarwane/gymsaas.git
cd gymsaas
npm install
```

Initialize the local control-plane database:

```bash
npm run db:apply:local
```

Start the Cloudflare-compatible local environment:

```bash
npm run dev
```

GymFlow is then available at:

```text
http://localhost:8787
```

`npm run dev` builds the OpenNext application and serves it through local `workerd`. This is the reference local environment because `next dev` runs in Node.js and cannot reproduce Cloudflare bindings and Durable Object behavior faithfully.

For UI-only iteration, without the full Worker API/database environment:

```bash
npm run dev:ui
```

## Database migrations

GymFlow keeps production schema changes in versioned D1 migrations.

Apply pending migrations locally:

```bash
npm run db:migrate:local
```

Apply pending migrations to the configured remote D1 database:

```bash
npm run db:migrate:remote
```

Production migrations must contain schema/data migrations intentionally written for production. Local or test datasets must never be imported into production.

## Tests

With the local Worker running:

```bash
npm test
```

The suite exercises the application through HTTP and includes coverage for areas such as:

- tenant isolation;
- authentication and session security;
- platform administrator authorization;
- support mode and support-surface mutations;
- provisioning;
- grants and step-up security;
- financial idempotency and ledger behavior;
- organization deletion;
- entitlements and availability;
- messaging;
- migrations;
- layout and capabilities;
- themes and WCAG contrast;
- blocklists;
- documents;
- disciplines and grades;
- cryptographic behavior.

Static checks used by CI can be run with:

```bash
npm run build:ci
```

This performs TypeScript checking, static tests and the OpenNext build.

## Deployment

Build and deploy through OpenNext / Cloudflare:

```bash
npm run deploy
```

For a new control-plane database, create/configure the D1 database first and apply the appropriate schema or migrations before serving production traffic.

Platform administrator privileges are deliberately not exposed as a normal self-service application action. Sensitive platform access must be provisioned through controlled operational procedures.

## Project status

GymFlow is under **active development**. The platform architecture, security model, messaging system and operational tooling are evolving quickly, so APIs and deployment procedures may change before a stable `1.0` release.

The repository is being prepared for broader open-source collaboration. Documentation, contribution guidelines, security reporting instructions and release processes will continue to be expanded.

## Roadmap

Near-term open-source work includes:

- contributor documentation and development workflow;
- security disclosure documentation;
- issue and pull-request templates;
- public release/versioning workflow;
- additional deployment and self-hosting documentation;
- broader automated CI coverage;
- improved architecture and operational documentation.

## Contributing

Community contributions will be welcome as the public contribution workflow is finalized. Until `CONTRIBUTING.md` is published, please use GitHub issues for reproducible bug reports and focused feature proposals.

When proposing security-sensitive changes, avoid publishing exploitable details in a public issue; a dedicated security reporting process will be documented separately.

## License

A formal open-source license has not yet been selected for GymFlow.

**Important:** public source code is not automatically licensed for unrestricted reuse. Until a `LICENSE` file is added, no additional reuse rights should be assumed beyond those provided by applicable law and GitHub's terms.

Selecting and publishing an appropriate open-source license is one of the next repository milestones.

---

Built and maintained by [Marwane Ouahid](https://github.com/ouahidmarwane).