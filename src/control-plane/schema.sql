-- Plan de controle : base D1 centrale.
--
-- Contient l'identite (qui existe, qui appartient a quel club) et le
-- catalogue des clubs. AUCUNE donnee metier : pas de membres, pas de
-- paiements. Ceux-ci vivent dans le Durable Object du club concerne.
--
-- Aucun club n'accede jamais a cette base : seul le Worker la lit, et il
-- ne lui expose que la ligne qui le concerne.
--
-- Horodatages : toujours ISO-8601 UTC a la seconde. Le datetime('now') de
-- SQLite produit "2026-08-12 13:45:00", sans marqueur de fuseau, que
-- Date.parse interprete en heure LOCALE : toute comparaison cote JS est
-- alors decalee du fuseau serveur.

PRAGMA foreign_keys = ON;

-- Clubs ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
  id           TEXT PRIMARY KEY,              -- sert aussi de nom de Durable Object
  slug         TEXT NOT NULL UNIQUE,          -- identifiant lisible, ex. "noujoum-chaouia"
  name         TEXT NOT NULL,
  name_ar      TEXT,
  logo_key     TEXT,                          -- cle R2, pas une URL
  -- Theme du club (JSON) : couleur d'accent, mode clair/sombre. Stocke ici
  -- plutot que dans le Durable Object parce que resolveSession lit deja
  -- cette ligne : le club obtient sa marque sans requete supplementaire, et
  -- le tableau de bord plateforme affiche les logos sans ouvrir N bases.
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

  -- Plafonds appliques cote serveur ; NULL = illimite.
  max_members  INTEGER,
  max_branches INTEGER,
  max_staff    INTEGER,

  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);
CREATE INDEX IF NOT EXISTS idx_organizations_plan   ON organizations(plan);

-- Comptes --------------------------------------------------------------------
-- Un compte est global : l'e-mail est unique sur toute la plateforme. Un meme
-- entraineur peut donc appartenir a plusieurs clubs (via memberships), ce que
-- l'ancien schema interdisait (profiles.user_id etait UNIQUE).
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL,
  email_norm     TEXT NOT NULL UNIQUE,        -- minuscules + trim : la cle reelle
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,               -- pbkdf2$<iterations>$<sel>$<cle>
  is_platform_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_platform_admin IN (0,1)),
  status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','disabled')),
  last_login_at  TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Appartenance a un club -----------------------------------------------------
