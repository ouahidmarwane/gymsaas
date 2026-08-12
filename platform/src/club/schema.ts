// Schema d'une base de club, applique a l'interieur du Durable Object.
//
// Chaque club possede sa propre base SQLite : aucune colonne org_id n'est
// necessaire, et aucune requete ne peut atteindre un autre club. L'isolation
// n'est pas une regle qu'on applique, c'est une propriete du stockage.
//
// Les migrations sont versionnees et rejouees a l'ouverture de l'objet. Comme
// il y a une base par club, une migration s'applique paresseusement, club par
// club, a la premiere utilisation : pas de fenetre de maintenance globale.
//
// Horodatages en ISO-8601 UTC (strftime, pas datetime) : voir la note dans
// control-plane/schema.sql.

export interface Migration {
  version: number
  name: string
  statements: string[]
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%SZ','now')"

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial',
    statements: [
      // Structure du club.
      // Les succursales sont une table, pas une contrainte CHECK figee :
      // chaque club definit les siennes.
      `CREATE TABLE IF NOT EXISTS branches (
         id         TEXT PRIMARY KEY,
         name       TEXT NOT NULL,
         name_ar    TEXT,
         address    TEXT,
         is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
         created_at TEXT NOT NULL DEFAULT (${NOW})
       )`,

      // Idem pour les disciplines. has_grading distingue un art martial grade
      // d'une activite qui ne l'est pas : c'est ce qui permet de vendre a un
      // club de judo ou de boxe, pas seulement de karate.
      `CREATE TABLE IF NOT EXISTS disciplines (
         id          TEXT PRIMARY KEY,
         name        TEXT NOT NULL,
         name_ar     TEXT,
         has_grading INTEGER NOT NULL DEFAULT 0 CHECK (has_grading IN (0,1)),
         is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
         created_at  TEXT NOT NULL DEFAULT (${NOW})
       )`,

      // Echelle de grades propre a chaque discipline : ceintures de karate,
      // kyu/dan de judo, geup de taekwondo, ou rien du tout.
      `CREATE TABLE IF NOT EXISTS grade_levels (
         id            TEXT PRIMARY KEY,
         discipline_id TEXT NOT NULL REFERENCES disciplines(id) ON DELETE CASCADE,
         rank          INTEGER NOT NULL,
         label         TEXT NOT NULL,
         label_ar      TEXT,
         color         TEXT,
         UNIQUE (discipline_id, rank)
       )`,

      // Membres.
      `CREATE TABLE IF NOT EXISTS members (
         id            TEXT PRIMARY KEY,
         name          TEXT NOT NULL,
         phone         TEXT NOT NULL,
         email         TEXT,
         birth_date    TEXT,
         join_date     TEXT NOT NULL DEFAULT (date('now')),

         branch_id     TEXT REFERENCES branches(id) ON DELETE SET NULL,
         discipline_id TEXT REFERENCES disciplines(id) ON DELETE SET NULL,
         grade_id      TEXT REFERENCES grade_levels(id) ON DELETE SET NULL,

         sub_expiry    TEXT,
         is_insured    INTEGER NOT NULL DEFAULT 0 CHECK (is_insured IN (0,1)),
         ins_expiry    TEXT,

         photo_key           TEXT,
         sport_passport_key  TEXT,
         document_key        TEXT,

         notes         TEXT,
         status        TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','inactive','archived')),
         created_by    TEXT,
         created_at    TEXT NOT NULL DEFAULT (${NOW}),
         updated_at    TEXT NOT NULL DEFAULT (${NOW})
       )`,

      `CREATE INDEX IF NOT EXISTS idx_members_branch     ON members(branch_id)`,
      `CREATE INDEX IF NOT EXISTS idx_members_discipline ON members(discipline_id)`,
      `CREATE INDEX IF NOT EXISTS idx_members_sub_expiry ON members(sub_expiry)`,
      `CREATE INDEX IF NOT EXISTS idx_members_ins_expiry ON members(ins_expiry)`,
      `CREATE INDEX IF NOT EXISTS idx_members_status     ON members(status)`,

      `CREATE TRIGGER IF NOT EXISTS members_touch
         AFTER UPDATE ON members FOR EACH ROW
         BEGIN
           UPDATE members SET updated_at = ${NOW} WHERE id = OLD.id;
         END`,

      // Encaissements.
      // Montants en centimes (INTEGER) : SQLite n'a pas de type decimal, et
      // stocker de l'argent en flottant finit toujours par couter un centime.
      `CREATE TABLE IF NOT EXISTS payments (
         id            TEXT PRIMARY KEY,
         member_id     TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
         amount_cents  INTEGER NOT NULL CHECK (amount_cents >= 0),
         type          TEXT NOT NULL
                         CHECK (type IN ('monthly','insurance','registration','other')),
         paid_at       TEXT NOT NULL DEFAULT (date('now')),
         branch_id     TEXT REFERENCES branches(id) ON DELETE SET NULL,
         discipline_id TEXT REFERENCES disciplines(id) ON DELETE SET NULL,
         notes         TEXT,
         recorded_by   TEXT,
         created_at    TEXT NOT NULL DEFAULT (${NOW})
       )`,

      `CREATE INDEX IF NOT EXISTS idx_payments_member ON payments(member_id)`,
      `CREATE INDEX IF NOT EXISTS idx_payments_date   ON payments(paid_at DESC)`,

      // Alertes.
      `CREATE TABLE IF NOT EXISTS notifications (
         id         TEXT PRIMARY KEY,
         member_id  TEXT REFERENCES members(id) ON DELETE CASCADE,
         type       TEXT NOT NULL,
         message    TEXT NOT NULL,
         due_date   TEXT,
         created_at TEXT NOT NULL DEFAULT (${NOW})
       )`,

      `CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC)`,

      // Etat de lecture par utilisateur : un receptionniste qui marque comme
      // lu ne doit pas masquer l'alerte pour les autres.
      `CREATE TABLE IF NOT EXISTS notification_reads (
         notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
         user_id         TEXT NOT NULL,
         read_at         TEXT NOT NULL DEFAULT (${NOW}),
         PRIMARY KEY (notification_id, user_id)
       )`,

      // Journal du club.
      `CREATE TABLE IF NOT EXISTS audit_logs (
         id          INTEGER PRIMARY KEY AUTOINCREMENT,
         action      TEXT NOT NULL,
         entity      TEXT,
         entity_id   TEXT,
         entity_name TEXT,
         detail      TEXT,
         actor_id    TEXT,
         actor_name  TEXT,
         created_at  TEXT NOT NULL DEFAULT (${NOW})
       )`,

      `CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at DESC)`,

      // Reglages du club : cle/valeur JSON, propre a ce club. Pas de table
      // globale partagee comme l'ancien app_settings.
      `CREATE TABLE IF NOT EXISTS settings (
         key        TEXT PRIMARY KEY,
         value      TEXT NOT NULL,
         updated_at TEXT NOT NULL DEFAULT (${NOW})
       )`,
    ],
  },
]

