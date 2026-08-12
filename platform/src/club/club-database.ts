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
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
    const offset = Math.max(opts.offset ?? 0, 0)

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
    actorId?: string
    actorName?: string
  }): { id: string } {
    const id = crypto.randomUUID()

    // Une transaction couvre l'insertion et sa trace : jamais l'une sans
    // l'autre. Sur un Durable Object elle est synchrone et locale.
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO members (id, name, phone, email, branch_id, discipline_id, sub_expiry, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.name,
        input.phone,
        input.email ?? null,
        input.branchId ?? null,
        input.disciplineId ?? null,
        input.subExpiry ?? null,
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

  /** Suppression definitive du club (resiliation, droit a l'effacement). */
  async destroyAll(): Promise<void> {
    await this.ctx.storage.deleteAll()
  }
}
