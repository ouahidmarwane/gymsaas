-- Access Batch B: routing-only Gateway -> organization registry.
-- Machine credentials, branch assignment, and operational state remain in
-- the tenant Durable Object and must be authenticated there.

CREATE TABLE IF NOT EXISTS access_gateway_registry (
  gateway_id TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_gateway_registry_org
  ON access_gateway_registry(org_id);
