-- Batch 5: Availability hardening, subscription lifecycle & Entitlement indexes
-- Apply this migration before deploying Batch 5 application code.

CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);
CREATE INDEX IF NOT EXISTS idx_organizations_plan ON organizations(plan);
CREATE INDEX IF NOT EXISTS idx_org_billing_expires ON org_billing(expires_at);
