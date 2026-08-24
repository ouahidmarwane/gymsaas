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
    //
    // SUPPRIMEES EN v8. Ces tables ne sont plus utilisees par personne : la
    // fonctionnalite a ete retiree du produit. Les instructions restent ici
    // parce qu'une migration passee ne se reecrit pas — sinon une meme
    // version decrirait deux schemas differents selon l'anciennete du club.
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

MIGRATIONS.push({
  version: 3,
  name: 'paiements-figes-et-annulations',
  statements: [
    // La table est RECONSTRUITE, pas simplement etendue.
    //
    // Une annulation s'ecrit en montant negatif : c'est ce qui rend tout
    // SUM(amount_cents) juste pour toujours, sans qu'aucune requete future
    // n'ait a se souvenir d'un CASE. Or le CHECK (amount_cents >= 0) l'
    // interdisait, et SQLite ne sait pas retirer une contrainte autrement
    // qu'en refaisant la table.
    //
    // L'alternative — garder des montants positifs et un drapeau — reportait
    // la correction sur chaque SUM : un seul oubli et les totaux mentent.
    `CREATE TABLE payments_v3 (
       id            TEXT PRIMARY KEY,
       member_id     TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,

       -- Montant FIGE a la creation. Aucun tarif modifie ensuite ne doit
       -- pouvoir le changer : une ligne passee est un fait, pas un calcul.
       -- Negatif uniquement pour une annulation.
       amount_cents  INTEGER NOT NULL,

       type          TEXT NOT NULL
                       CHECK (type IN ('monthly','insurance','registration','other')),

       -- Moyen de paiement. Pas de CHECK : la liste des moyens evoluera plus
       -- vite que le schema, et une valeur inconnue vaut mieux qu'un refus.
       method        TEXT,

       -- Tarif en vigueur au moment de l'encaissement, conserve pour l'audit
       -- seulement. Il n'entre dans aucun calcul : c'est amount_cents qui
       -- fait foi. Il sert a expliquer un ecart, pas a le corriger.
       tariff_cents  INTEGER,

       -- Ligne annulee par celle-ci. Une annulation ne modifie jamais
       -- l'originale : les deux coexistent, et leur somme vaut zero.
       reverses_id   TEXT,
       reversal_reason TEXT,

       paid_at       TEXT NOT NULL DEFAULT (date('now')),
       branch_id     TEXT REFERENCES branches(id) ON DELETE SET NULL,
       discipline_id TEXT REFERENCES disciplines(id) ON DELETE SET NULL,
       notes         TEXT,
       recorded_by   TEXT,
       created_at    TEXT NOT NULL DEFAULT (${NOW})
     )`,

    `INSERT INTO payments_v3
       (id, member_id, amount_cents, type, paid_at, branch_id, discipline_id,
        notes, recorded_by, created_at)
     SELECT id, member_id, amount_cents, type, paid_at, branch_id, discipline_id,
            notes, recorded_by, created_at
       FROM payments`,

    `DROP TABLE payments`,
    `ALTER TABLE payments_v3 RENAME TO payments`,

    `CREATE INDEX IF NOT EXISTS idx_payments_member ON payments(member_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payments_date   ON payments(paid_at DESC)`,

    // Index couvrants : la comptabilite filtre par salle sur une periode, et
    // ventile par type. Sans eux, chaque filtre balaie toute la table.
    `CREATE INDEX IF NOT EXISTS idx_payments_branch_date ON payments(branch_id, paid_at)`,
    `CREATE INDEX IF NOT EXISTS idx_payments_type_date   ON payments(type, paid_at)`,
    // Retrouver l'annulation d'une ligne, et empecher d'en poser deux.
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_reverses
       ON payments(reverses_id) WHERE reverses_id IS NOT NULL`,
  ],
})

MIGRATIONS.push({
  version: 4,
  name: 'distinguer-erreur-et-remboursement',
  statements: [
    // Deux gestes que rien ne distinguait, et qui ne se datent pas pareil.
    //
    //   'erreur'        — la ligne n'aurait jamais du exister. On la date au
    //                     jour de l'originale : mai doit l'oublier.
    //   'remboursement' — l'argent est bien entre en mai et bien ressorti en
    //                     aout. Backdater effacerait une recette reelle de mai
    //                     et cacherait une sortie reelle d'aout : le releve de
    //                     caisse mentirait deux fois.
    //
    // Les annulations posees avant cette migration sont des corrections
    // d'erreur : c'etait le seul geste disponible.
    `ALTER TABLE payments ADD COLUMN reversal_kind TEXT`,
    `UPDATE payments SET reversal_kind = 'erreur' WHERE reverses_id IS NOT NULL`,
  ],
})

MIGRATIONS.push({
  version: 5,
  name: 'piece-identite-du-membre',
  statements: [
    // Une seule piece d'identite par membre, et deux types possibles : la
    // carte nationale ou le passeport. Un Marocain a l'une, un etranger
    // l'autre ; personne n'a besoin des deux, et deux emplacements auraient
    // laisse la moitie des fiches a moitie remplies sans qu'on sache si
    // c'est un oubli ou si l'autre document n'existe pas.
    //
    // Le CHECK ne bloque rien sur les lignes deja la : en SQLite une
    // contrainte n'echoue que si elle vaut FAUX, et « NULL IN (...) » vaut
    // NULL. Les membres existants restent donc valides, sans piece.
    `ALTER TABLE members ADD COLUMN id_doc_type TEXT
       CHECK (id_doc_type IN ('cin','passeport'))`,
    `ALTER TABLE members ADD COLUMN id_doc_number TEXT`,
    // La cle R2, jamais l'URL : le fichier est servi par le Worker, qui
    // verifie a chaque appel que le demandeur appartient bien au club.
    `ALTER TABLE members ADD COLUMN id_doc_key TEXT`,
    `ALTER TABLE members ADD COLUMN id_doc_at TEXT`,
  ],
})

MIGRATIONS.push({
  version: 6,
  name: 'date-de-la-photo',
  statements: [
    // La colonne photo_key existe depuis l'origine, mais rien ne datait le
    // depot. Sans cette date, la photo est servie a une adresse fixe : le
    // navigateur garde l'ancienne en cache et le club croit que le
    // remplacement a echoue. La date entre dans l'adresse et la change.
    `ALTER TABLE members ADD COLUMN photo_at TEXT`,
  ],
})

MIGRATIONS.push({
  version: 7,
  name: 'correction-d-un-resultat-de-passage',
  statements: [
    // Un resultat mal saisi doit pouvoir etre corrige, sans jamais etre
    // reecrit — meme regle que pour un encaissement errone.
    //
    // La correction est une NOUVELLE ligne qui designe celle qu'elle
    // remplace. L'ancienne reste, avec sa date et son auteur : c'est la
    // seule facon de savoir, six mois plus tard, qu'il y a eu une erreur et
    // qui l'a corrigee. Un UPDATE en place aurait efface l'incident.
    //
    // Aucun statut « annule » n'est ajoute : une ligne est corrigee s'il en
    // existe une autre qui la designe. L'etat se deduit a la lecture, comme
    // partout ailleurs ici — et cela evite de reconstruire la table pour
    // elargir une contrainte CHECK.
    `ALTER TABLE grade_sessions ADD COLUMN corrects_id TEXT
       REFERENCES grade_sessions(id) ON DELETE SET NULL`,
    `ALTER TABLE grade_sessions ADD COLUMN correction_reason TEXT`,
    // Une seule correction par resultat : deux corrections concurrentes du
    // meme passage laisseraient la ceinture dependre de l'ordre d'arrivee.
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_grade_sessions_corrects
       ON grade_sessions(corrects_id) WHERE corrects_id IS NOT NULL`,
  ],
})

