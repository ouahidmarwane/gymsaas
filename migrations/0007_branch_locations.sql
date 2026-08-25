-- Cache géographique des branches, destiné à la carte de supervision.
-- Les données métier des branches restent dans le Durable Object du club.

CREATE TABLE IF NOT EXISTS branch_locations (
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id   TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  lat         REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng         REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
  label       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (org_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_locations_org ON branch_locations(org_id);