-- Porte le role et la portee. C'est la seule chose qui autorise un compte a
-- ouvrir le Durable Object d'un club.
CREATE TABLE IF NOT EXISTS memberships (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner','admin','staff','viewer')),
  -- Portee intra-club. NULL = tout le club. Contrairement a l'ancien schema,
  -- ces colonnes ne franchissent aucune frontiere de club : l'isolation est
  -- physique, elles ne font qu'affiner les droits a l'interieur.
  branch_id     TEXT,
  discipline_id TEXT,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (user_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_memberships_org  ON memberships(org_id)  WHERE status = 'active';

-- Sessions -------------------------------------------------------------------
-- Jeton opaque. Seul son SHA-256 est stocke : une fuite de la base ne permet
-- pas de rejouer une session.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Club actif de la session. Un compte multi-clubs en choisit un a la
  -- connexion ; le Worker n'ouvrira que celui-la.
  org_id      TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expires_at  TEXT NOT NULL,
  ip          TEXT,
  user_agent  TEXT,

  -- Mode support : un exploitant de plateforme "entre" dans un club pour le
  -- depanner. Ce n'est PAS un changement de role, c'est une portee greffee
  -- sur la session, en lecture seule par defaut et limitee dans le temps.
  -- L'ecriture demande une escalade explicite, tracee separement, pour
  -- qu'un support ne modifie jamais un club par accident.
  support_org_id     TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  support_expires_at TEXT,
  support_write      INTEGER NOT NULL DEFAULT 0 CHECK (support_write IN (0,1))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp  ON sessions(expires_at);

-- Autorisation privilegiee courte, liee a UNE session Superadmin. Ce n'est
-- ni un role ni de la MFA : le mot de passe courant vient d'etre reverifie,
-- puis seul le hash du jeton de session porte le grant ephemere.
CREATE TABLE IF NOT EXISTS privileged_grants (
  token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_privileged_grants_exp ON privileged_grants(expires_at);

CREATE TABLE IF NOT EXISTS support_write_grants (
  token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_support_write_grants_exp ON support_write_grants(expires_at);

CREATE TABLE IF NOT EXISTS step_up_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip           TEXT,
  succeeded    INTEGER NOT NULL DEFAULT 0 CHECK (succeeded IN (0,1)),
  attempted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_step_up_attempts_user
  ON step_up_attempts(user_id, attempted_at);
CREATE INDEX IF NOT EXISTS idx_step_up_attempts_ip
  ON step_up_attempts(ip, attempted_at);

-- Anti-force brute -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier  TEXT NOT NULL,                  -- e-mail normalise
  ip          TEXT,
  succeeded   INTEGER NOT NULL DEFAULT 0 CHECK (succeeded IN (0,1)),
  attempted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_attempts_lookup ON login_attempts(identifier, attempted_at);
CREATE INDEX IF NOT EXISTS idx_attempts_ip     ON login_attempts(ip, attempted_at);

-- Adresses connues -------------------------------------------------------
-- Sert a reconnaitre une connexion depuis un endroit jamais vu. C'est le
-- signal le plus utile en pratique : un compte de club qui se connecte
-- soudain depuis une adresse inconnue merite un coup d'oeil.
CREATE TABLE IF NOT EXISTS known_ips (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip         TEXT NOT NULL,
  first_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_seen  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (user_id, ip)
);

-- Evenements de securite ---------------------------------------------------
-- Alimente automatiquement a la connexion. Lu uniquement par la plateforme :
-- c'est la page de supervision.
CREATE TABLE IF NOT EXISTS security_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  org_id     TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  type       TEXT NOT NULL
               CHECK (type IN ('new_ip','failed_burst','support_write')),
  detail     TEXT,
  ip         TEXT,
  user_agent TEXT,
  handled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_security_events_time ON security_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_open ON security_events(handled_at) WHERE handled_at IS NULL;

-- Agregats par club ----------------------------------------------------------
-- On ne peut pas faire de JOIN entre Durable Objects : le tableau de bord
-- superadmin lit ce cache, rafraichi par tache planifiee, plutot que
-- d'interroger N clubs a chaque affichage.
CREATE TABLE IF NOT EXISTS org_stats (
  org_id          TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  member_count    INTEGER NOT NULL DEFAULT 0,
  active_subs     INTEGER NOT NULL DEFAULT 0,
  revenue_month_cents INTEGER NOT NULL DEFAULT 0,
  last_activity_at TEXT,
  refreshed_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Journal plateforme ---------------------------------------------------------
-- Trace les actions du superadmin, notamment l'ouverture de la base d'un club
-- pour du support : cet acces doit etre visible.
CREATE TABLE IF NOT EXISTS platform_audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  org_id     TEXT,
  detail     TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_time ON platform_audit(created_at DESC);

-- Emplacement d'un club, pour la carte de supervision.
--
-- Table separee plutot que deux colonnes sur organizations : le fichier de
-- schema est rejoue tel quel sur une base existante, et SQLite n'a pas de
-- ALTER TABLE ADD COLUMN IF NOT EXISTS. Une table de plus se cree sans
-- risque, une colonne de plus casse le rejeu.
CREATE TABLE IF NOT EXISTS org_locations (
  org_id     TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  label      TEXT,                            -- adresse lisible, telle que saisie
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Projection géographique des branches pour la supervision plateforme.
-- La branche reste une donnée métier du Durable Object ; cette table est un
-- cache de lecture inter-clubs, comme org_stats, afin d'éviter un fan-out sur
-- tous les Durable Objects à chaque ouverture de la carte.
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

-- Adresses bloquees a la connexion.
--
-- Le blocage se fait AVANT la verification du mot de passe et avant tout
-- comptage : une adresse bloquee ne doit meme pas pouvoir mesurer le temps
-- de reponse pour deviner si un compte existe.
CREATE TABLE IF NOT EXISTS ip_blocklist (
  ip         TEXT PRIMARY KEY,
  reason     TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Abonnement d'un club a la plateforme.
--
-- Distinct de organizations.plan, qui dit la formule : ici on tient l'argent.
-- Le telephone est celui du responsable, au format international sans « + » —
-- c'est ce qu'attend un lien wa.me.
CREATE TABLE IF NOT EXISTS org_billing (
  org_id       TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  price_cents  INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  cycle_months INTEGER NOT NULL DEFAULT 1 CHECK (cycle_months BETWEEN 1 AND 24),
  phone        TEXT,
  started_at   TEXT,
  -- Fin de la periode couverte. Avancee a chaque echeance reglee : c'est
  -- elle, et non un statut fige, qui dit si un club est a jour. Un statut se
  -- desynchronise, une date se compare.
  expires_at   TEXT,
  notes        TEXT,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_org_billing_expires ON org_billing(expires_at);

-- Echeances. Une ligne par periode facturee.
--
-- Sans elles, « paye / pas paye » ne serait qu'un booleen sur le club, et un
-- filtre par mois n'aurait rien a filtrer : on ne saurait pas ce qui etait du
-- en mars, seulement ce qui est du aujourd'hui.
CREATE TABLE IF NOT EXISTS org_invoices (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  due_date     TEXT NOT NULL,
  paid_at      TEXT,
  method       TEXT,
  note         TEXT,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_invoices_org  ON org_invoices(org_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_due  ON org_invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_open ON org_invoices(paid_at) WHERE paid_at IS NULL;

-- Reservation atomique d'une periode facturee. Les doublons historiques sont
-- conserves (une facture est une piece comptable), mais une seule ligne
-- canonique est revendiquee et aucune nouvelle emission ne peut reutiliser la
-- meme couverture. Le trigger rend reservation + facture indivisibles.
CREATE TABLE IF NOT EXISTS org_invoice_period_claims (
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  invoice_id   TEXT NOT NULL UNIQUE
                 REFERENCES org_invoices(id) ON DELETE CASCADE
                 DEFERRABLE INITIALLY DEFERRED,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  due_date     TEXT NOT NULL,
  note         TEXT,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (org_id, period_start, period_end)
);

-- Migration sans perte : s'il existe deja plusieurs factures pour une meme
-- periode, la plus ancienne devient canonique et toutes restent visibles.
INSERT OR IGNORE INTO org_invoice_period_claims
  (org_id, period_start, period_end, invoice_id, amount_cents, due_date, note, created_by, created_at)
SELECT i.org_id, COALESCE(date(i.period_start), i.period_start),
       COALESCE(date(i.period_end), i.period_end),
       i.id, i.amount_cents, i.due_date,
       i.note, i.created_by, i.created_at
  FROM org_invoices i
  JOIN (
    SELECT org_id,
           COALESCE(date(period_start), period_start) AS period_start_day,
           COALESCE(date(period_end), period_end) AS period_end_day,
           MIN(created_at || ':' || id) AS canonical
      FROM org_invoices
     GROUP BY org_id, period_start_day, period_end_day
  ) c ON c.org_id = i.org_id
     AND c.period_start_day = COALESCE(date(i.period_start), i.period_start)
     AND c.period_end_day = COALESCE(date(i.period_end), i.period_end)
     AND c.canonical = i.created_at || ':' || i.id;

CREATE TRIGGER IF NOT EXISTS invoice_period_claim_issue
  AFTER INSERT ON org_invoice_period_claims
  WHEN NOT EXISTS (SELECT 1 FROM org_invoices WHERE id = NEW.invoice_id)
BEGIN
  INSERT INTO org_invoices
    (id, org_id, period_start, period_end, amount_cents, due_date, note, created_by)
  VALUES
    (NEW.invoice_id, NEW.org_id, NEW.period_start, NEW.period_end,
     NEW.amount_cents, NEW.due_date, NEW.note, NEW.created_by);
END;

-- Recu durable des commandes financieres D1. L'identite de l'acteur vient de
-- la session, jamais du corps client.
CREATE TABLE IF NOT EXISTS financial_idempotency (
  actor_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  operation    TEXT NOT NULL,
  idem_key     TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  request_json TEXT NOT NULL,
  result_json  TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (actor_id, org_id, operation, idem_key)
);
CREATE INDEX IF NOT EXISTS idx_financial_idempotency_created
  ON financial_idempotency(created_at);

-- Preuve de virement rattachee a une echeance.
--
-- Table separee plutot que des colonnes sur org_invoices : le fichier de
-- schema est rejoue tel quel, et SQLite n'a pas de ALTER TABLE ADD COLUMN
-- IF NOT EXISTS. Elle porte aussi le cycle de revue, qui n'appartient pas a
-- la facture elle-meme.
CREATE TABLE IF NOT EXISTS org_invoice_proofs (
  invoice_id    TEXT PRIMARY KEY REFERENCES org_invoices(id) ON DELETE CASCADE,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_key      TEXT,                     -- cle R2 du justificatif, jamais une URL
  reference     TEXT,                     -- libelle du virement, saisi par le club
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','rejected')),
  reject_reason TEXT,
  submitted_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  submitted_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TEXT,
  reviewed_by   TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_proofs_pending ON org_invoice_proofs(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_proofs_org     ON org_invoice_proofs(org_id);

-- Les transitions critiques passent par l'insertion du recu. Les triggers
-- valident l'etat attendu puis changent l'objet dans la meme transaction D1 :
-- deux decisions stale ne peuvent donc pas toutes les deux reussir.
CREATE TRIGGER IF NOT EXISTS financial_transition_guard
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

CREATE TRIGGER IF NOT EXISTS financial_transition_apply
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

  UPDATE org_invoices
     SET paid_at = date('now'), method = 'virement'
   WHERE id = json_extract(NEW.request_json, '$.invoiceId')
     AND NEW.operation = 'proof_accept';

  UPDATE org_invoices
     SET paid_at = COALESCE(json_extract(NEW.request_json, '$.paidAt'), date('now')),
         method = json_extract(NEW.request_json, '$.method')
   WHERE id = json_extract(NEW.request_json, '$.invoiceId')
     AND NEW.operation = 'invoice_mark_paid';

  UPDATE org_invoices
     SET paid_at = NULL, method = NULL
   WHERE id = json_extract(NEW.request_json, '$.invoiceId')
     AND NEW.operation = 'invoice_mark_unpaid';

  -- Etat derive recalcule DANS la meme instruction/transaction que le recu
  -- et la transition. Une reponse perdue ne peut donc jamais laisser une
  -- couverture stale derriere un recu de succes.
  UPDATE org_billing
     SET expires_at = (
           SELECT MAX(COALESCE(date(period_end), period_end)) FROM org_invoices
            WHERE org_id = NEW.org_id AND paid_at IS NOT NULL
         ),
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE org_id = NEW.org_id
     AND NEW.operation IN ('proof_accept','invoice_mark_paid','invoice_mark_unpaid');
END;

-- Reglages de la plateforme : coordonnees bancaires affichees aux clubs,
-- consignes de virement. Cle/valeur, comme pour un club.
CREATE TABLE IF NOT EXISTS platform_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Derniere relance envoyee pour une echeance.
--
-- Table separee plutot qu'une colonne sur org_invoices : le fichier de schema
-- est rejoue tel quel sur une base existante, et SQLite n'a pas de
-- ALTER TABLE ADD COLUMN IF NOT EXISTS.
--
-- Le compteur accompagne la date : « relance il y a deux jours » ne dit pas
-- la meme chose selon que c'est la premiere ou la cinquieme.
CREATE TABLE IF NOT EXISTS org_invoice_reminders (
  invoice_id       TEXT PRIMARY KEY REFERENCES org_invoices(id) ON DELETE CASCADE,
  last_reminder_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  reminder_count   INTEGER NOT NULL DEFAULT 1,
  last_reminder_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  channel          TEXT
);

-- Banniere du club, affichee en tete de son tableau de bord.
--
-- Table separee plutot qu'une colonne sur organizations : le fichier de
-- schema est rejoue tel quel, et SQLite n'a pas de ALTER TABLE ADD COLUMN
-- IF NOT EXISTS. Seule la plateforme la pose — c'est une piece d'identite
-- visuelle qu'on installe pour le client, pas un reglage de comptoir.
CREATE TABLE IF NOT EXISTS org_banners (
  org_id     TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  file_key   TEXT NOT NULL,               -- cle R2, jamais une URL
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- Conversations explicitement adressees au support GymFlow. Elles vivent
-- dans le plan de controle car elles relient un club et la plateforme, mais
-- ne donnent jamais acces aux conversations privees du Durable Object.
CREATE TABLE IF NOT EXISTS support_threads (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS support_messages (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('club','support')),
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_support_messages_cursor
  ON support_messages(thread_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS support_reads (
  thread_id            TEXT NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_read_message_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (thread_id, user_id)
);

-- Canal global en lecture pour les clubs, gere exclusivement par la plateforme.
CREATE TABLE IF NOT EXISTS platform_announcements (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  content      TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 8000),
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  published_at TEXT,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_announcements_published
  ON platform_announcements(status, published_at DESC);

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id TEXT NOT NULL REFERENCES platform_announcements(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS announcement_reactions (
  announcement_id TEXT NOT NULL REFERENCES platform_announcements(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji           TEXT NOT NULL CHECK (emoji IN ('👍','❤️','😂','👏','🔥','💪','😍','😮','😢','🙏','✅','🎉')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (announcement_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_announcement_reactions_summary
  ON announcement_reactions(announcement_id, emoji);

-- Suivi des suppressions de clubs : processus etape par etape, idempotent et reprenable.
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
