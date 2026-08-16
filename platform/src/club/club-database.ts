import { DurableObject } from 'cloudflare:workers'
import { MIGRATIONS, LATEST_VERSION } from './schema'
import { CYCLE_MONTHS, anchorMonthOf, nextGradeDate } from './grade-cycle'
import type { Env } from '../env'

// Base de donnees d'un club : un Durable Object SQLite par club.
//
// L'objet est adresse par nom (idFromName(orgId)). Il est cree a la premiere
// utilisation, sans redeploiement ni binding supplementaire. C'est ce qui rend
// l'inscription self-service possible, la ou une base D1 par club exigerait de
// redeployer le Worker a chaque nouveau client.
//
// Isolation : le stockage appartient a l'objet. Il n'existe aucune requete,
// meme malveillante, capable d'atteindre les donnees d'un autre club. Ce n'est
// pas une politique, c'est la structure.
//
// Concurrence : un Durable Object est mono-thread. Les ecritures d'un club
// sont donc naturellement serialisees, sans verrou applicatif.

const NOW = "strftime('%Y-%m-%dT%H:%M:%SZ','now')"

export class ClubDatabase extends DurableObject<Env> {
  private sql: SqlStorage

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql

    // blockConcurrencyWhile garantit qu'aucune requete n'est servie avant la
    // fin des migrations : un appel pendant l'initialisation attend au lieu
    // de lire une base a moitie construite.
    ctx.blockConcurrencyWhile(async () => this.migrate())
  }

  /** Applique les migrations manquantes. Idempotent. */
  private migrate(): void {
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _schema_version (
         version    INTEGER PRIMARY KEY,
         applied_at TEXT NOT NULL DEFAULT (${NOW})
       )`,
    )

    const current = this.schemaVersion()
    if (current >= LATEST_VERSION) return

    for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue
      for (const statement of migration.statements) {
        this.sql.exec(statement)
      }
      this.sql.exec('INSERT INTO _schema_version (version) VALUES (?)', migration.version)
    }
  }

  /** Version de schema appliquee, utile pour le suivi cote plateforme. */
  schemaVersion(): number {
    return this.sql
      .exec<{ v: number | null }>('SELECT MAX(version) AS v FROM _schema_version')
      .one().v ?? 0
  }

  /**
   * Un club neuf demarre VIDE : aucune succursale, aucune discipline.
   *
   * Rien n'est presuppose du sport pratique ni du nombre de salles : on le
   * demande au club. L'ancienne version figeait karate / full contact /
   * aerobic et deux succursales dans le schema, ce qui rendait le produit
   * invendable a tout autre club.
   */
  isConfigured(): boolean {
    return (
      this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM branches').one().n > 0 &&
      this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM disciplines').one().n > 0
    )
  }

  /**
   * Ce que le club sait faire, en une requete.
   *
   * Sert a n'afficher que les ecrans qui ont un sens ici : un club de boxe
   * sans ceinture n'a rien a voir dans « Passage de grade ». La reponse
   * decrit le club, elle n'est pas une preference d'affichage.
   */
  capabilities(): {
    configured: boolean
    branchCount: number
    disciplineCount: number
    hasGrading: boolean
  } {
    const row = this.sql.exec<{
      branches: number; disciplines: number; graded: number
    }>(
      `SELECT
         (SELECT COUNT(*) FROM branches    WHERE is_active = 1) AS branches,
         (SELECT COUNT(*) FROM disciplines WHERE is_active = 1) AS disciplines,
         (SELECT COUNT(*) FROM disciplines WHERE is_active = 1 AND has_grading = 1) AS graded`,
    ).one()

    return {
      configured: row.branches > 0 && row.disciplines > 0,
      branchCount: row.branches,
      disciplineCount: row.disciplines,
      hasGrading: row.graded > 0,
    }
  }

  // Succursales ----------------------------------------------------------

  listBranches(includeInactive = false) {
    return this.sql
      .exec(
        `SELECT * FROM branches ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY name`,
      )
      .toArray()
  }

  addBranch(input: { name: string; nameAr?: string | null; address?: string | null }): { id: string } {
    const id = crypto.randomUUID()
    this.sql.exec(
      'INSERT INTO branches (id, name, name_ar, address) VALUES (?, ?, ?, ?)',
      id, input.name, input.nameAr ?? null, input.address ?? null,
    )
    return { id }
  }

  updateBranch(id: string, input: { name?: string; nameAr?: string | null; address?: string | null }): void {
    this.sql.exec(
      `UPDATE branches
          SET name    = COALESCE(?, name),
              name_ar = COALESCE(?, name_ar),
              address = COALESCE(?, address)
        WHERE id = ?`,
      input.name ?? null, input.nameAr ?? null, input.address ?? null, id,
    )
  }

  /**
   * Desactivation, jamais suppression : les membres et les paiements deja
   * rattaches a cette succursale doivent rester lisibles.
   */
  deactivateBranch(id: string): void {
    this.sql.exec('UPDATE branches SET is_active = 0 WHERE id = ?', id)
  }

  // Disciplines ----------------------------------------------------------

  listDisciplines(includeInactive = false) {
    const rows = this.sql
      .exec(
        `SELECT * FROM disciplines ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY name`,
      )
      .toArray() as Array<Record<string, unknown>>

    // Chaque discipline porte sa propre echelle de grades, si elle en a une.
    return rows.map(d => ({
      ...d,
      grades: d.has_grading
        ? this.sql
            .exec('SELECT * FROM grade_levels WHERE discipline_id = ? ORDER BY rank', d.id as string)
            .toArray()
        : [],
    }))
  }

  /**
   * Ajoute une discipline et, si elle est gradee, son echelle complete.
   * L'echelle est fournie par le club : ceintures de karate, kyu/dan de judo,
   * geup de taekwondo, ou rien du tout pour une activite non gradee.
   */
  addDiscipline(input: {
    name: string
    nameAr?: string | null
    hasGrading: boolean
    grades?: Array<{ label: string; labelAr?: string | null; color?: string | null }>
  }): { id: string } {
    const id = crypto.randomUUID()

    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        'INSERT INTO disciplines (id, name, name_ar, has_grading) VALUES (?, ?, ?, ?)',
        id, input.name, input.nameAr ?? null, input.hasGrading ? 1 : 0,
      )
      if (input.hasGrading && input.grades?.length) {
        input.grades.forEach((g, index) => {
          this.sql.exec(
            `INSERT INTO grade_levels (id, discipline_id, rank, label, label_ar, color)
             VALUES (?, ?, ?, ?, ?, ?)`,
            crypto.randomUUID(), id, index, g.label, g.labelAr ?? null, g.color ?? null,
          )
        })
      }
    })

    return { id }
  }

  /** Remplace l'echelle de grades d'une discipline. */
  setGradeLadder(
    disciplineId: string,
    grades: Array<{ label: string; labelAr?: string | null; color?: string | null }>,
  ): void {
    this.ctx.storage.transactionSync(() => {
      // Les membres conservent leur grade_id : on ne supprime que les
      // niveaux devenus orphelins, la colonne passant alors a NULL via la
      // contrainte ON DELETE SET NULL.
      this.sql.exec('DELETE FROM grade_levels WHERE discipline_id = ?', disciplineId)
      grades.forEach((g, index) => {
        this.sql.exec(
          `INSERT INTO grade_levels (id, discipline_id, rank, label, label_ar, color)
           VALUES (?, ?, ?, ?, ?, ?)`,
          crypto.randomUUID(), disciplineId, index, g.label, g.labelAr ?? null, g.color ?? null,
        )
      })
      this.sql.exec(
        'UPDATE disciplines SET has_grading = ? WHERE id = ?',
        grades.length ? 1 : 0, disciplineId,
      )
    })
  }

  deactivateDiscipline(id: string): void {
    this.sql.exec('UPDATE disciplines SET is_active = 0 WHERE id = ?', id)
  }

  // Reglages et disposition ----------------------------------------------

  getSetting(key: string): unknown {
    const row = this.sql
      .exec<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)
      .toArray()[0]
    if (!row) return null
    try {
      return JSON.parse(row.value)
    } catch {
      return null
    }
  }

  setSetting(key: string, value: unknown): void {
    this.sql.exec(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                      updated_at = ${NOW}`,
      key,
      JSON.stringify(value),
    )
  }

  // Membres --------------------------------------------------------------

  listMembers(opts: {
    limit?: number; offset?: number; search?: string
    /** Filtre discipline, pilote par la barre du haut. */
    disciplineId?: string | null
  } = {}) {
    // Bornes resistantes a NaN : Math.min(Math.max(NaN, 1), 200) vaut NaN,
    // qui atteindrait le LIMIT et le viderait de son sens.
    const clamp = (v: number | undefined, min: number, max: number, fallback: number) =>
      Number.isFinite(v) ? Math.min(Math.max(Math.trunc(v!), min), max) : fallback
    const limit = clamp(opts.limit, 1, 200, 50)
    const offset = clamp(opts.offset, 0, 1_000_000, 0)

    const select = `
      SELECT m.*, b.name AS branch_name,
             d.name AS discipline_name, d.has_grading,
             g.label AS grade_label, g.color AS grade_color
        FROM members m
        LEFT JOIN branches     b ON b.id = m.branch_id
        LEFT JOIN disciplines  d ON d.id = m.discipline_id
        LEFT JOIN grade_levels g ON g.id = m.grade_id
       WHERE m.status != 'archived'`

    // Toujours des requetes parametrees : l'entree utilisateur ne rejoint
    // jamais le texte SQL. Le filtre discipline s'ajoute comme condition,
    // il ne se concatene pas.
    const conditions: string[] = []
    const params: unknown[] = []
    if (opts.disciplineId) {
      conditions.push('m.discipline_id = ?')
      params.push(opts.disciplineId)
    }
    if (opts.search) {
      conditions.push('(m.name LIKE ? OR m.phone LIKE ?)')
      params.push(`%${opts.search}%`, `%${opts.search}%`)
    }
    const extra = conditions.length ? ` AND ${conditions.join(' AND ')}` : ''

    return this.sql
      .exec(
        `${select}${extra} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
        ...params, limit, offset,
      )
      .toArray()
  }

  countMembers(): number {
    return this.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM members WHERE status = 'active'")
      .one().n
  }

  addMember(input: {
    name: string
    phone: string
    email?: string | null
    branchId?: string | null
    disciplineId?: string | null
    subExpiry?: string | null
    // Date d'adhesion reelle : un club qui reprend son fichier papier inscrit
    // des membres arrives il y a trois ans. Sans elle, la comptabilite
    // previsionnelle les compterait tous comme des inscriptions du jour.
    joinDate?: string | null
    isInsured?: boolean
    insExpiry?: string | null
    actorId?: string
    actorName?: string
  }): { id: string } {
    const id = crypto.randomUUID()

    // Une transaction couvre l'insertion et sa trace : jamais l'une sans
    // l'autre. Sur un Durable Object elle est synchrone et locale.
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO members (id, name, phone, email, branch_id, discipline_id,
                              sub_expiry, join_date, is_insured, ins_expiry, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, date('now')), ?, ?, ?)`,
        id,
        input.name,
        input.phone,
        input.email ?? null,
        input.branchId ?? null,
        input.disciplineId ?? null,
        input.subExpiry ?? null,
        input.joinDate ?? null,
        input.isInsured ? 1 : 0,
        input.insExpiry ?? null,
        input.actorId ?? null,
      )
      this.sql.exec(
        `INSERT INTO audit_logs (action, entity, entity_id, entity_name, actor_id, actor_name)
         VALUES ('member_add', 'member', ?, ?, ?, ?)`,
        id,
        input.name,
        input.actorId ?? null,
        input.actorName ?? null,
      )
    })

    return { id }
  }

  updateMember(id: string, input: {
    name?: string
    phone?: string
    email?: string | null
    branchId?: string | null
    disciplineId?: string | null
    gradeId?: string | null
    subExpiry?: string | null
    insExpiry?: string | null
    joinDate?: string | null
    isInsured?: boolean
    notes?: string | null
    status?: 'active' | 'inactive' | 'archived'
    actorId?: string
    actorName?: string
  }): void {
    // COALESCE partout : un champ absent garde sa valeur. Le formulaire peut
    // donc n'envoyer que ce qui a change.
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `UPDATE members SET
           name          = COALESCE(?, name),
           phone         = COALESCE(?, phone),
           email         = COALESCE(?, email),
           branch_id     = COALESCE(?, branch_id),
           discipline_id = COALESCE(?, discipline_id),
           grade_id      = COALESCE(?, grade_id),
           sub_expiry    = COALESCE(?, sub_expiry),
           ins_expiry    = COALESCE(?, ins_expiry),
           join_date     = COALESCE(?, join_date),
           is_insured    = COALESCE(?, is_insured),
           notes         = COALESCE(?, notes),
           status        = COALESCE(?, status)
         WHERE id = ?`,
        input.name ?? null, input.phone ?? null, input.email ?? null,
        input.branchId ?? null, input.disciplineId ?? null, input.gradeId ?? null,
        input.subExpiry ?? null, input.insExpiry ?? null, input.joinDate ?? null,
        input.isInsured === undefined ? null : (input.isInsured ? 1 : 0),
        input.notes ?? null, input.status ?? null, id,
      )
      this.sql.exec(
        `INSERT INTO audit_logs (action, entity, entity_id, actor_id, actor_name)
         VALUES ('member_update', 'member', ?, ?, ?)`,
        id, input.actorId ?? null, input.actorName ?? null,
      )
    })
  }

  /** Une fiche seule, pour les gestes qui doivent verifier qu'elle existe. */
  getMember(id: string) {
    return this.sql
      .exec(
        `SELECT m.*, b.name AS branch_name,
                d.name AS discipline_name, d.has_grading,
                g.label AS grade_label, g.color AS grade_color
           FROM members m
           LEFT JOIN branches     b ON b.id = m.branch_id
           LEFT JOIN disciplines  d ON d.id = m.discipline_id
           LEFT JOIN grade_levels g ON g.id = m.grade_id
          WHERE m.id = ?`,
        id,
      )
      .toArray()[0] ?? null
  }

  /**
   * Pose ou remplace la piece d'identite d'un membre.
   *
   * Renvoie l'ancienne cle : c'est le routeur qui parle a R2, et sans cette
   * valeur le fichier remplace resterait dans le bucket pour toujours —
   * une piece d'identite oubliee, que plus rien ne designe et que personne
   * ne pense a effacer.
   *
   * `fileKey` absent laisse le fichier en place : on peut corriger un
   * numero mal saisi sans redemander le scan.
   */
  setMemberDocument(input: {
    memberId: string
    docType: 'cin' | 'passeport'
    docNumber?: string | null
    fileKey?: string | null
    actorId?: string
    actorName?: string
  }): { previousKey: string | null } {
    const row = this.sql
      .exec<{ id_doc_key: string | null; name: string }>(
        'SELECT id_doc_key, name FROM members WHERE id = ?', input.memberId,
      ).toArray()[0]
    if (!row) throw new Error('Membre inconnu')

    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `UPDATE members SET
           id_doc_type   = ?,
           id_doc_number = ?,
           id_doc_key    = COALESCE(?, id_doc_key),
           id_doc_at     = ${NOW}
         WHERE id = ?`,
        input.docType, input.docNumber ?? null, input.fileKey ?? null, input.memberId,
      )
      // Une piece d'identite est une donnee personnelle : qui l'a deposee et
      // quand doit rester lisible sans avoir a fouiller les journaux R2.
      this.sql.exec(
        `INSERT INTO audit_logs (action, entity, entity_id, entity_name, actor_id, actor_name)
         VALUES ('member_document_set', 'member', ?, ?, ?, ?)`,
        input.memberId, row.name, input.actorId ?? null, input.actorName ?? null,
      )
    })

    // L'ancienne cle n'est rendue que si elle est effectivement remplacee.
    return { previousKey: input.fileKey ? row.id_doc_key : null }
  }

  /**
   * Photo du membre.
   *
   * Meme mecanique que la piece d'identite, mais separee : une photo se
   * montre a l'accueil, une carte nationale se garde. Les melanger reviendrait
   * a donner le meme droit de lecture aux deux.
   *
   * La date de depot est enregistree parce qu'elle entre dans l'adresse du
   * fichier : sans elle, le navigateur reafficherait l'ancienne photo apres
   * un remplacement.
   */
  setMemberPhoto(input: {
    memberId: string
    fileKey: string
    actorId?: string
    actorName?: string
  }): { previousKey: string | null } {
    const row = this.sql
      .exec<{ photo_key: string | null; name: string }>(
        'SELECT photo_key, name FROM members WHERE id = ?', input.memberId,
      ).toArray()[0]
    if (!row) throw new Error('Membre inconnu')

    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `UPDATE members SET photo_key = ?, photo_at = ${NOW} WHERE id = ?`,
        input.fileKey, input.memberId,
      )
      this.sql.exec(
        `INSERT INTO audit_logs (action, entity, entity_id, entity_name, actor_id, actor_name)
         VALUES ('member_photo_set', 'member', ?, ?, ?, ?)`,
        input.memberId, row.name, input.actorId ?? null, input.actorName ?? null,
      )
    })

    return { previousKey: row.photo_key }
  }

  clearMemberPhoto(memberId: string, actor: { id?: string; name?: string }):
  { previousKey: string | null } {
    const row = this.sql
      .exec<{ photo_key: string | null; name: string }>(
        'SELECT photo_key, name FROM members WHERE id = ?', memberId,
      ).toArray()[0]
    if (!row) throw new Error('Membre inconnu')

    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        'UPDATE members SET photo_key = NULL, photo_at = NULL WHERE id = ?', memberId,
      )
      this.sql.exec(
        `INSERT INTO audit_logs (action, entity, entity_id, entity_name, actor_id, actor_name)
         VALUES ('member_photo_clear', 'member', ?, ?, ?, ?)`,
        memberId, row.name, actor.id ?? null, actor.name ?? null,
      )
    })

    return { previousKey: row.photo_key }
  }

  /** Retire la piece et rend sa cle, pour que le routeur efface le fichier. */
  clearMemberDocument(memberId: string, actor: { id?: string; name?: string }):
  { previousKey: string | null } {
    const row = this.sql
      .exec<{ id_doc_key: string | null; name: string }>(
        'SELECT id_doc_key, name FROM members WHERE id = ?', memberId,
      ).toArray()[0]
    if (!row) throw new Error('Membre inconnu')

    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `UPDATE members SET id_doc_type = NULL, id_doc_number = NULL,
                            id_doc_key = NULL, id_doc_at = NULL
          WHERE id = ?`, memberId,
      )
      this.sql.exec(
        `INSERT INTO audit_logs (action, entity, entity_id, entity_name, actor_id, actor_name)
         VALUES ('member_document_clear', 'member', ?, ?, ?, ?)`,
        memberId, row.name, actor.id ?? null, actor.name ?? null,
      )
    })

    return { previousKey: row.id_doc_key }
  }

  archiveMember(id: string, actor: { id?: string; name?: string }): void {
    // Archive plutot que supprime : les paiements deja encaisses doivent
    // rester rattaches a quelqu'un.
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("UPDATE members SET status = 'archived' WHERE id = ?", id)
      this.sql.exec(
        `INSERT INTO audit_logs (action, entity, entity_id, actor_id, actor_name)
         VALUES ('member_archive', 'member', ?, ?, ?)`,
        id, actor.id ?? null, actor.name ?? null,
      )
    })
  }

  /** Renouvelle l'abonnement d'un mois ET enregistre l'encaissement. */
  renewSubscription(input: {
    memberId: string
    amountCents: number
    actorId?: string
    actorName?: string
  }): { subExpiry: string } {
    const member = this.sql
      .exec<{ sub_expiry: string | null; branch_id: string | null; discipline_id: string | null }>(
        'SELECT sub_expiry, branch_id, discipline_id FROM members WHERE id = ?', input.memberId,
      ).one()

    // Prolonge depuis l'echeance si elle court encore, sinon depuis
    // aujourd'hui : renouveler en avance ne doit pas faire perdre de jours.
    const today = new Date().toISOString().slice(0, 10)
    const from = member.sub_expiry && member.sub_expiry > today ? member.sub_expiry : today
    const next = new Date(`${from}T00:00:00Z`)
    next.setUTCMonth(next.getUTCMonth() + 1)
    const subExpiry = next.toISOString().slice(0, 10)

    this.ctx.storage.transactionSync(() => {
      this.sql.exec('UPDATE members SET sub_expiry = ? WHERE id = ?', subExpiry, input.memberId)
      // L'encaissement accompagne le renouvellement : les separer laissait la
      // comptabilite diverger de la realite des le premier oubli.
      if (input.amountCents > 0) {
        this.sql.exec(
          `INSERT INTO payments (id, member_id, amount_cents, type, branch_id, discipline_id, recorded_by)
           VALUES (?, ?, ?, 'monthly', ?, ?, ?)`,
          crypto.randomUUID(), input.memberId, input.amountCents,
          member.branch_id, member.discipline_id, input.actorId ?? null,
        )
      }
      this.sql.exec(
        `INSERT INTO audit_logs (action, entity, entity_id, detail, actor_id, actor_name)
         VALUES ('subscription_renew', 'member', ?, ?, ?, ?)`,
        input.memberId, subExpiry, input.actorId ?? null, input.actorName ?? null,
      )
    })

    return { subExpiry }
  }

  /**
   * Prolonge l'assurance d'un membre.
   *
   * Le point de depart est la date d'echeance quand elle court encore, et
   * aujourd'hui quand elle est passee : prolonger depuis une date perimee
   * ferait cadeau des mois de retard.
   */
  renewInsurance(input: {
    memberId: string
    months: number
    charge: boolean
    actorId?: string
    actorName?: string
  }): { insExpiry: string } {
    const member = this.sql.exec<{
      ins_expiry: string | null; name: string
      branch_id: string | null; discipline_id: string | null
    }>(
      'SELECT ins_expiry, name, branch_id, discipline_id FROM members WHERE id = ?',
      input.memberId,
    ).one()

    const today = new Date().toISOString().slice(0, 10)
    const start = member.ins_expiry && member.ins_expiry > today ? member.ins_expiry : today
    const next = new Date(`${start}T00:00:00Z`)
    next.setUTCMonth(next.getUTCMonth() + input.months)
    const insExpiry = next.toISOString().slice(0, 10)

    const price = this.getPrices().insuranceCents

    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        'UPDATE members SET is_insured = 1, ins_expiry = ? WHERE id = ?',
        insExpiry, input.memberId,
      )
      if (input.charge && price > 0) {
        this.sql.exec(
          `INSERT INTO payments (id, member_id, amount_cents, type, tariff_cents,
                                 branch_id, discipline_id, recorded_by)
           VALUES (?, ?, ?, 'insurance', ?, ?, ?, ?)`,
          crypto.randomUUID(), input.memberId, price, price,
          member.branch_id, member.discipline_id, input.actorId ?? null,
        )
      }
      this.sql.exec(
        `INSERT INTO audit_logs (action, entity, entity_id, entity_name, detail, actor_id, actor_name)
         VALUES ('insurance_renew', 'member', ?, ?, ?, ?, ?)`,
        input.memberId, member.name, insExpiry, input.actorId ?? null, input.actorName ?? null,
      )
    })

    return { insExpiry }
  }

  // Paiements --------------------------------------------------------------

  /**
   * Lignes d'encaissement, filtrees par periode.
   *
   * `from` / `to` bornent sur des dates completes ; `year` / `month` restent
   * acceptes pour ne pas casser les appels existants. Les deux formes se
   * combinent, la plus restrictive gagne.
   */
  listPayments(opts: {
    year?: number; month?: number; from?: string; to?: string
    branchId?: string | null; limit?: number
  } = {}) {
    const limit = Number.isFinite(opts.limit) ? Math.min(Math.max(opts.limit!, 1), 500) : 300
    const conditions: string[] = []
    const params: unknown[] = []

    if (Number.isFinite(opts.year)) {
      conditions.push("strftime('%Y', p.paid_at) = ?")
      params.push(String(opts.year))
    }
    if (Number.isFinite(opts.month)) {
      conditions.push("strftime('%m', p.paid_at) = ?")
      params.push(String(opts.month).padStart(2, '0'))
    }
    if (opts.from) { conditions.push('p.paid_at >= ?'); params.push(opts.from) }
    if (opts.to) { conditions.push('p.paid_at <= ?'); params.push(opts.to) }
    if (opts.branchId) { conditions.push('p.branch_id = ?'); params.push(opts.branchId) }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    return this.sql.exec(
      `SELECT p.*, m.name AS member_name, b.name AS branch_name,
              o.name AS reversed_member_name
         FROM payments p
         LEFT JOIN members m  ON m.id = p.member_id
         LEFT JOIN branches b ON b.id = p.branch_id
         LEFT JOIN payments r ON r.id = p.reverses_id
         LEFT JOIN members o  ON o.id = r.member_id
         ${where}
        ORDER BY p.paid_at DESC, p.created_at DESC
        LIMIT ?`,
      ...params, limit,
    ).toArray()
  }

  addPayment(input: {
    memberId: string
    amountCents: number
    type: string
    method?: string | null
    paidAt?: string
    notes?: string | null
    actorId?: string
    actorName?: string
  }): { id: string } {
    // L'invariant vit ici, pas seulement dans la route.
    //
    // La reconstruction de table en v3 a retire le CHECK (amount_cents >= 0)
    // pour permettre les annulations en negatif : l'application est donc
    // desormais seule a garantir qu'un encaissement ordinaire est positif.
    // Le placer dans le Durable Object plutot que dans le routeur, c'est le
    // rendre vrai pour tout appelant present et futur.
    if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
      throw new Error('Un encaissement doit etre strictement positif')
    }

    const id = crypto.randomUUID()
    const member = this.sql
      .exec<{ branch_id: string | null; discipline_id: string | null; name: string }>(
        'SELECT branch_id, discipline_id, name FROM members WHERE id = ?', input.memberId,
      ).one()

    // Tarif en vigueur a cet instant, conserve pour l'audit uniquement.
    // C'est amount_cents qui fait foi : un encaissement partiel, une remise
    // ou un tarif change plus tard ne doivent rien changer a la ligne.
    const prices = this.getPrices()
    const tariff = input.type === 'monthly' ? prices.monthlyCents
      : input.type === 'insurance' ? prices.insuranceCents
      : input.type === 'registration' ? prices.registrationCents
      : null

    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO payments (id, member_id, amount_cents, type, method, tariff_cents,
                               paid_at, branch_id, discipline_id, notes, recorded_by)
         VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, date('now')), ?, ?, ?, ?)`,
        id, input.memberId, input.amountCents, input.type, input.method ?? null, tariff,
        input.paidAt ?? null,
        member.branch_id, member.discipline_id, input.notes ?? null, input.actorId ?? null,
      )
      this.sql.exec(
        `INSERT INTO audit_logs (action, entity, entity_id, entity_name, detail, actor_id, actor_name)
         VALUES ('payment_add', 'payment', ?, ?, ?, ?, ?)`,
        id, member.name, String(input.amountCents), input.actorId ?? null, input.actorName ?? null,
      )
    })
    return { id }
  }

  /**
   * Annule un encaissement par une ecriture inverse.
   *
   * On ne modifie ni ne supprime jamais la ligne d'origine : une erreur de
   * saisie fait partie de l'historique, et un releve dont les lignes changent
   * apres coup ne vaut rien. Les deux ecritures coexistent, leur somme vaut
   * zero, et tout SUM reste juste sans traitement particulier.
   */
  reversePayment(input: {
    paymentId: string
    /**
     * 'erreur' : la ligne n'aurait jamais du exister — datee au jour de
     * l'originale, la periode passee l'oublie.
     * 'remboursement' : l'argent est reellement ressorti — date au jour de la
     * sortie, sinon le releve de caisse cache un mouvement reel.
     */
    kind: 'erreur' | 'remboursement'
    reason: string
    /** Jour du remboursement. Ignore pour une correction d'erreur. */
    refundedAt?: string | null
    actorId?: string
    actorName?: string
  }): { id: string; amountCents: number; paidAt: string } {
    const original = this.sql.exec<{
      id: string; member_id: string; amount_cents: number; type: string
      method: string | null; branch_id: string | null; discipline_id: string | null
      reverses_id: string | null; paid_at: string
    }>(
      `SELECT id, member_id, amount_cents, type, method, branch_id, discipline_id,
              reverses_id, paid_at
         FROM payments WHERE id = ?`,
      input.paymentId,
    ).toArray()[0]

    if (!original) throw new Error('Encaissement introuvable')
    // Annuler une annulation reviendrait a re-encaisser en douce, sous une
    // etiquette qui dit le contraire. Si le remboursement etait une erreur,
    // on saisit un nouvel encaissement.
    if (original.reverses_id) throw new Error('Cette ligne est deja une annulation')

    const already = this.sql
      .exec<{ n: number }>('SELECT COUNT(*) AS n FROM payments WHERE reverses_id = ?', input.paymentId)
      .one().n
    if (already > 0) throw new Error('Cet encaissement est deja annule')

    const id = crypto.randomUUID()
    const member = this.sql
      .exec<{ name: string }>('SELECT name FROM members WHERE id = ?', original.member_id)
      .toArray()[0]

    // C'est ici que tout se joue.
    //
    // Une CORRECTION reprend la date de l'originale : la ligne n'aurait
    // jamais du exister, donc la periode passee doit l'oublier, sinon son
    // total reste faux pour toujours.
    //
    // Un REMBOURSEMENT se date au jour ou l'argent est sorti. L'encaissement
    // de mai a bien eu lieu, la sortie d'aout aussi : backdater effacerait
    // une recette reelle et cacherait un decaissement reel — le releve de
    // caisse mentirait sur les deux mois.
    const today = new Date().toISOString().slice(0, 10)
    const paidAt = input.kind === 'erreur'
      ? original.paid_at
      : (input.refundedAt ?? today)

    // Deux bornes, pas une.
    //
    // Avant l'encaissement : aucun sens physique. Apres aujourd'hui : un
    // doigt qui tape 2027 poserait un decaissement dans un mois futur, qui
    // fausserait ce mois-la en silence jusqu'a ce qu'on y arrive. La modale
    // borne deja le champ, mais un appel direct ne passe pas par elle.
    if (input.kind === 'remboursement') {
      if (paidAt < original.paid_at) {
        throw new Error('Un remboursement ne peut pas preceder l encaissement')
      }
      if (paidAt > today) {
        throw new Error('Un remboursement ne peut pas etre date dans le futur')
      }
    }

    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO payments (id, member_id, amount_cents, type, method,
                               reverses_id, reversal_kind, reversal_reason,
                               paid_at, branch_id, discipline_id, recorded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, original.member_id, -original.amount_cents, original.type, original.method,
        original.id, input.kind, input.reason, paidAt,
        original.branch_id, original.discipline_id, input.actorId ?? null,
      )
      this.sql.exec(
        `INSERT INTO audit_logs (action, entity, entity_id, entity_name, detail, actor_id, actor_name)
         VALUES (?, 'payment', ?, ?, ?, ?, ?)`,
        input.kind === 'erreur' ? 'payment_reverse' : 'payment_refund',
        original.id, member?.name ?? null, input.reason,
        input.actorId ?? null, input.actorName ?? null,
      )
    })

    return { id, amountCents: -original.amount_cents, paidAt }
  }

  /** Ventilation par moyen de paiement sur une periode. */
  revenueByMethod(opts: { from?: string; to?: string } = {}): Array<{ method: string; cents: number; lines: number }> {
    const conditions: string[] = []
    const params: unknown[] = []
    if (opts.from) { conditions.push('paid_at >= ?'); params.push(opts.from) }
    if (opts.to) { conditions.push('paid_at <= ?'); params.push(opts.to) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    return this.sql.exec<{ method: string; cents: number; lines: number }>(
      `SELECT COALESCE(method, 'inconnu') AS method,
              SUM(amount_cents) AS cents,
              COUNT(*) AS lines
         FROM payments ${where}
        GROUP BY method
        ORDER BY cents DESC`,
      ...params,
    ).toArray()
  }

  /**
   * Qui doit, combien, depuis quand.
   *
   * Le club ne tient pas de facturier par membre : la dette se deduit de la
   * date d'echeance de l'abonnement et du tarif en vigueur. C'est une
   * estimation assumee, pas une creance comptable — d'ou `monthsLate`, qui
   * permet de la verifier d'un coup d'oeil.
   *
   * Rien n'est stocke : un impaye regle disparait de lui-meme des que la
   * date d'echeance avance.
   */
  outstanding(): Array<{
    memberId: string; name: string; phone: string; branchName: string | null
    dueSince: string; daysLate: number; monthsLate: number; amountCents: number
  }> {
    const monthly = this.getPrices().monthlyCents

    return this.sql.exec<{
      id: string; name: string; phone: string; branch_name: string | null
      sub_expiry: string; days_late: number
    }>(
      `SELECT m.id, m.name, m.phone, b.name AS branch_name, m.sub_expiry,
              CAST(julianday('now') - julianday(m.sub_expiry) AS INTEGER) AS days_late
         FROM members m
         LEFT JOIN branches b ON b.id = m.branch_id
        WHERE m.status != 'archived'
          AND m.sub_expiry IS NOT NULL
          AND date(m.sub_expiry) < date('now')
        ORDER BY m.sub_expiry`,
    ).toArray().map(row => {
      // Un mois entame est un mois du : c'est la regle d'un abonnement, et
      // arrondir a l'inferieur ferait travailler le club gratuitement.
      const monthsLate = Math.max(1, Math.ceil(row.days_late / 30))
      return {
        memberId: row.id,
        name: row.name,
        phone: row.phone,
        branchName: row.branch_name,
        dueSince: row.sub_expiry,
        daysLate: row.days_late,
        monthsLate,
        amountCents: monthsLate * monthly,
      }
    })
  }

  /** Recettes par mois sur douze mois, pour le graphique de comptabilite. */
  revenueByMonth(): Array<{ month: string; cents: number }> {
    return this.sql.exec<{ month: string; cents: number }>(
      `SELECT strftime('%Y-%m', paid_at) AS month, SUM(amount_cents) AS cents
         FROM payments
        WHERE paid_at >= date('now','-11 months','start of month')
        GROUP BY month ORDER BY month`,
    ).toArray()
  }

  revenueByType(): Array<{ type: string; cents: number }> {
    return this.sql.exec<{ type: string; cents: number }>(
      `SELECT type, SUM(amount_cents) AS cents
         FROM payments
        WHERE paid_at >= date('now','start of month')
        GROUP BY type`,
    ).toArray()
  }

  /**
   * Tarifs du club, en centimes.
   *
   * Trois lignes seulement, mais elles vivent dans settings plutot que dans
   * une table : un club qui vend aussi des stages ou du materiel en ajoutera
   * d'autres, et une colonne par tarif obligerait a migrer chaque base.
   */
  getPrices(): { monthlyCents: number; insuranceCents: number; registrationCents: number } {
    const raw = this.getSetting('prices') as Record<string, unknown> | null
    const read = (key: string, fallback: number) => {
      const v = Number(raw?.[key])
      return Number.isFinite(v) && v >= 0 ? Math.round(v) : fallback
    }
    return {
      monthlyCents: read('monthlyCents', 10_000),
      insuranceCents: read('insuranceCents', 5_000),
      registrationCents: read('registrationCents', 15_000),
    }
  }

  setPrices(input: { monthlyCents: number; insuranceCents: number; registrationCents: number },
            actor: { id?: string; name?: string } = {}): void {
    this.ctx.storage.transactionSync(() => {
      this.setSetting('prices', input)
      this.sql.exec(
        `INSERT INTO audit_logs (action, entity, entity_id, entity_name, detail, actor_id, actor_name)
         VALUES ('prices_update', 'settings', 'prices', 'Tarifs', ?, ?, ?)`,
        JSON.stringify(input), actor.id ?? null, actor.name ?? null,
      )
    })
  }

  /**
   * Comptabilite previsionnelle : ce que les tarifs represente sur l'effectif
   * actuel, par salle.
   *
   * Ce n'est pas la caisse — les encaissements reels vivent dans payments.
   * Les deux coexistent volontairement : l'estimation dit ce qui est du, la
   * caisse dit ce qui est rentre, et l'ecart entre les deux est precisement
   * l'information qu'un gerant cherche.
   *
   * Le serveur renvoie des effectifs, pas des montants : la multiplication se
   * fait a l'affichage, ce qui permet de changer un tarif et de voir le
   * resultat sans requete supplementaire.
   */
  finance(opts: { branchId?: string | null; year?: number | null; month?: number | null } = {}): {
    prices: { monthlyCents: number; insuranceCents: number; registrationCents: number }
    chartYear: number
    month: number | null
    years: number[]
    branches: Array<{ id: string; name: string; total: number; insured: number }>
    scope: { total: number; insured: number; registrations: number }
    byMonth: Array<{ month: number; counts: Record<string, number> }>
  } {
    // '' represente les membres sans salle affectee. Ils comptent dans le
    // total global : les ignorer ferait mentir la somme sans que personne ne
    // voie pourquoi.
    const NONE = ''
    const branchFilter = opts.branchId ?? null
    const matches = (bid: string) => branchFilter === null || bid === branchFilter

    const known = this.sql
      .exec<{ id: string; name: string }>('SELECT id, name FROM branches ORDER BY name')
      .toArray()

    // La periode ne borne pas seulement les inscriptions : elle borne
    // l'effectif. « Revenu mensuel de janvier » doit se calculer sur les
    // membres presents en janvier, pas sur ceux d'aujourd'hui — sinon trois
    // KPI sur quatre restent figes quoi qu'on filtre, et le filtre passe pour
    // casse alors qu'il repond.
    const currentYear = new Date().getUTCFullYear()
    const month = Number.isFinite(opts.month) ? Number(opts.month) : null
    const hasPeriod = opts.year != null || month !== null
    const periodYear = Number.isFinite(opts.year) ? Number(opts.year) : currentYear

    const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    const periodEnd = !hasPeriod
      ? null
      : month === null
        ? `${periodYear}-12-31`
        : `${periodYear}-${String(month + 1).padStart(2, '0')}-${String(lastDay(periodYear, month)).padStart(2, '0')}`

    const perBranch = this.sql.exec<{ bid: string; total: number; insured: number }>(
      `SELECT COALESCE(branch_id, '') AS bid,
              COUNT(*) AS total,
              COALESCE(SUM(is_insured), 0) AS insured
         FROM members
        WHERE status != 'archived' AND (? IS NULL OR join_date <= ?)
        GROUP BY bid`,
      periodEnd, periodEnd,
    ).toArray()
    const counts = new Map(perBranch.map(r => [r.bid, r]))

    const branches = known.map(b => ({
      id: b.id,
      name: b.name,
      total: counts.get(b.id)?.total ?? 0,
      insured: counts.get(b.id)?.insured ?? 0,
    }))
    const orphans = counts.get(NONE)
    if (orphans && orphans.total > 0) {
      branches.push({ id: NONE, name: 'Sans salle', total: orphans.total, insured: orphans.insured })
    }

    const scope = branches.filter(b => matches(b.id)).reduce(
      (acc, b) => ({ total: acc.total + b.total, insured: acc.insured + b.insured }),
      { total: 0, insured: 0 },
    )

    // Les annees proposees viennent des donnees, pas d'une fenetre glissante
    // arbitraire : un club qui importe dix ans d'historique doit pouvoir le
    // consulter, un club ouvert cette annee ne doit pas voir quatre annees vides.
    const seen = this.sql.exec<{ y: string }>(
      `SELECT DISTINCT strftime('%Y', join_date) AS y
         FROM members WHERE status != 'archived' AND join_date IS NOT NULL
        ORDER BY y DESC`,
    ).toArray().map(r => Number(r.y)).filter(Number.isFinite)
    const years = [...new Set([currentYear, ...seen])].sort((a, b) => b - a)

    const chartYear = periodYear

    const rows = this.sql.exec<{ bid: string; m: number; n: number }>(
      `SELECT COALESCE(branch_id, '') AS bid,
              CAST(strftime('%m', join_date) AS INTEGER) - 1 AS m,
              COUNT(*) AS n
         FROM members
        WHERE status != 'archived' AND strftime('%Y', join_date) = ?
        GROUP BY bid, m`,
      String(chartYear),
    ).toArray()

    const byMonth = Array.from({ length: 12 }, (_, month) => ({
      month, counts: {} as Record<string, number>,
    }))
    for (const b of branches) for (const bucket of byMonth) bucket.counts[b.id] = 0
    for (const r of rows) {
      if (r.m < 0 || r.m > 11) continue
      if (!matches(r.bid)) continue
      const bucket = byMonth[r.m]!
      bucket.counts[r.bid] = (bucket.counts[r.bid] ?? 0) + r.n
    }

    // Sans periode, « inscriptions » vaut tout l'historique. Avec une
    // periode, seules celles qui y tombent — un mois choisi ne peut pas
    // compter les onze autres.
    const registrations = !hasPeriod
      ? scope.total
      : byMonth.reduce((sum, bucket, i) => {
          if (month !== null && i !== month) return sum
          return sum + Object.values(bucket.counts).reduce((a, b) => a + b, 0)
        }, 0)

    return {
      prices: this.getPrices(),
      chartYear, years, branches,
      // Le mois revient au client : c'est lui qui met en avant la barre
      // correspondante, le graphique restant annuel.
      month,
      scope: { ...scope, registrations },
      byMonth,
    }
  }

  // Alertes ----------------------------------------------------------------

  /**
   * Etat de conformite du club, calcule a la volee.
   *
   * Pas de table d'alertes a regenerer : la verite est dans les dates
   * d'echeance, et un calcul direct ne peut pas se desynchroniser.
   */
  alerts(): Array<{
    memberId: string; name: string; phone: string
    kind: 'sub_expired' | 'sub_expiring' | 'ins_expired' | 'ins_expiring' | 'ins_missing'
    dueDate: string | null; daysLeft: number | null
  }> {
    return this.sql.exec(
      `SELECT id AS memberId, name, phone,
              CASE
                WHEN sub_expiry IS NOT NULL AND sub_expiry <  date('now') THEN 'sub_expired'
                WHEN sub_expiry IS NOT NULL AND sub_expiry <= date('now','+7 days') THEN 'sub_expiring'
                WHEN is_insured = 0 THEN 'ins_missing'
                WHEN ins_expiry IS NOT NULL AND ins_expiry <  date('now') THEN 'ins_expired'
                ELSE 'ins_expiring'
              END AS kind,
              CASE
                WHEN sub_expiry IS NOT NULL AND sub_expiry <= date('now','+7 days') THEN sub_expiry
                ELSE ins_expiry
              END AS dueDate,
              CAST(julianday(
                CASE
                  WHEN sub_expiry IS NOT NULL AND sub_expiry <= date('now','+7 days') THEN sub_expiry
                  ELSE ins_expiry
                END
              ) - julianday(date('now')) AS INTEGER) AS daysLeft
         FROM members
        WHERE status = 'active'
          AND (
            (sub_expiry IS NOT NULL AND sub_expiry <= date('now','+7 days'))
            OR is_insured = 0
            OR (ins_expiry IS NOT NULL AND ins_expiry <= date('now','+30 days'))
          )
        ORDER BY dueDate IS NULL DESC, dueDate
        LIMIT 200`,
    ).toArray() as never
  }

  // Passage de grade --------------------------------------------------------

  listGradeSessions(status?: string) {
    const where = status ? 'WHERE g.status = ?' : ''
    const params = status ? [status] : []
    return this.sql.exec<Record<string, SqlStorageValue>>(
      `SELECT g.*, m.name AS member_name, m.phone, m.discipline_id,
              f.label AS from_label, f.color AS from_color,
              t.label AS to_label,   t.color AS to_color,
              -- « Corrige » n'est pas un statut range en base : c'est le fait
              -- qu'une autre ligne designe celle-ci. Deduit a la lecture.
              EXISTS (SELECT 1 FROM grade_sessions c WHERE c.corrects_id = g.id) AS corrected
         FROM grade_sessions g
         JOIN members m ON m.id = g.member_id
         LEFT JOIN grade_levels f ON f.id = g.from_grade_id
         LEFT JOIN grade_levels t ON t.id = g.to_grade_id
         ${where}
        ORDER BY g.scheduled_date, m.name
        LIMIT 300`,
      ...params,
    ).toArray()
  }

  /**
   * Membres presentables a une session, et ceux que l'abonnement bloque.
   *
   * L'anciennete se mesure A LA DATE DE LA SESSION, jamais aujourd'hui.
   * Quelqu'un qui atteint ses trois mois l'avant-veille du passage doit
   * apparaitre maintenant : c'est aujourd'hui qu'on prepare la liste, pas le
   * jour J. Mesuree au present, elle l'aurait ecarte a tort pendant tout le
   * trimestre, et personne n'aurait compris pourquoi.
   *
   * Deux chemins vers l'anciennete, et c'est la que l'ancienne version etait
   * incomplete — elle ne regardait que la date d'inscription :
   *
   *   sans grade      : inscrit depuis au moins trois mois ;
   *   deja grade      : dernier passage decide il y a au moins trois mois.
   *
   * Le repli sur `join_date` n'est pas un ornement. Un club qui reprend son
   * fichier papier saisit des membres AVEC leur ceinture et SANS passage
   * enregistre : leur dernier passage vaut NULL, « NULL <= date » vaut NULL,
   * et sans ce repli ils seraient inelligibles a vie.
   *
   * Les abonnements expires ne sont pas caches, ils sont marques : un membre
   * qui a fait ses trois mois et dont l'abonnement vient d'expirer doit se
   * voir, avec un bouton pour le regulariser.
   */
  gradeCandidates(opts: { sessionDate: string; disciplineId?: string | null } = { sessionDate: '' }) {
    const conditions: string[] = []
    const params: unknown[] = []
    if (opts.disciplineId) {
      conditions.push('m.discipline_id = ?')
      params.push(opts.disciplineId)
    }
    const extra = conditions.length ? ` AND ${conditions.join(' AND ')}` : ''

    return this.sql.exec<{
      id: string; name: string; grade_id: string | null
      current_label: string | null; current_color: string | null; current_rank: number | null
      discipline_id: string | null; discipline_name: string | null
      sub_expiry: string | null; sub_ok: number
      next_label: string | null; next_id: string | null; next_color: string | null
    }>(
      `SELECT m.id, m.name, m.grade_id, m.sub_expiry,
              g.label AS current_label, g.color AS current_color, g.rank AS current_rank,
              m.discipline_id, d.name AS discipline_name,
              (m.sub_expiry IS NULL OR m.sub_expiry >= ?1) AS sub_ok,
              n.id    AS next_id,
              n.label AS next_label,
              n.color AS next_color
         FROM members m
         JOIN disciplines d ON d.id = m.discipline_id AND d.has_grading = 1
         LEFT JOIN grade_levels g ON g.id = m.grade_id
         -- Le niveau immediatement au-dessus, dans l'echelle de SA discipline.
         LEFT JOIN grade_levels n
                ON n.discipline_id = m.discipline_id
               AND n.rank = (
                     SELECT MIN(rank) FROM grade_levels
                      WHERE discipline_id = m.discipline_id
                        AND rank > COALESCE(g.rank, -1)
                   )
        WHERE m.status = 'active'
          AND COALESCE(
                (SELECT MAX(s.scheduled_date) FROM grade_sessions s
                  WHERE s.member_id = m.id AND s.status IN ('passed','failed')),
                m.join_date
              ) <= date(?1, '-${CYCLE_MONTHS} months')
          -- Deja convoque : on ne convoque pas deux fois. Une convocation en
          -- attente, meme pour une autre date, tient la place.
          AND NOT EXISTS (
            SELECT 1 FROM grade_sessions s
             WHERE s.member_id = m.id AND s.status = 'pending'
          )${extra}
        ORDER BY sub_ok DESC, m.name
        LIMIT 300`,
      opts.sessionDate, ...params,
    ).toArray()
  }

  /** Le mois d'ancrage du club, valide, avec son defaut. */
  gradeAnchorMonth(): number {
    return anchorMonthOf(this.getSetting('grades:anchorMonth'))
  }

  setGradeAnchorMonth(month: number, actor: { id?: string; name?: string }): void {
    const clean = anchorMonthOf(month)
    this.setSetting('grades:anchorMonth', clean)
    this.sql.exec(
      `INSERT INTO audit_logs (action, entity, entity_id, detail, actor_id, actor_name)
       VALUES ('grade_anchor_set', 'setting', 'grades:anchorMonth', ?, ?, ?)`,
      String(clean), actor.id ?? null, actor.name ?? null,
    )
  }

  /**
   * Toutes les echelles graduees du club, rangees par discipline.
   *
   * Livrees avec la vue d'ensemble plutot que par une route dediee : elles
   * changent une fois par an, et l'instructeur en a besoin des qu'il ouvre le
   * choix de la ceinture visee. Un aller-retour a ce moment-la ferait
   * attendre pour une donnee qu'on avait deja.
   */
  gradeLadders(): Record<string, Array<{ id: string; label: string; color: string | null; rank: number }>> {
    const rows = this.sql.exec<{ id: string; label: string; color: string | null; rank: number; discipline_id: string }>(
      `SELECT l.id, l.label, l.color, l.rank, l.discipline_id
         FROM grade_levels l
         JOIN disciplines d ON d.id = l.discipline_id AND d.has_grading = 1
        ORDER BY l.discipline_id, l.rank`,
    ).toArray()

    const out: Record<string, Array<{ id: string; label: string; color: string | null; rank: number }>> = {}
    for (const r of rows) {
      (out[r.discipline_id] ??= []).push({ id: r.id, label: r.label, color: r.color, rank: r.rank })
    }
    return out
  }

  /**
   * Tous les membres qu'on peut convoquer a la main.
   *
   * La liste des eligibles applique la regle des trois mois ; celle-ci ne
   * l'applique pas. Elle existe parce que la regle est un defaut, pas une
   * loi : un membre arrive d'un autre club avec son grade, un rattrapage
   * apres blessure, une promotion exceptionnelle decidee par l'instructeur.
   *
   * `eligible` accompagne chaque ligne pour que l'interface puisse dire
   * franchement « celui-ci sort des regles habituelles » au lieu de laisser
   * croire que tout se vaut.
   */
  gradeSchedulable(sessionDate: string) {
    return this.sql.exec(
      `SELECT m.id, m.name, m.discipline_id, d.name AS discipline_name,
              g.label AS current_label, g.color AS current_color,
              n.id AS next_id, n.label AS next_label, n.color AS next_color,
              (m.sub_expiry IS NULL OR m.sub_expiry >= ?1) AS sub_ok,
              (COALESCE(
                 (SELECT MAX(s.scheduled_date) FROM grade_sessions s
                   WHERE s.member_id = m.id AND s.status IN ('passed','failed')),
                 m.join_date
               ) <= date(?1, '-${CYCLE_MONTHS} months')) AS senior_ok
         FROM members m
         JOIN disciplines d ON d.id = m.discipline_id AND d.has_grading = 1
         LEFT JOIN grade_levels g ON g.id = m.grade_id
         LEFT JOIN grade_levels n
                ON n.discipline_id = m.discipline_id
               AND n.rank = (
                     SELECT MIN(rank) FROM grade_levels
                      WHERE discipline_id = m.discipline_id
                        AND rank > COALESCE(g.rank, -1)
                   )
        WHERE m.status = 'active'
          -- Deja convoque : on ne convoque pas deux fois, meme a la main.
          AND NOT EXISTS (
            SELECT 1 FROM grade_sessions s
             WHERE s.member_id = m.id AND s.status = 'pending'
          )
        ORDER BY m.name
        LIMIT 500`,
      sessionDate,
    ).toArray()
  }

  createGradeSession(input: {
    memberId: string; scheduledDate: string
    /** Choix de l'instructeur. Absent, la suivante de l'echelle s'applique. */
    toGradeId?: string | null
    /** Motif, quand le passage sort des regles habituelles. */
    notes?: string | null
    actorId?: string; actorName?: string
  }): { id: string } {
    const id = crypto.randomUUID()
    const member = this.sql
      .exec<{ grade_id: string | null; discipline_id: string | null; name: string }>(
        'SELECT grade_id, discipline_id, name FROM members WHERE id = ?', input.memberId,
      ).one()

    // Une seule convocation en attente par membre.
    //
    // Les deux listes filtrent deja ceux qui en ont une, mais un filtre
    // d'affichage n'est pas une regle : deux onglets ouverts, ou un appel
    // direct, et le membre se retrouvait convoque deux fois pour le meme
    // passage. La regle vit ici, ou personne ne peut la contourner.
    const already = this.sql.exec<{ scheduled_date: string }>(
      `SELECT scheduled_date FROM grade_sessions
        WHERE member_id = ? AND status = 'pending' LIMIT 1`,
      input.memberId,
    ).toArray()[0]
    if (already) {
      throw new Error(`${member.name} a deja une convocation en attente pour le ${already.scheduled_date}`)
    }

    // Le niveau vise par defaut est le suivant sur l'echelle de SA discipline.
    const next = this.sql.exec<{ id: string }>(
      `SELECT id FROM grade_levels
        WHERE discipline_id = ?
          AND rank > COALESCE((SELECT rank FROM grade_levels WHERE id = ?), -1)
        ORDER BY rank LIMIT 1`,
      member.discipline_id, member.grade_id,
    ).toArray()[0]

    // Un choix explicite l'emporte, mais seulement s'il appartient a l'echelle
    // de la discipline du membre : sans cette verification, un identifiant
    // envoye a la main ferait passer un judoka a une ceinture de karate.
    let target = next?.id ?? null
    if (input.toGradeId) {
      const ok = this.sql.exec<{ id: string }>(
        'SELECT id FROM grade_levels WHERE id = ? AND discipline_id = ?',
        input.toGradeId, member.discipline_id,
      ).toArray()[0]
      if (!ok) throw new Error('Ce niveau n appartient pas a la discipline du membre')
      target = ok.id
    }

    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO grade_sessions (id, member_id, from_grade_id, to_grade_id, scheduled_date, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        // La ceinture actuelle est FIGEE ici : elle raconte d'ou partait le
        // membre le jour de la convocation. Relue plus tard depuis sa fiche,
        // elle aurait deja avance et la ligne d'historique serait fausse.
        id, input.memberId, member.grade_id, target, input.scheduledDate,
        input.notes ?? null,
      )
      this.sql.exec(
        `INSERT INTO audit_logs (action, entity, entity_id, entity_name, actor_id, actor_name)
         VALUES ('grade_session_create', 'grade_session', ?, ?, ?, ?)`,
        id, member.name, input.actorId ?? null, input.actorName ?? null,
      )
    })
    return { id }
  }

  decideGradeSession(input: {
    sessionId: string; passed: boolean; notes?: string | null
    /** Le jour, fourni par le routeur : le serveur ne se fie pas au client. */
    today: string
    actorId?: string; actorName?: string
  }): void {
    const session = this.sql
      .exec<{ member_id: string; to_grade_id: string | null; status: string; scheduled_date: string }>(
        `SELECT member_id, to_grade_id, status, scheduled_date
           FROM grade_sessions WHERE id = ?`, input.sessionId,
      ).one()

    // Un passage ne se juge pas avant d'avoir eu lieu.
    //
    // L'ecran desactive deja les boutons avant la date, mais un bouton grise
    // est une politesse, pas une regle : la route restait ouverte, et une
    // ceinture pouvait etre accordee pour une session prevue le mois suivant.
    if (session.scheduled_date.slice(0, 10) > input.today.slice(0, 10)) {
      throw new Error(`Ce passage est prevu le ${session.scheduled_date} : il ne peut pas encore etre juge`)
    }

    // Un resultat ne se juge qu'une fois.
    //
    // Sans ce garde, un second appel pouvait faire passer un passage de
    // « reussi » a « echoue » — sans jamais redescendre la ceinture, puisque
    // seule la reussite la fait monter. Le membre gardait un grade que son
    // historique disait rate.
    if (session.status !== 'pending') {
      throw new Error('Ce passage a deja ete juge')
    }

    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        // COALESCE sur les notes : une decision sans commentaire ne doit pas
        // effacer le motif ecrit a la convocation. C'est souvent la seule
        // trace expliquant pourquoi ce passage a ete accorde hors des regles.
        `UPDATE grade_sessions
            SET status = ?, notes = COALESCE(?, notes), decided_at = ${NOW}, decided_by = ?
          WHERE id = ?`,
        input.passed ? 'passed' : 'failed', input.notes ?? null,
        input.actorId ?? null, input.sessionId,
      )
      // Le grade du membre ne monte qu'en cas de reussite.
      if (input.passed && session.to_grade_id) {
        this.sql.exec('UPDATE members SET grade_id = ? WHERE id = ?',
          session.to_grade_id, session.member_id)
      }
      this.sql.exec(
        `INSERT INTO audit_logs (action, entity, entity_id, detail, actor_id, actor_name)
         VALUES ('grade_session_decide', 'grade_session', ?, ?, ?, ?)`,
        input.sessionId, input.passed ? 'passed' : 'failed',
        input.actorId ?? null, input.actorName ?? null,
      )
    })
  }

  /**
   * Tout ce que l'ecran des passages affiche, en un appel.
   *
   * La prochaine date, l'eligibilite et le taux sont DEDUITS ici, jamais
   * stockes : ils dependent du jour ou l'on regarde. Les calculer dans le
   * navigateur aurait duplique la regle des trois mois de part et d'autre du
   * reseau, et les deux copies auraient fini par diverger.
   */
  gradeOverview(opts: { today: string; date?: string | null; disciplineId?: string | null }): {
    anchorMonth: number
    nextSessionDate: string
    sessionDate: string
    sessions: Array<Record<string, unknown>>
    eligible: Array<Record<string, unknown>>
    blocked: Array<Record<string, unknown>>
    distribution: Array<{ label: string; color: string | null; count: number }>
    disciplines: Array<Record<string, unknown>>
    ladders: Record<string, Array<{ id: string; label: string; color: string | null; rank: number }>>
    stats: {
      pending: number
      /** Convoques pour LA session affichee, pas toutes dates confondues. */
      pendingForSession: number
      passed: number
      failed: number
      decided: number
      successRate: number | null
    }
  } {
    const anchorMonth = this.gradeAnchorMonth()
    const nextSessionDate = nextGradeDate(anchorMonth, opts.today)
    // Une date fournie prend le pas : c'est la session hors-cycle.
    const sessionDate = opts.date ?? nextSessionDate

    const candidates = this.gradeCandidates({ sessionDate, disciplineId: opts.disciplineId })
    const sessions = this.listGradeSessions()
    const filtered = opts.disciplineId
      ? sessions.filter(s => s.discipline_id === opts.disciplineId)
      : sessions

    // Un resultat corrige ne compte plus : sinon la ligne d'origine ET sa
    // correction entreraient toutes deux dans le taux, gonflant a la fois les
    // reussites et les echecs pour un seul passage reellement dispute.
    const counted = filtered.filter(s => s.corrected !== 1)
    const passed = counted.filter(s => s.status === 'passed').length
    const failed = counted.filter(s => s.status === 'failed').length
    const decided = passed + failed

    return {
      anchorMonth,
      nextSessionDate,
      sessionDate,
      sessions: filtered,
      eligible: candidates.filter(c => c.sub_ok === 1),
      blocked: candidates.filter(c => c.sub_ok !== 1),
      distribution: this.gradeDistribution(opts.disciplineId),
      disciplines: this.sql.exec(
        `SELECT id, name FROM disciplines
          WHERE has_grading = 1 AND is_active = 1 ORDER BY name`,
      ).toArray(),
      ladders: this.gradeLadders(),
      stats: {
        pending: filtered.filter(s => s.status === 'pending').length,
        // Deux mesures differentes, et les melanger etait une erreur : le
        // nombre de convoques n'a de sens que rapporte a UNE session, alors
        // que le taux de reussite se lit sur tout l'historique. Affiches
        // ensemble derriere une barre oblique, ils laissaient croire a un
        // rapport entre eux — « 1 / 0 » ressemblait a un score.
        // String() : les colonnes remontent typees en valeur SQLite generique,
        // et une date y est une chaine ou rien.
        pendingForSession: filtered.filter(
          s => s.status === 'pending'
            && String(s.scheduled_date ?? '').slice(0, 10) === sessionDate.slice(0, 10),
        ).length,
        passed,
        failed,
        decided,
        // Aucun resultat, aucun taux : « 0 % » se lirait comme un echec
        // complet alors que rien n'a encore eu lieu.
        successRate: decided > 0 ? Math.round((passed / decided) * 100) : null,
      },
    }
  }

  /**
   * Corrige un resultat mal saisi.
   *
   * Un instructeur clique « Echoue » au lieu de « Reussi ». Sans chemin de
   * correction, le membre reste mal note pour toujours : sa ceinture est
   * fausse, et le passage suivant vise un niveau qu'il possede deja — ou en
   * saute un.
   *
   * Le geste suit la meme regle que l'annulation d'un encaissement : on
   * n'ecrit jamais par-dessus, on ajoute. La ligne d'origine reste avec sa
   * date et son auteur ; une nouvelle ligne la designe et porte le bon
   * resultat. Six mois plus tard, l'historique dit qu'il y a eu une erreur
   * et qui l'a corrigee — un UPDATE en place aurait efface l'incident.
   *
   * La ceinture est remise d'aplomb dans les deux sens : une reussite
   * corrigee en echec la fait redescendre. C'est precisement ce qu'un simple
   * changement de statut ne faisait pas, et qui laissait un membre porter un
   * grade que son historique disait rate.
   */
  correctGradeSession(input: {
    sessionId: string
    passed: boolean
    reason: string
    actorId?: string
    actorName?: string
  }): { id: string } {
    const original = this.sql
      .exec<{
        id: string; member_id: string; status: string; corrects_id: string | null
        from_grade_id: string | null; to_grade_id: string | null; scheduled_date: string
      }>(
        `SELECT id, member_id, status, corrects_id, from_grade_id, to_grade_id, scheduled_date
           FROM grade_sessions WHERE id = ?`, input.sessionId,
      ).one()

    // On ne corrige que ce qui a ete juge. Un passage en attente se juge, il
    // ne se corrige pas.
    if (original.status !== 'passed' && original.status !== 'failed') {
      throw new Error('Ce passage n a pas encore ete juge : il n y a rien a corriger')
    }

    // Une correction n'est pas une deuxieme chance de changer d'avis. Elle
    // repare une erreur de saisie, et une seule fois — sinon la ceinture
    // finit par dependre de l'ordre des clics.
    const already = this.sql.exec<{ id: string }>(
      'SELECT id FROM grade_sessions WHERE corrects_id = ?', input.sessionId,
    ).toArray()[0]
    if (already) throw new Error('Ce resultat a deja ete corrige une fois')

    if (original.corrects_id) {
      throw new Error('Une correction ne se corrige pas : reprenez le passage d origine')
    }

    const member = this.sql
      .exec<{ grade_id: string | null; name: string }>(
        'SELECT grade_id, name FROM members WHERE id = ?', original.member_id,
      ).one()

    if (input.passed === (original.status === 'passed')) {
      throw new Error('Ce resultat est deja celui-la')
    }

    // Garde-fou sur la ceinture.
    //
    // Redescendre un grade n'est sur que si RIEN n'a bouge depuis. Si le
    // membre a passe un autre grade entre-temps, sa ceinture actuelle n'est
    // plus celle que ce passage avait posee, et la rabaisser effacerait un
    // resultat legitime. Mieux vaut refuser et le dire.
    if (original.status === 'passed' && member.grade_id !== original.to_grade_id) {
      throw new Error(
        `La ceinture de ${member.name} a change depuis ce passage : corrigez d abord le plus recent`,
      )
    }

    const id = crypto.randomUUID()
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO grade_sessions
           (id, member_id, from_grade_id, to_grade_id, scheduled_date, status,
            decided_at, decided_by, corrects_id, correction_reason)
         VALUES (?, ?, ?, ?, ?, ?, ${NOW}, ?, ?, ?)`,
        id, original.member_id, original.from_grade_id, original.to_grade_id,
        // Meme date que l'original : la correction repare la saisie, elle ne
        // deplace pas le passage. L'anciennete du membre ne doit pas bouger.
        original.scheduled_date,
        input.passed ? 'passed' : 'failed',
        input.actorId ?? null, original.id, input.reason,
      )

      // La ceinture reprend sa place : au niveau vise si le passage est
      // finalement reussi, a celui d'ou il partait sinon.
      this.sql.exec(
        'UPDATE members SET grade_id = ? WHERE id = ?',
        input.passed ? original.to_grade_id : original.from_grade_id,
        original.member_id,
      )

      this.sql.exec(
        `INSERT INTO audit_logs (action, entity, entity_id, entity_name, detail, actor_id, actor_name)
         VALUES ('grade_session_correct', 'grade_session', ?, ?, ?, ?, ?)`,
        original.id, member.name,
        `${original.status} -> ${input.passed ? 'passed' : 'failed'} : ${input.reason}`,
        input.actorId ?? null, input.actorName ?? null,
      )
    })

    return { id }
  }

  /** Repartition des membres par niveau, pour le graphique du tableau de bord. */
  gradeDistribution(disciplineId?: string | null): Array<{ label: string; color: string | null; count: number }> {
    const where = disciplineId ? 'WHERE g.discipline_id = ?' : ''
    const params = disciplineId ? [disciplineId] : []
    return this.sql.exec<{ label: string; color: string | null; count: number }>(
      `SELECT g.label, g.color, COUNT(m.id) AS count
         FROM grade_levels g
         LEFT JOIN members m ON m.grade_id = g.id AND m.status = 'active'
         ${where}
        GROUP BY g.id
        HAVING count > 0
        ORDER BY g.rank`,
      ...params,
    ).toArray()
  }

  // Journal ------------------------------------------------------------------

  auditLog(limit = 100) {
    return this.sql.exec(
      `SELECT action, entity, entity_name, detail, actor_name, created_at
         FROM audit_logs ORDER BY created_at DESC LIMIT ?`,
      Math.min(Math.max(limit, 1), 300),
    ).toArray()
  }

  // Agregats -------------------------------------------------------------

  /**
   * Resume destine au cache du plan de controle. Le tableau de bord
   * superadmin lit ce cache : on ne peut pas faire de JOIN entre Durable
   * Objects, et interroger N clubs a chaque affichage ne tiendrait pas.
   */
  stats(): {
    memberCount: number
    activeSubs: number
    revenueMonthCents: number
    lastActivityAt: string | null
  } {
    const today = new Date().toISOString().slice(0, 10)
    const monthStart = `${today.slice(0, 7)}-01`

    return {
      memberCount: this.countMembers(),
      activeSubs: this.sql
        .exec<{ n: number }>(
          "SELECT COUNT(*) AS n FROM members WHERE status = 'active' AND sub_expiry >= ?",
          today,
        )
        .one().n,
      revenueMonthCents: this.sql
        .exec<{ s: number | null }>(
          'SELECT SUM(amount_cents) AS s FROM payments WHERE paid_at >= ?',
          monthStart,
        )
        .one().s ?? 0,
      lastActivityAt: this.sql
        .exec<{ t: string | null }>('SELECT MAX(created_at) AS t FROM audit_logs')
        .one().t,
    }
  }

  /**
   * Tout ce qu'affiche le tableau de bord, en un aller-retour.
   *
   * Douze cartes qui interrogeraient chacune l'objet feraient douze allers
   * pour un seul ecran ; ici la base est locale au thread, donc autant tout
   * calculer d'un coup.
   */
  dashboard(): {
    membersTotal: number
    membersActive: number
    subsExpiring: number
    insuranceMissing: number
    revenueMonthCents: number
    alertsCount: number
    growth: Array<{ month: string; total: number }>
    revenue: Array<{ month: string; cents: number }>
    grades: Array<{ label: string; color: string | null; count: number }>
    recentMembers: Array<{ id: string; name: string; join_date: string }>
    upcomingGrades: Array<{ id: string; member_name: string; scheduled_date: string; to_label: string | null }>
    branchSplit: Array<{ name: string; count: number }>
  } {
    const one = <T extends Record<string, SqlStorageValue>>(sql: string, ...p: unknown[]) =>
      this.sql.exec<T>(sql, ...p).one()

    return {
      membersTotal: one<{ n: number }>(
        "SELECT COUNT(*) AS n FROM members WHERE status != 'archived'").n,
      membersActive: one<{ n: number }>(
        `SELECT COUNT(*) AS n FROM members
          WHERE status = 'active' AND (sub_expiry IS NULL OR sub_expiry >= date('now'))`).n,
      subsExpiring: one<{ n: number }>(
        `SELECT COUNT(*) AS n FROM members
          WHERE status = 'active' AND sub_expiry IS NOT NULL
            AND sub_expiry BETWEEN date('now') AND date('now','+7 days')`).n,
      insuranceMissing: one<{ n: number }>(
        `SELECT COUNT(*) AS n FROM members
          WHERE status = 'active'
            AND (is_insured = 0 OR ins_expiry IS NULL OR ins_expiry < date('now'))`).n,
      revenueMonthCents: one<{ s: number | null }>(
        "SELECT SUM(amount_cents) AS s FROM payments WHERE paid_at >= date('now','start of month')").s ?? 0,
      alertsCount: one<{ n: number }>(
        `SELECT COUNT(*) AS n FROM members
          WHERE status = 'active'
            AND ((sub_expiry IS NOT NULL AND sub_expiry <= date('now','+7 days'))
                 OR is_insured = 0
                 OR (ins_expiry IS NOT NULL AND ins_expiry <= date('now','+30 days')))`).n,

      // Croissance cumulee : le total des inscrits a la fin de chaque mois.
      growth: this.sql.exec<{ month: string; total: number }>(
        `WITH RECURSIVE months(m) AS (
           SELECT date('now','start of month','-11 months')
           UNION ALL SELECT date(m,'+1 month') FROM months WHERE m < date('now','start of month')
         )
         SELECT strftime('%Y-%m', m) AS month,
                (SELECT COUNT(*) FROM members
                  WHERE join_date <= date(m,'+1 month','-1 day') AND status != 'archived') AS total
           FROM months`).toArray(),

      revenue: this.revenueByMonth(),
      grades: this.gradeDistribution(),

      recentMembers: this.sql.exec<{ id: string; name: string; join_date: string }>(
        `SELECT id, name, join_date FROM members
          WHERE status != 'archived' ORDER BY created_at DESC LIMIT 8`).toArray(),

      upcomingGrades: this.sql.exec<{
        id: string; member_name: string; scheduled_date: string; to_label: string | null
      }>(
        `SELECT g.id, m.name AS member_name, g.scheduled_date, t.label AS to_label
           FROM grade_sessions g
           JOIN members m ON m.id = g.member_id
           LEFT JOIN grade_levels t ON t.id = g.to_grade_id
          WHERE g.status = 'pending'
          ORDER BY g.scheduled_date LIMIT 8`).toArray(),

      branchSplit: this.sql.exec<{ name: string; count: number }>(
        `SELECT b.name, COUNT(m.id) AS count
           FROM branches b
           LEFT JOIN members m ON m.branch_id = b.id AND m.status = 'active'
          WHERE b.is_active = 1
          GROUP BY b.id ORDER BY count DESC`).toArray(),
    }
  }

  /** Suppression definitive du club (resiliation, droit a l'effacement). */
  async destroyAll(): Promise<void> {
    await this.ctx.storage.deleteAll()
  }
}