MIGRATIONS.push({
  version: 8,
  name: 'retrait-des-championnats',
  statements: [
    // La fonctionnalite « Championnats » est retiree du produit : la
    // clientele fait surtout de la musculation, l'ecran restait vide.
    //
    // On AJOUTE une migration de suppression, on ne retouche pas la v2 qui
    // les creait. Les bases deja ouvertes sont en v7 : effacer le CREATE
    // d'une migration passee ferait qu'une meme version decrirait deux
    // schemas differents selon l'historique de chaque club — precisement ce
    // qu'un journal de migrations versionne existe pour empecher. Un club
    // neuf cree donc ces tables en v2 puis les supprime en v8 ; c'est le
    // prix d'un journal qui reste vrai.
    //
    // L'ordre compte : les athletes referencent les championnats.
    `DROP TABLE IF EXISTS championship_athletes`,
    `DROP TABLE IF EXISTS championships`,
    // Les traces d'audit restent : elles racontent ce qui s'est passe, et
    // ne referencent aucune table supprimee.
  ],
})

MIGRATIONS.push({
  version: 9,
  name: 'messagerie-du-club',
  statements: [
    `CREATE TABLE IF NOT EXISTS conversations (
       id          TEXT PRIMARY KEY,
       type        TEXT NOT NULL CHECK (type IN ('dm','group','team')),
       name        TEXT,
       description TEXT,
       created_by  TEXT NOT NULL,
       is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1)),
       created_at  TEXT NOT NULL DEFAULT (${NOW}),
       updated_at  TEXT NOT NULL DEFAULT (${NOW})
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_team
       ON conversations(type) WHERE type = 'team'`,
    `CREATE TABLE IF NOT EXISTS conversation_members (
       conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
       user_id         TEXT NOT NULL,
       display_name    TEXT NOT NULL,
       role            TEXT,
       is_admin        INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0,1)),
       joined_at       TEXT NOT NULL DEFAULT (${NOW}),
       removed_at      TEXT,
       PRIMARY KEY (conversation_id, user_id)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_conversation_members_user
       ON conversation_members(user_id, removed_at, conversation_id)`,
    `CREATE TABLE IF NOT EXISTS messages (
       id              TEXT PRIMARY KEY,
       conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
       author_id       TEXT NOT NULL,
       author_name     TEXT NOT NULL,
       body            TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
       reply_to_id     TEXT REFERENCES messages(id) ON DELETE SET NULL,
       created_at      TEXT NOT NULL DEFAULT (${NOW})
     )`,
    `CREATE INDEX IF NOT EXISTS idx_messages_conversation_cursor
       ON messages(conversation_id, created_at DESC, id DESC)`,
    `CREATE TABLE IF NOT EXISTS message_mentions (
       message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
       user_id    TEXT NOT NULL,
       PRIMARY KEY (message_id, user_id)
     )`,
    `CREATE TABLE IF NOT EXISTS message_reactions (
       message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
       user_id    TEXT NOT NULL,
       emoji      TEXT NOT NULL CHECK (emoji IN ('👍','❤️','😂','👏')),
       created_at TEXT NOT NULL DEFAULT (${NOW}),
       PRIMARY KEY (message_id, user_id, emoji)
     )`,
    `CREATE TABLE IF NOT EXISTS conversation_reads (
       conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
       user_id         TEXT NOT NULL,
       last_read_at    TEXT NOT NULL DEFAULT (${NOW}),
       last_read_message_id TEXT NOT NULL DEFAULT '',
       PRIMARY KEY (conversation_id, user_id)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_conversation_reads_user
       ON conversation_reads(user_id, conversation_id)`,
  ],
})

