-- Batch 2.1: completion atomique des transitions financieres et periodes
-- logiques canonisees. Appliquer APRES 0002 et AVANT le code Batch 2.1.

-- Reconstruit seulement le registre de revendications, jamais les factures.
-- Les bornes ISO date et ISO datetime equivalentes partagent ainsi une cle.
DROP TRIGGER IF EXISTS invoice_period_claim_issue;
DROP TABLE IF EXISTS org_invoice_period_claims_v21;
CREATE TABLE org_invoice_period_claims_v21 (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  invoice_id TEXT NOT NULL UNIQUE REFERENCES org_invoices(id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  due_date TEXT NOT NULL,
  note TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (org_id, period_start, period_end)
);

INSERT OR IGNORE INTO org_invoice_period_claims_v21
  (org_id, period_start, period_end, invoice_id, amount_cents, due_date, note, created_by, created_at)
SELECT i.org_id, COALESCE(date(i.period_start), i.period_start),
       COALESCE(date(i.period_end), i.period_end), i.id, i.amount_cents,
       i.due_date, i.note, i.created_by, i.created_at
  FROM org_invoices i
  JOIN (
    SELECT org_id, COALESCE(date(period_start), period_start) AS period_start_day,
           COALESCE(date(period_end), period_end) AS period_end_day,
           MIN(created_at || ':' || id) AS canonical
      FROM org_invoices
     GROUP BY org_id, period_start_day, period_end_day
  ) c ON c.org_id = i.org_id
     AND c.period_start_day = COALESCE(date(i.period_start), i.period_start)
     AND c.period_end_day = COALESCE(date(i.period_end), i.period_end)
     AND c.canonical = i.created_at || ':' || i.id;

DROP TABLE org_invoice_period_claims;
ALTER TABLE org_invoice_period_claims_v21 RENAME TO org_invoice_period_claims;

CREATE TRIGGER invoice_period_claim_issue
  AFTER INSERT ON org_invoice_period_claims
  WHEN NOT EXISTS (SELECT 1 FROM org_invoices WHERE id = NEW.invoice_id)
BEGIN
  INSERT INTO org_invoices
    (id, org_id, period_start, period_end, amount_cents, due_date, note, created_by)
  VALUES
    (NEW.invoice_id, NEW.org_id, NEW.period_start, NEW.period_end,
     NEW.amount_cents, NEW.due_date, NEW.note, NEW.created_by);
END;

-- Recreate transition triggers because CREATE IF NOT EXISTS in schema.sql
-- cannot upgrade trigger bodies installed by Batch 2.
DROP TRIGGER IF EXISTS financial_transition_guard;
DROP TRIGGER IF EXISTS financial_transition_apply;

CREATE TRIGGER financial_transition_guard
  BEFORE INSERT ON financial_idempotency
  WHEN NEW.operation IN ('proof_accept','proof_reject','invoice_mark_paid','invoice_mark_unpaid')
BEGIN
  SELECT (CASE
    WHEN NEW.operation IN ('proof_accept','proof_reject') AND NOT EXISTS (
      SELECT 1 FROM org_invoice_proofs p
       WHERE p.invoice_id = json_extract(NEW.request_json, '$.invoiceId')
         AND p.org_id = NEW.org_id AND p.status = 'pending'
    ) THEN RAISE(ABORT, 'STALE_FINANCIAL_STATE')
    WHEN NEW.operation = 'proof_accept' AND NOT EXISTS (
      SELECT 1 FROM org_invoices i
       WHERE i.id = json_extract(NEW.request_json, '$.invoiceId')
         AND i.org_id = NEW.org_id AND i.paid_at IS NULL
    ) THEN RAISE(ABORT, 'STALE_FINANCIAL_STATE')
    WHEN NEW.operation = 'invoice_mark_paid' AND NOT EXISTS (
      SELECT 1 FROM org_invoices i
       WHERE i.id = json_extract(NEW.request_json, '$.invoiceId')
         AND i.org_id = NEW.org_id AND i.paid_at IS NULL
    ) THEN RAISE(ABORT, 'STALE_FINANCIAL_STATE')
    WHEN NEW.operation = 'invoice_mark_unpaid' AND NOT EXISTS (
      SELECT 1 FROM org_invoices i
       WHERE i.id = json_extract(NEW.request_json, '$.invoiceId')
         AND i.org_id = NEW.org_id AND i.paid_at IS NOT NULL
    ) THEN RAISE(ABORT, 'STALE_FINANCIAL_STATE')
  END);
END;

CREATE TRIGGER financial_transition_apply
  AFTER INSERT ON financial_idempotency
  WHEN NEW.operation IN ('proof_accept','proof_reject','invoice_mark_paid','invoice_mark_unpaid')
BEGIN
  UPDATE org_invoice_proofs
     SET status = CASE NEW.operation WHEN 'proof_accept' THEN 'accepted' ELSE 'rejected' END,
         reject_reason = CASE WHEN NEW.operation = 'proof_reject'
                              THEN json_extract(NEW.request_json, '$.reason') ELSE NULL END,
         reviewed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         reviewed_by = NEW.actor_id
   WHERE invoice_id = json_extract(NEW.request_json, '$.invoiceId')
     AND NEW.operation IN ('proof_accept','proof_reject');

  UPDATE org_invoices SET paid_at = date('now'), method = 'virement'
   WHERE id = json_extract(NEW.request_json, '$.invoiceId')
     AND NEW.operation = 'proof_accept';

  UPDATE org_invoices
     SET paid_at = COALESCE(json_extract(NEW.request_json, '$.paidAt'), date('now')),
         method = json_extract(NEW.request_json, '$.method')
   WHERE id = json_extract(NEW.request_json, '$.invoiceId')
     AND NEW.operation = 'invoice_mark_paid';

  UPDATE org_invoices SET paid_at = NULL, method = NULL
   WHERE id = json_extract(NEW.request_json, '$.invoiceId')
     AND NEW.operation = 'invoice_mark_unpaid';

  UPDATE org_billing
     SET expires_at = (
           SELECT MAX(COALESCE(date(period_end), period_end)) FROM org_invoices
            WHERE org_id = NEW.org_id AND paid_at IS NOT NULL
         ),
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE org_id = NEW.org_id
     AND NEW.operation IN ('proof_accept','invoice_mark_paid','invoice_mark_unpaid');
END;
