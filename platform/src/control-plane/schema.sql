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
                 CHECK (status IN ('active','suspended','cancelled')),
  trial_ends_at TEXT,

  -- Plafonds appliques cote serveur ; NULL = illimite.
  max_members  INTEGER,
  max_branches INTEGER,
  max_staff    INTEGER,

  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

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