MIGRATIONS.push({
  version: 10,
  name: 'pieces-jointes-messagerie',
  statements: [
    `CREATE TABLE IF NOT EXISTS message_attachments (
       id           TEXT PRIMARY KEY,
       message_id   TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
       file_key     TEXT NOT NULL UNIQUE,
       file_name    TEXT NOT NULL,
       content_type TEXT NOT NULL,
       size_bytes   INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
       kind         TEXT NOT NULL CHECK (kind IN ('image','file')),
       created_at   TEXT NOT NULL DEFAULT (${NOW})
     )`,
    `CREATE INDEX IF NOT EXISTS idx_message_attachments_message
       ON message_attachments(message_id, id)`,
  ],
})

MIGRATIONS.push({
  version: 11,
  name: 'idempotence-financiere',
  statements: [
    // Le resultat fait partie de la meme transaction SQLite que la mutation.
    // Une reponse perdue peut donc etre rejouee sans repeter l'encaissement.
    `CREATE TABLE financial_idempotency (
       actor_id     TEXT NOT NULL,
       org_id       TEXT NOT NULL,
       operation    TEXT NOT NULL,
       idem_key     TEXT NOT NULL,
       payload_hash TEXT NOT NULL,
       result_json  TEXT NOT NULL,
       created_at   TEXT NOT NULL DEFAULT (${NOW}),
       PRIMARY KEY (actor_id, org_id, operation, idem_key)
     )`,
    `CREATE INDEX idx_financial_idempotency_created
       ON financial_idempotency(created_at)`,
  ],
})

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version
