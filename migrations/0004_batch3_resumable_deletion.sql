-- Batch 3: Resumable organization deletion, deletion jobs, and lifecycle state.
-- Apply this migration before deploying Batch 3 application code.

PRAGMA foreign_keys = OFF;

-- Update organizations status check constraint to include 'deleting' and 'deleted'.
CREATE TABLE IF NOT EXISTS organizations_v4 (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  name_ar      TEXT,
  logo_key     TEXT,
  theme        TEXT,
  currency     TEXT NOT NULL DEFAULT 'MAD',
  phone_prefix TEXT NOT NULL DEFAULT '212',
  locale       TEXT NOT NULL DEFAULT 'fr',
  timezone     TEXT NOT NULL DEFAULT 'Africa/Casablanca',
  plan         TEXT NOT NULL DEFAULT 'trial'
                 CHECK (plan IN ('trial','essentiel','club','federation')),
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','suspended','cancelled','deleting','deleted')),
  trial_ends_at TEXT,
  max_members  INTEGER,
  max_branches INTEGER,
  max_staff    INTEGER,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

INSERT OR IGNORE INTO organizations_v4 SELECT * FROM organizations;
DROP TABLE organizations;
ALTER TABLE organizations_v4 RENAME TO organizations;

PRAGMA foreign_keys = ON;

-- Deletion jobs tracking table for resumable, phased, auditable tenant deletion.
CREATE TABLE IF NOT EXISTS org_deletion_jobs (
  id                   TEXT PRIMARY KEY,
  org_id               TEXT NOT NULL UNIQUE,
  org_slug             TEXT NOT NULL,
  org_name             TEXT NOT NULL,
  requested_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
  requested_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  phase                TEXT NOT NULL
                         CHECK (phase IN ('pending','access_revoked','do_destroyed','r2_cleaned','d1_cleaned','completed','failed')),
  attempts             INTEGER NOT NULL DEFAULT 1,
  last_error           TEXT,
  completed_at         TEXT,
  cursor_r2            TEXT,
  r2_deleted_count     INTEGER NOT NULL DEFAULT 0,
  orphaned_users_count INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_deletion_jobs_phase ON org_deletion_jobs(phase);
CREATE INDEX IF NOT EXISTS idx_deletion_jobs_org ON org_deletion_jobs(org_id);