MIGRATIONS.push({
  version: 2,
  name: 'grades-et-championnats',
  statements: [
    // Passage de grade.
    // La cible est un niveau de l'echelle du club, pas un entier fige :
    // chaque club a la sienne, y compris aucune.
    `CREATE TABLE IF NOT EXISTS grade_sessions (
       id             TEXT PRIMARY KEY,
       member_id      TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
       from_grade_id  TEXT REFERENCES grade_levels(id) ON DELETE SET NULL,
       to_grade_id    TEXT REFERENCES grade_levels(id) ON DELETE SET NULL,
       scheduled_date TEXT NOT NULL,
       status         TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','passed','failed')),
       notes          TEXT,
       decided_at     TEXT,
       decided_by     TEXT,
       created_at     TEXT NOT NULL DEFAULT (${NOW})
     )`,
    `CREATE INDEX IF NOT EXISTS idx_grade_sessions_member ON grade_sessions(member_id)`,
    `CREATE INDEX IF NOT EXISTS idx_grade_sessions_status ON grade_sessions(status, scheduled_date)`,

    // Championnats. Categories et poids sont du texte libre : les
    // federations ne les decoupent pas de la meme facon d'un sport a l'autre.
    `CREATE TABLE IF NOT EXISTS championships (
       id            TEXT PRIMARY KEY,
       name          TEXT NOT NULL,
       event_date    TEXT NOT NULL,
       location      TEXT,
       discipline_id TEXT REFERENCES disciplines(id) ON DELETE SET NULL,
       branch_id     TEXT REFERENCES branches(id) ON DELETE SET NULL,
       status        TEXT NOT NULL DEFAULT 'upcoming'
                       CHECK (status IN ('upcoming','ongoing','completed','cancelled')),
       notes         TEXT,
       created_at    TEXT NOT NULL DEFAULT (${NOW})
     )`,
    `CREATE INDEX IF NOT EXISTS idx_championships_date ON championships(event_date DESC)`,

    `CREATE TABLE IF NOT EXISTS championship_athletes (
       id              TEXT PRIMARY KEY,
       championship_id TEXT NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
       member_id       TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
       category        TEXT,
       weight_class    TEXT,
       place           INTEGER CHECK (place IS NULL OR place BETWEEN 1 AND 3),
       result_notes    TEXT,
       added_at        TEXT NOT NULL DEFAULT (${NOW}),
       UNIQUE (championship_id, member_id)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_champ_athletes ON championship_athletes(championship_id)`,
  ],
})

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version
