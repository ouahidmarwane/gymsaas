# Control-plane D1 migrations

GymFlow application deployments and control-plane schema migrations are separate operations.
Application code must never be deployed before every migration it depends on has completed.

For Batch 1/1.1, the required migration is `0001_batch1_security_grants.sql`. It creates the
session-bound privileged grants, support-write grants, and step-up throttling tables. Its DDL is
idempotent, while Wrangler's migration ledger prevents a successfully applied version from being
replayed.

Batch 2 requires `0002_batch2_financial_idempotency.sql`. It creates scoped financial receipts,
invoice-period claims, and conditional invoice/proof transition triggers. Batch 2.1 then requires
`0003_batch2_1_financial_completion.sql`; it canonicalizes logical period claims without deleting
invoices and upgrades the transition triggers so paid state, receipt, coverage expiry, and audit
commit together. Apply both in numeric order before deploying code that writes these objects.

## Deployment order

1. Back up or otherwise confirm recovery for the production D1 database according to operations policy.
2. Review pending migrations with `wrangler d1 migrations list gymflow-control --remote`.
3. Apply migrations with `npm.cmd run db:migrate:remote`.
4. Verify the migration completed successfully and that no migration remains pending.
5. Only then build and deploy application code that references the new tables.

Never use `db:bootstrap:remote` as the production upgrade mechanism. That command replays the complete
bootstrap schema and remains available only for explicitly reviewed initial provisioning. Do not reverse the
ordering above: deploying first causes authenticated requests to fail when grant tables are absent.

Local validation uses `npm.cmd run db:migrate:local`. Re-running it is safe because Wrangler records
applied versions. The Batch 2.1 claim rebuild is also repeat-safe by construction and never rewrites
or deletes invoice history.
