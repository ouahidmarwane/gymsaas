import { DurableObject } from 'cloudflare:workers'
import { MIGRATIONS, LATEST_VERSION } from './schema'
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

  listMembers(opts: { limit?: number; offset?: number; search?: string } = {}) {
    // Bornes resistantes a NaN : Math.min(Math.max(NaN, 1), 200) vaut NaN,
    // qui atteindrait le LIMIT et le viderait de son sens.
    const clamp = (v: number | undefined, min: number, max: number, fallback: number) =>
      Number.isFinite(v) ? Math.min(Math.max(Math.trunc(v!), min), max) : fallback
    const limit = clamp(opts.limit, 1, 200, 50)
    const offset = clamp(opts.offset, 0, 1_000_000, 0)

    const select = `
      SELECT m.*, b.name AS branch_name, d.name AS discipline_name, g.label AS grade_label
        FROM members m
        LEFT JOIN branches     b ON b.id = m.branch_id
        LEFT JOIN disciplines  d ON d.id = m.discipline_id
        LEFT JOIN grade_levels g ON g.id = m.grade_id
       WHERE m.status != 'archived'`

    // Toujours des requetes parametrees : l'entree utilisateur ne rejoint
    // jamais le texte SQL.
    if (opts.search) {
      const like = `%${opts.search}%`
      return this.sql
        .exec(
          `${select} AND (m.name LIKE ? OR m.phone LIKE ?)
           ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
          like, like, limit, offset,
        )
        .toArray()
    }

    return this.sql
      .exec(`${select} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`, limit, offset)
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

    // Un remboursement anterieur a l'encaissement n'a pas de sens physique.
    if (input.kind === 'remboursement' && paidAt < original.paid_at) {
      throw new Error('Un remboursement ne peut pas preceder l encaissement')
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
    return this.sql.exec(
      `SELECT g.*, m.name AS member_name, m.phone,
              f.label AS from_label, t.label AS to_label, t.color AS to_color
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

  /** Membres eligibles : gradables, abonnement a jour, pas deja convoques. */
  eligibleForGrading() {
    return this.sql.exec(
      `SELECT m.id, m.name, m.grade_id,
              g.label AS current_label, g.rank AS current_rank, m.discipline_id
         FROM members m
         JOIN disciplines d ON d.id = m.discipline_id AND d.has_grading = 1
         LEFT JOIN grade_levels g ON g.id = m.grade_id
        WHERE m.status = 'active'
          AND (m.sub_expiry IS NULL OR m.sub_expiry >= date('now'))
          AND m.join_date <= date('now','-3 months')
          AND NOT EXISTS (
            SELECT 1 FROM grade_sessions s
             WHERE s.member_id = m.id AND s.status = 'pending'
          )
        ORDER BY m.name
        LIMIT 200`,
    ).toArray()
  }

  createGradeSession(input: {
    memberId: string; scheduledDate: string; actorId?: string; actorName?: string
  }): { id: string } {
    const id = crypto.randomUUID()
    const member = this.sql
      .exec<{ grade_id: string | null; discipline_id: string | null; name: string }>(
        'SELECT grade_id, discipline_id, name FROM members WHERE id = ?', input.memberId,
      ).one()

    // Le niveau vise est le suivant sur l'echelle de SA discipline.
    const next = this.sql.exec<{ id: string }>(
      `SELECT id FROM grade_levels
        WHERE discipline_id = ?
          AND rank > COALESCE((SELECT rank FROM grade_levels WHERE id = ?), -1)
        ORDER BY rank LIMIT 1`,
      member.discipline_id, member.grade_id,
    ).toArray()[0]

    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO grade_sessions (id, member_id, from_grade_id, to_grade_id, scheduled_date)
         VALUES (?, ?, ?, ?, ?)`,
        id, input.memberId, member.grade_id, next?.id ?? null, input.scheduledDate,
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
    actorId?: string; actorName?: string
  }): void {
    const session = this.sql
      .exec<{ member_id: string; to_grade_id: string | null }>(
        'SELECT member_id, to_grade_id FROM grade_sessions WHERE id = ?', input.sessionId,
      ).one()

    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `UPDATE grade_sessions
            SET status = ?, notes = ?, decided_at = ${NOW}, decided_by = ?
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

  /** Repartition des membres par niveau, pour le graphique du tableau de bord. */
  gradeDistribution(): Array<{ label: string; color: string | null; count: number }> {
    return this.sql.exec<{ label: string; color: string | null; count: number }>(
      `SELECT g.label, g.color, COUNT(m.id) AS count
         FROM grade_levels g
         LEFT JOIN members m ON m.grade_id = g.id AND m.status = 'active'
        GROUP BY g.id
        HAVING count > 0
        ORDER BY g.rank`,
    ).toArray()
  }

  // Championnats ------------------------------------------------------------

  listChampionships() {
    return this.sql.exec(
      `SELECT c.*, d.name AS discipline_name, b.name AS branch_name,
              (SELECT COUNT(*) FROM championship_athletes a WHERE a.championship_id = c.id) AS athletes,
              (SELECT COUNT(*) FROM championship_athletes a
                WHERE a.championship_id = c.id AND a.place IS NOT NULL) AS medals
         FROM championships c
         LEFT JOIN disciplines d ON d.id = c.discipline_id
         LEFT JOIN branches b    ON b.id = c.branch_id
        ORDER BY c.event_date DESC
        LIMIT 200`,
    ).toArray()
  }

  createChampionship(input: {
    name: string; eventDate: string; location?: string | null
    disciplineId?: string | null; branchId?: string | null
    actorId?: string; actorName?: string
  }): { id: string } {
    const id = crypto.randomUUID()
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO championships (id, name, event_date, location, discipline_id, branch_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        id, input.name, input.eventDate, input.location ?? null,
        input.disciplineId ?? null, input.branchId ?? null,
      )
      this.sql.exec(
        `INSERT INTO audit_logs (action, entity, entity_id, entity_name, actor_id, actor_name)
         VALUES ('championship_create', 'championship', ?, ?, ?, ?)`,
        id, input.name, input.actorId ?? null, input.actorName ?? null,
      )
    })
    return { id }
  }

  championshipAthletes(championshipId: string) {
    return this.sql.exec(
      `SELECT a.*, m.name AS member_name, g.label AS grade_label
         FROM championship_athletes a
         JOIN members m ON m.id = a.member_id
         LEFT JOIN grade_levels g ON g.id = m.grade_id
        WHERE a.championship_id = ?
        ORDER BY a.place IS NULL, a.place, m.name`,
      championshipId,
    ).toArray()
  }

  addAthlete(input: {
    championshipId: string; memberId: string
    category?: string | null; weightClass?: string | null
  }): { id: string } {
    const id = crypto.randomUUID()
    this.sql.exec(
      `INSERT INTO championship_athletes (id, championship_id, member_id, category, weight_class)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (championship_id, member_id) DO UPDATE SET
         category = excluded.category, weight_class = excluded.weight_class`,
      id, input.championshipId, input.memberId,
      input.category ?? null, input.weightClass ?? null,
    )
    return { id }
  }

  setAthleteResult(athleteId: string, place: number | null, notes?: string | null): void {
    this.sql.exec(
      'UPDATE championship_athletes SET place = ?, result_notes = ? WHERE id = ?',
      place, notes ?? null, athleteId,
    )
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
