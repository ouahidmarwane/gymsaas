import type { Env } from './env'
// Type seulement : importer la classe comme valeur entrainerait le module
// 'cloudflare:workers' dans le bundle de l'API, qui echoue a se resoudre hors
// de workerd. La classe est exportee par worker.ts, la ou elle doit l'etre.
import type { ClubDatabase } from './club/club-database'
import { hashPassword, verifyPassword, newId } from './auth/crypto'
import {
  createSession, resolveSession, destroySession, readSessionCookie,
  sessionCookie, clearedCookie, isoSeconds, activeScope,
  beginSupport, allowSupportWrite, setSupportReadOnly, endSupport, type Principal,
} from './auth/session'
import { hashToken } from './auth/crypto'
import {
  parseLayout, defaultLayout, LayoutError, GRID_COLUMNS,
  isPageKey, cardsFor, layoutKey,
} from './club/layout'
import {
  parseTheme, readTheme, logoKey, logoExtension, isOwnLogoKey, BrandingError,
} from './club/branding'


// Reponses -------------------------------------------------------------------

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': 'no-store',
      ...(init.headers ?? {}),
    },
  })

const fail = (status: number, error: string) => json({ error }, { status })

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

// Acces au club --------------------------------------------------------------

/**
 * Ouvre la base du club de l'appelant.
 *
 * Point nevralgique de l'isolation : l'identifiant du club vient de la
 * session, resolue cote serveur, et JAMAIS d'un parametre de requete. Il n'y
 * a donc rien a falsifier, pas de ?orgId= a manipuler, pas de clause WHERE a
 * oublier. Un club est un objet distinct, pas une ligne filtree.
 */
function clubOf(env: Env, principal: Principal): DurableObjectStub<ClubDatabase> {
  const { orgId } = activeScope(principal)
  if (!orgId) throw new HttpError(403, 'Aucun club actif pour ce compte')
  return env.CLUB.get(env.CLUB.idFromName(orgId))
}

/** Identifiant du club vise, apres prise en compte du mode support. */
function scopedOrgId(principal: Principal): string {
  const { orgId } = activeScope(principal)
  if (!orgId) throw new HttpError(403, 'Aucun club actif pour ce compte')
  return orgId
}

/** Acces superadmin a un club donne. Trace, car il franchit la frontiere. */
async function clubAsPlatformAdmin(
  env: Env, principal: Principal, orgId: string, action: string, ip: string | null,
): Promise<DurableObjectStub<ClubDatabase>> {
  if (!principal.isPlatformAdmin) throw new HttpError(403, 'Reserve a la plateforme')

  // On verifie que le club existe avant d'ouvrir son objet : idFromName sur
  // un identifiant quelconque en creerait un vide, migrations comprises.
  const org = await env.CONTROL.prepare('SELECT 1 FROM organizations WHERE id = ?')
    .bind(orgId).first()
  if (!org) throw new HttpError(404, 'Club inconnu')

  await env.CONTROL.prepare(
    'INSERT INTO platform_audit (actor_id, action, org_id, ip) VALUES (?, ?, ?, ?)',
  ).bind(principal.userId, action, orgId, ip).run()
  return env.CLUB.get(env.CLUB.idFromName(orgId))
}

// Roles ----------------------------------------------------------------------

const RANK = { viewer: 0, staff: 1, admin: 2, owner: 3 } as const

/**
 * Verifie le niveau requis sur le club vise.
 *
 * En mode support, l'exploitant de plateforme dispose du niveau administrateur
 * sur le club visite, mais TOUTE ecriture reste bloquee tant qu'il n'a pas
 * leve explicitement le droit d'ecriture. Un depannage lit par defaut : on ne
 * modifie pas le club d'un client par inadvertance.
 */
function atLeast(principal: Principal, min: keyof typeof RANK, write = false): void {
  const { mode } = activeScope(principal)

  if (mode === 'support') {
    // La portee support ne vaut que pour un exploitant de plateforme. On le
    // reaffirme ici plutot que de s'en remettre a un invariant lointain.
    if (!principal.isPlatformAdmin) throw new HttpError(403, 'Reserve a la plateforme')
    if (write && !principal.supportWrite) {
      throw new HttpError(403, 'Mode support en lecture seule : activez l ecriture d abord')
    }
    // Le niveau demande reste evalue : un support vaut « administrateur »,
    // pas proprietaire. Ignorer `min` accordait silencieusement le rang le
    // plus eleve a toute route ajoutee ensuite.
    if (RANK.admin < RANK[min]) throw new HttpError(403, 'Droits insuffisants')
    return
  }

  if (!principal.role) throw new HttpError(403, 'Aucun club actif pour ce compte')
  if (RANK[principal.role] < RANK[min]) throw new HttpError(403, 'Droits insuffisants')
}

/** Trace une action de support. Les lectures sont tracees a l'entree. */
async function auditSupport(
  env: Env, principal: Principal, action: string, detail: unknown, ip: string | null,
): Promise<void> {
  await env.CONTROL.prepare(
    'INSERT INTO platform_audit (actor_id, action, org_id, detail, ip) VALUES (?, ?, ?, ?, ?)',
  ).bind(principal.userId, action, principal.supportOrgId, JSON.stringify(detail ?? null), ip).run()
}

// Anti-force brute -----------------------------------------------------------

const WINDOW_MINUTES = 15
/** Blocage dur : une source qui essaie en rafale. */
const MAX_PER_IP = 10
/**
 * Blocage par compte, volontairement bien plus haut.
 *
 * Compter les echecs par adresse e-mail offrait un deni de service trivial :
 * dix requetes suffisaient a verrouiller le compte d'un proprietaire depuis
 * n'importe ou, indefiniment. La protection contre le bourrinage vient de la
 * limite par IP ; celle-ci ne couvre plus qu'une attaque vraiment distribuee.
 */
const MAX_PER_IDENTIFIER = 20

async function throttled(env: Env, identifier: string, ip: string | null): Promise<boolean> {
  const since = isoSeconds(new Date(Date.now() - WINDOW_MINUTES * 60_000))

  const row = await env.CONTROL.prepare(
    `SELECT
       SUM(CASE WHEN ip IS NOT NULL AND ip = ? THEN 1 ELSE 0 END) AS by_ip,
       SUM(CASE WHEN identifier = ?                THEN 1 ELSE 0 END) AS by_identifier
     FROM login_attempts
     WHERE succeeded = 0 AND attempted_at > ?`,
  ).bind(ip, identifier, since).first<{ by_ip: number | null; by_identifier: number | null }>()

  return (row?.by_ip ?? 0) >= MAX_PER_IP || (row?.by_identifier ?? 0) >= MAX_PER_IDENTIFIER
}

async function recordAttempt(env: Env, identifier: string, ip: string | null, ok: boolean) {
  await env.CONTROL.prepare(
    'INSERT INTO login_attempts (identifier, ip, succeeded) VALUES (?, ?, ?)',
  ).bind(identifier, ip, ok ? 1 : 0).run()
}

/**
 * Enregistre l'adresse d'une connexion reussie et signale celles jamais vues.
 *
 * Un compte qui n'a encore aucune adresse connue est un compte neuf : sa
 * premiere connexion n'a rien de suspect, on l'apprend sans lever d'alerte.
 */
async function noteLoginLocation(
  env: Env, userId: string, orgId: string | null, ip: string | null, userAgent: string | null,
): Promise<void> {
  if (!ip) return

  const seen = await env.CONTROL.prepare(
    'SELECT COUNT(*) AS n FROM known_ips WHERE user_id = ?',
  ).bind(userId).first<{ n: number }>()

  const known = await env.CONTROL.prepare(
    'SELECT 1 FROM known_ips WHERE user_id = ? AND ip = ?',
  ).bind(userId, ip).first()

  await env.CONTROL.prepare(
    `INSERT INTO known_ips (user_id, ip) VALUES (?, ?)
     ON CONFLICT(user_id, ip) DO UPDATE SET last_seen = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
  ).bind(userId, ip).run()

  if (!known && (seen?.n ?? 0) > 0) {
    await env.CONTROL.prepare(
      `INSERT INTO security_events (user_id, org_id, type, detail, ip, user_agent)
       VALUES (?, ?, 'new_ip', ?, ?, ?)`,
    ).bind(userId, orgId, 'Connexion depuis une adresse jamais vue', ip, userAgent).run()
  }
}

/** Signale une rafale d'echecs, une seule fois par fenetre. */
async function noteFailedBurst(env: Env, identifier: string, ip: string | null): Promise<void> {
  const since = isoSeconds(new Date(Date.now() - WINDOW_MINUTES * 60_000))

  const recent = await env.CONTROL.prepare(
    `SELECT COUNT(*) AS n FROM login_attempts
      WHERE succeeded = 0 AND attempted_at > ? AND identifier = ?`,
  ).bind(since, identifier).first<{ n: number }>()

  if ((recent?.n ?? 0) < 5) return

  const already = await env.CONTROL.prepare(
    `SELECT 1 FROM security_events
      WHERE type = 'failed_burst' AND detail = ? AND created_at > ?`,
  ).bind(identifier, since).first()
  if (already) return

  const user = await env.CONTROL.prepare(
    'SELECT id FROM users WHERE email_norm = ?',
  ).bind(identifier).first<{ id: string }>()

  await env.CONTROL.prepare(
    `INSERT INTO security_events (user_id, type, detail, ip)
     VALUES (?, 'failed_burst', ?, ?)`,
  ).bind(user?.id ?? null, identifier, ip).run()
}

// Validation -----------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const normEmail = (e: string) => e.trim().toLowerCase()

function str(v: unknown, field: string, max = 200): string {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `Champ requis : ${field}`)
  const s = v.trim()
  if (s.length > max) throw new HttpError(400, `Champ trop long : ${field}`)
  return s
}

/** Entier d'URL, avec repli : une valeur non numerique ne doit rien casser. */
function intParam(url: URL, name: string, fallback: number): number {
  const raw = url.searchParams.get(name)
  if (raw === null) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

/** Chaine facultative : absente ou vide devient null. */
function optional(v: unknown, max = 200): string | null {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string') throw new HttpError(400, 'Valeur attendue : texte')
  const s = v.trim()
  if (s.length > max) throw new HttpError(400, 'Valeur trop longue')
  return s || null
}

const MAX_GRADES = 40

function parseGrades(v: unknown): Array<{ label: string; labelAr: string | null; color: string | null }> {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) throw new HttpError(400, 'grades doit etre une liste')
  if (v.length > MAX_GRADES) throw new HttpError(400, `grades : ${MAX_GRADES} niveaux maximum`)
  return v.map((g, i) => {
    if (!g || typeof g !== 'object') throw new HttpError(400, `grades[${i}] invalide`)
    const row = g as Record<string, unknown>
    return {
      label: str(row.label, `grades[${i}].label`, 60),
      labelAr: optional(row.labelAr, 60),
      color: optional(row.color, 30),
    }
  })
}

function parseDiscipline(body: Record<string, unknown>) {
  const grades = parseGrades(body.grades)
  return {
    name: str(body.name, 'name', 80),
    nameAr: optional(body.nameAr, 80),
    // Une discipline est gradee si une echelle est fournie, ou si le club
    // le declare explicitement.
    hasGrading: grades.length > 0 || body.hasGrading === true,
    grades,
  }
}

const MAX_JSON_BYTES = 64 * 1024

async function readJson(request: Request): Promise<Record<string, unknown>> {
  // Refuse un corps demesure avant de le lire. Sans cela, la connexion — qui
  // n'exige aucune authentification — accepterait de charger 100 Mo en
  // memoire avant de s'apercevoir que ce n'est pas du JSON.
  const declared = Number(request.headers.get('Content-Length') ?? '0')
  if (!Number.isFinite(declared) || declared > MAX_JSON_BYTES) {
    throw new HttpError(413, 'Corps de requete trop volumineux')
  }
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object') throw new Error('not an object')
    return body as Record<string, unknown>
  } catch (e) {
    if (e instanceof HttpError) throw e
    throw new HttpError(400, 'Corps de requete invalide')
  }
}

// Routeur --------------------------------------------------------------------
//
// Expose une fonction pure (request, env) -> Response, montee par Next sous
// app/api/[[...path]]/route.ts. Garder un routeur unique plutot que d'eclater
// une vingtaine de fichiers de route conserve la logique d'autorisation au
// meme endroit : la portee du club et le mode support sont decides une fois,
// pas redecides a chaque fichier.

export const api = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method
    const ip = request.headers.get('CF-Connecting-IP')

    try {
      if (path === '/api/health') return json({ ok: true })

      if (path === '/api/auth/signup' && method === 'POST') return await signup(request, env, ip)
      if (path === '/api/auth/login' && method === 'POST') return await login(request, env, ip)

      // Tout ce qui suit exige une session valide.
      const token = readSessionCookie(request)
      const principal = await resolveSession(env, token)
      if (!principal) return fail(401, 'Non authentifie')

      if (path === '/api/auth/logout' && method === 'POST') {
        if (token) await destroySession(env, token)
        return json({ ok: true }, { headers: { 'Set-Cookie': clearedCookie(request) } })
      }

      if (path === '/api/me' && method === 'GET') {
        const scope = activeScope(principal)
        // Les capacites accompagnent l'identite : la coquille sait alors
        // quels ecrans meritent d'exister avant meme de les afficher, plutot
        // que de proposer un lien qui mene a une page vide.
        //
        // Seulement si l'appelant a reellement acces a ce club : un compte
        // dont l'appartenance a ete revoquee garde son org_id en session,
        // et lirait encore les chiffres du club sans y avoir droit.
        const entitled = scope.mode === 'support' || principal.role !== null
        const capabilities = scope.orgId && entitled
          ? await clubOf(env, principal).capabilities()
          : null
        // Le mode support doit etre visible dans l'interface : une banniere
        // permanente vaut mieux qu'un exploitant qui oublie ou il se trouve.
        return json({
          user: { id: principal.userId, name: principal.name, email: principal.email },
          isPlatformAdmin: principal.isPlatformAdmin,
          org: principal.orgId ? { id: principal.orgId, role: principal.role } : null,
          scope: {
            mode: scope.mode,
            orgId: scope.orgId,
            canWrite: scope.mode === 'support' ? principal.supportWrite : true,
          },
          branding: scope.orgId ? await brandingOf(env, scope.orgId) : null,
          capabilities,
        })
      }

      // Configuration du club : succursales et disciplines.
      // Un club neuf n'en a aucune. Rien n'est presuppose du sport pratique
      // ni du nombre de salles ; c'est au club de le declarer.

      if (path === '/api/branches' && method === 'GET') {
        atLeast(principal, 'viewer')
        return json({ branches: await clubOf(env, principal).listBranches() })
      }

      if (path === '/api/branches' && method === 'POST') {
        atLeast(principal, 'admin', true)
        const body = await readJson(request)
        const { id } = await clubOf(env, principal).addBranch({
          name: str(body.name, 'name', 120),
          nameAr: optional(body.nameAr, 120),
          address: optional(body.address, 300),
        })
        return json({ id }, { status: 201 })
      }

      const branchRoute = path.match(/^\/api\/branches\/([^/]+)$/)
      if (branchRoute && (method === 'PATCH' || method === 'DELETE')) {
        atLeast(principal, 'admin', true)
        const club = clubOf(env, principal)
        if (method === 'DELETE') {
          await club.deactivateBranch(branchRoute[1]!)
        } else {
          const body = await readJson(request)
          await club.updateBranch(branchRoute[1]!, {
            name: optional(body.name, 120) ?? undefined,
            nameAr: optional(body.nameAr, 120),
            address: optional(body.address, 300),
          })
        }
        return json({ ok: true })
      }

      if (path === '/api/disciplines' && method === 'GET') {
        atLeast(principal, 'viewer')
        return json({ disciplines: await clubOf(env, principal).listDisciplines() })
      }

      if (path === '/api/disciplines' && method === 'POST') {
        atLeast(principal, 'admin', true)
        const { id } = await clubOf(env, principal).addDiscipline(
          parseDiscipline(await readJson(request)),
        )
        return json({ id }, { status: 201 })
      }

      const ladderRoute = path.match(/^\/api\/disciplines\/([^/]+)\/grades$/)
      if (ladderRoute && method === 'PUT') {
        atLeast(principal, 'admin', true)
        const body = await readJson(request)
        await clubOf(env, principal).setGradeLadder(ladderRoute[1]!, parseGrades(body.grades))
        return json({ ok: true })
      }

      const disciplineRoute = path.match(/^\/api\/disciplines\/([^/]+)$/)
      if (disciplineRoute && method === 'DELETE') {
        atLeast(principal, 'admin', true)
        await clubOf(env, principal).deactivateDiscipline(disciplineRoute[1]!)
        return json({ ok: true })
      }

      if (path === '/api/setup/status' && method === 'GET') {
        atLeast(principal, 'viewer')
        return json(await clubOf(env, principal).capabilities())
      }

      // Passage de grade. Refuse pour un club dont aucune discipline n'est
      // gradee : masquer le lien ne suffit pas, l'URL reste tapable.
      if (path === '/api/grades' && method === 'GET') {
        atLeast(principal, 'viewer')
        const club = clubOf(env, principal)
        const { hasGrading } = await club.capabilities()
        if (!hasGrading) return fail(409, 'Aucune discipline gradee dans ce club')
        const [sessions, eligible] = await Promise.all([
          club.listGradeSessions(),
          club.eligibleForGrading(),
        ])
        return json({ sessions, eligible })
      }

      if (path === '/api/grades/sessions' && method === 'POST') {
        atLeast(principal, 'staff', true)
        const body = await readJson(request)
        const { id } = await clubOf(env, principal).createGradeSession({
          memberId: str(body.memberId, 'memberId', 60),
          scheduledDate: str(body.scheduledDate, 'scheduledDate', 10),
          actorId: principal.userId, actorName: principal.name,
        })
        return json({ id }, { status: 201 })
      }

      const gradeDecide = path.match(/^\/api\/grades\/sessions\/([^/]+)\/decision$/)
      if (gradeDecide && method === 'POST') {
        atLeast(principal, 'staff', true)
        const body = await readJson(request)
        await clubOf(env, principal).decideGradeSession({
          sessionId: gradeDecide[1]!,
          passed: body.passed === true,
          notes: optional(body.notes, 500),
          actorId: principal.userId, actorName: principal.name,
        })
        return json({ ok: true })
      }

      // Alertes : calculees a la volee depuis les echeances, jamais stockees.
      if (path === '/api/alerts' && method === 'GET') {
        atLeast(principal, 'viewer')
        return json({ alerts: await clubOf(env, principal).alerts() })
      }

      // Comptabilite -----------------------------------------------------

      if (path === '/api/payments' && method === 'GET') {
        atLeast(principal, 'admin')
        const club = clubOf(env, principal)
        const year = url.searchParams.get('year')
        const month = url.searchParams.get('month')
        const [payments, byMonth, byType] = await Promise.all([
          club.listPayments({
            year: year ? Number(year) : undefined,
            month: month ? Number(month) : undefined,
          }),
          club.revenueByMonth(),
          club.revenueByType(),
        ])
        return json({ payments, byMonth, byType })
      }

      if (path === '/api/payments' && method === 'POST') {
        atLeast(principal, 'staff', true)
        const body = await readJson(request)
        const amount = Number(body.amountCents)
        if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) {
          throw new HttpError(400, 'Montant invalide')
        }
        const type = str(body.type, 'type', 20)
        if (!['monthly', 'insurance', 'registration', 'other'].includes(type)) {
          throw new HttpError(400, 'Type de paiement inconnu')
        }
        const { id } = await clubOf(env, principal).addPayment({
          memberId: str(body.memberId, 'memberId', 60),
          amountCents: Math.round(amount),
          type,
          paidAt: optional(body.paidAt, 10) ?? undefined,
          notes: optional(body.notes, 300),
          actorId: principal.userId, actorName: principal.name,
        })
        return json({ id }, { status: 201 })
      }

      // Championnats -----------------------------------------------------

      if (path === '/api/championships' && method === 'GET') {
        atLeast(principal, 'viewer')
        return json({ championships: await clubOf(env, principal).listChampionships() })
      }

      if (path === '/api/championships' && method === 'POST') {
        atLeast(principal, 'staff', true)
        const body = await readJson(request)
        const { id } = await clubOf(env, principal).createChampionship({
          name: str(body.name, 'name', 160),
          eventDate: str(body.eventDate, 'eventDate', 10),
          location: optional(body.location, 160),
          disciplineId: optional(body.disciplineId, 60),
          branchId: optional(body.branchId, 60),
          actorId: principal.userId, actorName: principal.name,
        })
        return json({ id }, { status: 201 })
      }

      const champAthletes = path.match(/^\/api\/championships\/([^/]+)\/athletes$/)
      if (champAthletes && (method === 'GET' || method === 'POST')) {
        const club = clubOf(env, principal)
        if (method === 'GET') {
          atLeast(principal, 'viewer')
          return json({ athletes: await club.championshipAthletes(champAthletes[1]!) })
        }
        atLeast(principal, 'staff', true)
        const body = await readJson(request)
        const { id } = await club.addAthlete({
          championshipId: champAthletes[1]!,
          memberId: str(body.memberId, 'memberId', 60),
          category: optional(body.category, 80),
          weightClass: optional(body.weightClass, 40),
        })
        return json({ id }, { status: 201 })
      }

      const athleteResult = path.match(/^\/api\/championships\/athletes\/([^/]+)\/result$/)
      if (athleteResult && method === 'POST') {
        atLeast(principal, 'staff', true)
        const body = await readJson(request)
        const place = body.place === null || body.place === undefined ? null : Number(body.place)
        if (place !== null && ![1, 2, 3].includes(place)) throw new HttpError(400, 'Place invalide')
        await clubOf(env, principal).setAthleteResult(athleteResult[1]!, place, optional(body.notes, 300))
        return json({ ok: true })
      }

      // Journal du club ---------------------------------------------------

      if (path === '/api/audit' && method === 'GET') {
        atLeast(principal, 'admin')
        return json({ entries: await clubOf(env, principal).auditLog(150) })
      }

      // Marque du club : nom affiche, logo, couleur.

      if (path === '/api/branding' && method === 'GET') {
        atLeast(principal, 'viewer')
        return json(await brandingOf(env, scopedOrgId(principal)))
      }

      if (path === '/api/branding' && method === 'PUT') {
        atLeast(principal, 'admin', true)
        const orgId = scopedOrgId(principal)
        const result = await saveBranding(env, orgId, await readJson(request))
        if (activeScope(principal).mode === 'support') {
          await auditSupport(env, principal, 'support_write_branding', result, ip)
        }
        return json(result)
      }

      // Upload du logo, en passant par le binding R2 du Worker.
      //
      // Pas d'URL signee : la cle est fabriquee cote serveur et porte
      // l'identifiant du club, donc on ne peut ecraser ni le logo d'un autre
      // club ni un document membre. Un logo pese quelques kilo-octets, tres
      // loin de la limite de corps de requete d'un Worker.
      if (path === '/api/branding/logo' && method === 'PUT') {
        atLeast(principal, 'admin', true)
        const orgId = scopedOrgId(principal)
        const contentType = request.headers.get('Content-Type') ?? ''
        const ext = logoExtension(contentType)

        // La taille est verifiee AVANT de lire le corps : sinon un envoi de
        // 100 Mo serait entierement charge en memoire avant d'etre refuse,
        // ce qui suffit a tuer l'isolat a repetition.
        const declared = Number(request.headers.get('Content-Length') ?? '0')
        if (!Number.isFinite(declared) || declared > MAX_LOGO_BYTES) {
          throw new HttpError(413, 'Logo trop volumineux : 2 Mo maximum')
        }

        const bytes = await request.arrayBuffer()
        if (bytes.byteLength === 0) throw new HttpError(400, 'Fichier vide')
        if (bytes.byteLength > MAX_LOGO_BYTES) {
          throw new HttpError(413, 'Logo trop volumineux : 2 Mo maximum')
        }

        const previous = await env.CONTROL.prepare(
          'SELECT logo_key FROM organizations WHERE id = ?',
        ).bind(orgId).first<{ logo_key: string | null }>()

        const key = logoKey(orgId, ext)
        await env.MEDIA.put(key, bytes, { httpMetadata: { contentType } })
        await env.CONTROL.prepare(
          `UPDATE organizations SET logo_key = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
            WHERE id = ?`,
        ).bind(key, orgId).run()

        // L'ancien logo n'a plus de reference : le laisser ferait grossir le
        // bucket a chaque changement, indefiniment.
        if (previous?.logo_key && previous.logo_key !== key) {
          await env.MEDIA.delete(previous.logo_key).catch(() => {})
        }

        if (activeScope(principal).mode === 'support') {
          await auditSupport(env, principal, 'support_write_logo', { key }, ip)
        }
        return json({ key })
      }

      // Sert le logo. Le prefixe impose empeche de detourner cette route
      // vers les photos ou passeports des membres.
      const logoRoute = path.match(/^\/api\/branding\/logo\/(.+)$/)
      if (logoRoute && method === 'GET') {
        atLeast(principal, 'viewer')
        const key = decodeURIComponent(logoRoute[1]!)
        if (!isOwnLogoKey(scopedOrgId(principal), key)) return fail(400, 'Cle invalide')
        const object = await env.MEDIA.get(key)
        if (!object) return fail(404, 'Introuvable')
        return new Response(object.body, {
          headers: {
            'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
            'Cache-Control': 'private, max-age=300',
            'X-Content-Type-Options': 'nosniff',
            // Ceinture et bretelles : meme si un document actif finissait
            // dans le bucket, il ne pourrait ni executer de script ni
            // joindre quoi que ce soit depuis notre origine.
            'Content-Security-Policy': "default-src 'none'; sandbox; base-uri 'none'",
            'Content-Disposition': 'inline',
          },
        })
      }

      // Disposition du tableau de bord.

      // Chiffres du club de l'appelant. En mode support, ce sont ceux du
      // club visite : la portee suit la session, comme partout ailleurs.
      if (path === '/api/dashboard/stats' && method === 'GET') {
        atLeast(principal, 'viewer')
        // Un seul aller-retour pour les douze cartes : la base est locale au
        // thread de l'objet, autant tout calculer d'un coup.
        return json({ stats: await clubOf(env, principal).dashboard() })
      }

      // Disposition, par ecran. Chaque page a son catalogue et sa mise en
      // page : le mode modification n'est plus reserve au tableau de bord.
      const layoutRoute = path.match(/^\/api\/layout\/([a-z]+)$/)
      if (layoutRoute) {
        const page = layoutRoute[1]!
        if (!isPageKey(page)) return fail(404, 'Ecran inconnu')

        const club = clubOf(env, principal)

        if (method === 'GET') {
          atLeast(principal, 'viewer')
          const stored = await club.getSetting(layoutKey(page))
          // Une disposition enregistree est revalidee a la lecture : si le
          // catalogue a change depuis, elle est ramenee a un etat coherent
          // plutot que de casser la page.
          let layout
          try {
            layout = stored ? parseLayout(page, stored) : defaultLayout(page)
          } catch {
            layout = defaultLayout(page)
          }

          // Un club sans grade ne se voit pas proposer les cartes de grade,
          // ni dans la grille ni dans le catalogue.
          const { hasGrading } = await club.capabilities()
          const catalogue = Object.fromEntries(
            Object.entries(cardsFor(page)).filter(([, spec]) => hasGrading || !spec.needsGrading),
          )
          return json({
            page,
            layout: layout.filter(c => catalogue[c.id]),
            columns: GRID_COLUMNS,
            cards: catalogue,
          })
        }

        if (method === 'PUT') {
          atLeast(principal, 'admin', true)
          const body = await readJson(request)
          const layout = parseLayout(page, body.layout)
          await club.setSetting(layoutKey(page), layout)
          if (activeScope(principal).mode === 'support') {
            await auditSupport(env, principal, 'support_write_layout', { page, cards: layout.length }, ip)
          }
          return json({ layout })
        }

        if (method === 'DELETE') {
          atLeast(principal, 'admin', true)
          await club.setSetting(layoutKey(page), defaultLayout(page))
          return json({ layout: defaultLayout(page) })
        }
      }

      // Le club voit qui, cote plateforme, a ouvert sa base et quand.
      // Question de confiance, et de conformite CNDP.
      if (path === '/api/support-log' && method === 'GET') {
        atLeast(principal, 'admin')
        // scopedOrgId, jamais principal.orgId : sinon un exploitant entre en
        // support sur le club B lirait le journal de SON club A, en
        // contournant le controle de rang qui l'y aurait refuse.
        const { results } = await env.CONTROL.prepare(
          `SELECT a.action, a.detail, a.created_at, u.name AS actor_name
             FROM platform_audit a
             LEFT JOIN users u ON u.id = a.actor_id
            WHERE a.org_id = ?
            ORDER BY a.created_at DESC
            LIMIT 100`,
        ).bind(scopedOrgId(principal)).all()
        return json({ entries: results })
      }

      if (path === '/api/members' && method === 'GET') {
        atLeast(principal, 'viewer')
        const club = clubOf(env, principal)
        // Number('abc') vaut NaN, qui traversait les bornes et arrivait tel
        // quel dans le LIMIT — au mieux une erreur, au pire plus de limite
        // du tout et toute la table renvoyee.
        const members = await club.listMembers({
          limit: intParam(url, 'limit', 50),
          offset: intParam(url, 'offset', 0),
          search: url.searchParams.get('q') ?? undefined,
        })
        return json({ members })
      }

      if (path === '/api/members' && method === 'POST') {
        atLeast(principal, 'staff', true)
        const body = await readJson(request)
        const club = clubOf(env, principal)
        const { id } = await club.addMember({
          name: str(body.name, 'name'),
          phone: str(body.phone, 'phone', 30),
          email: typeof body.email === 'string' ? normEmail(body.email) : null,
          branchId: typeof body.branchId === 'string' ? body.branchId : null,
          disciplineId: typeof body.disciplineId === 'string' ? body.disciplineId : null,
          subExpiry: typeof body.subExpiry === 'string' ? body.subExpiry : null,
          actorId: principal.userId,
          actorName: principal.name,
        })
        return json({ id }, { status: 201 })
      }

      const memberRoute = path.match(/^\/api\/members\/([^/]+)$/)
      if (memberRoute && (method === 'PATCH' || method === 'DELETE')) {
        atLeast(principal, 'staff', true)
        const club = clubOf(env, principal)
        if (method === 'DELETE') {
          // Archive, jamais supprime : les encaissements doivent rester
          // rattaches a quelqu'un.
          await club.archiveMember(memberRoute[1]!, { id: principal.userId, name: principal.name })
          return json({ ok: true })
        }
        const body = await readJson(request)
        await club.updateMember(memberRoute[1]!, {
          name: optional(body.name, 200) ?? undefined,
          phone: optional(body.phone, 30) ?? undefined,
          email: optional(body.email, 200),
          branchId: optional(body.branchId, 60),
          disciplineId: optional(body.disciplineId, 60),
          gradeId: optional(body.gradeId, 60),
          subExpiry: optional(body.subExpiry, 10),
          insExpiry: optional(body.insExpiry, 10),
          isInsured: typeof body.isInsured === 'boolean' ? body.isInsured : undefined,
          notes: optional(body.notes, 1000),
          actorId: principal.userId, actorName: principal.name,
        })
        return json({ ok: true })
      }

      const renewRoute = path.match(/^\/api\/members\/([^/]+)\/renew$/)
      if (renewRoute && method === 'POST') {
        atLeast(principal, 'staff', true)
        const body = await readJson(request)
        const amount = Number(body.amountCents ?? 0)
        if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) {
          throw new HttpError(400, 'Montant invalide')
        }
        const result = await clubOf(env, principal).renewSubscription({
          memberId: renewRoute[1]!,
          amountCents: Math.round(amount),
          actorId: principal.userId, actorName: principal.name,
        })
        return json(result)
      }

      // Equipe du club ----------------------------------------------------
      //
      // Les comptes vivent dans le plan de controle, pas dans le club : c'est
      // la meme identite qui peut servir dans plusieurs clubs.

      if (path === '/api/staff' && method === 'GET') {
        atLeast(principal, 'admin')
        const { results } = await env.CONTROL.prepare(
          `SELECT m.id AS membership_id, m.role, m.status, m.created_at,
                  u.id AS user_id, u.name, u.email, u.last_login_at
             FROM memberships m
             JOIN users u ON u.id = m.user_id
            WHERE m.org_id = ?
            ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1
                                 WHEN 'staff' THEN 2 ELSE 3 END, u.name`,
        ).bind(scopedOrgId(principal)).all()
        return json({ staff: results })
      }

      if (path === '/api/staff' && method === 'POST') {
        atLeast(principal, 'admin', true)
        const orgId = scopedOrgId(principal)
        const body = await readJson(request)

        const name = str(body.name, 'name', 120)
        const email = normEmail(str(body.email, 'email', 200))
        const password = str(body.password, 'password', 200)
        const role = str(body.role, 'role', 20)
        if (!EMAIL.test(email)) throw new HttpError(400, 'Adresse e-mail invalide')
        if (password.length < 10) throw new HttpError(400, 'Mot de passe : 10 caracteres minimum')
        // On ne cree jamais un proprietaire : il n'y en a qu'un, celui qui a
        // recu le club.
        if (!['admin', 'staff', 'viewer'].includes(role)) throw new HttpError(400, 'Role inconnu')

        const existing = await env.CONTROL.prepare(
          'SELECT id FROM users WHERE email_norm = ?',
        ).bind(email).first<{ id: string }>()

        const userId = existing?.id ?? newId()
        const statements = []
        if (!existing) {
          statements.push(env.CONTROL.prepare(
            'INSERT INTO users (id, email, email_norm, name, password_hash) VALUES (?, ?, ?, ?, ?)',
          ).bind(userId, email, email, name, await hashPassword(password)))
        }
        statements.push(env.CONTROL.prepare(
          `INSERT INTO memberships (id, user_id, org_id, role) VALUES (?, ?, ?, ?)
           ON CONFLICT (user_id, org_id) DO UPDATE SET role = excluded.role, status = 'active'`,
        ).bind(newId(), userId, orgId, role))

        await env.CONTROL.batch(statements)
        return json({ userId, existed: Boolean(existing) }, { status: 201 })
      }

      const staffRoute = path.match(/^\/api\/staff\/([^/]+)$/)
      if (staffRoute && (method === 'PATCH' || method === 'DELETE')) {
        atLeast(principal, 'admin', true)
        const orgId = scopedOrgId(principal)
        const membershipId = staffRoute[1]!

        const target = await env.CONTROL.prepare(
          'SELECT user_id, role FROM memberships WHERE id = ? AND org_id = ?',
        ).bind(membershipId, orgId).first<{ user_id: string; role: string }>()
        if (!target) return fail(404, 'Compte introuvable dans ce club')

        // Garde-fous : on ne se retire pas soi-meme, et le proprietaire ne se
        // revoque pas — sinon le club se retrouve sans personne aux commandes.
        if (target.user_id === principal.userId) {
          return fail(400, 'Vous ne pouvez pas modifier votre propre acces ici')
        }
        if (target.role === 'owner') return fail(400, 'Le proprietaire ne peut pas etre modifie')

        if (method === 'DELETE') {
          await env.CONTROL.batch([
            env.CONTROL.prepare("UPDATE memberships SET status = 'revoked' WHERE id = ?").bind(membershipId),
            env.CONTROL.prepare('DELETE FROM sessions WHERE user_id = ? AND org_id = ?')
              .bind(target.user_id, orgId),
          ])
          return json({ ok: true })
        }

        const body = await readJson(request)
        const role = str(body.role, 'role', 20)
        if (!['admin', 'staff', 'viewer'].includes(role)) throw new HttpError(400, 'Role inconnu')
        await env.CONTROL.prepare('UPDATE memberships SET role = ? WHERE id = ?')
          .bind(role, membershipId).run()
        return json({ ok: true })
      }

      // Mon compte ---------------------------------------------------------

      if (path === '/api/account/password' && method === 'POST') {
        const body = await readJson(request)
        const current = str(body.currentPassword, 'currentPassword', 200)
        const next = str(body.newPassword, 'newPassword', 200)
        if (next.length < 10) throw new HttpError(400, 'Mot de passe : 10 caracteres minimum')

        const row = await env.CONTROL.prepare('SELECT password_hash FROM users WHERE id = ?')
          .bind(principal.userId).first<{ password_hash: string }>()
        if (!row || !(await verifyPassword(current, row.password_hash))) {
          return fail(401, 'Mot de passe actuel incorrect')
        }

        await env.CONTROL.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
          .bind(await hashPassword(next), principal.userId).run()
        // Toutes les autres sessions tombent : un changement de mot de passe
        // doit chasser qui serait deja connecte ailleurs.
        await env.CONTROL.prepare(
          'DELETE FROM sessions WHERE user_id = ? AND token_hash != ?',
        ).bind(principal.userId, await hashToken(token!)).run()
        return json({ ok: true })
      }

      if (path === '/api/account' && method === 'PATCH') {
        const body = await readJson(request)
        const name = optional(body.name, 120)
        if (!name) throw new HttpError(400, 'Nom requis')
        await env.CONTROL.prepare('UPDATE users SET name = ? WHERE id = ?')
          .bind(name, principal.userId).run()
        return json({ ok: true })
      }

      if (path === '/api/account/sessions' && method === 'GET') {
        const { results } = await env.CONTROL.prepare(
          `SELECT created_at, last_seen_at, ip, user_agent, support_org_id
             FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC LIMIT 20`,
        ).bind(principal.userId).all()
        return json({ sessions: results })
      }

      // Plateforme (superadmin) ------------------------------------------

      if (path === '/api/admin/clubs' && method === 'GET') {
        if (!principal.isPlatformAdmin) return fail(403, 'Reserve a la plateforme')
        const { results } = await env.CONTROL.prepare(
          `SELECT o.id, o.slug, o.name, o.plan, o.status, o.created_at,
                  s.member_count, s.active_subs, s.revenue_month_cents, s.refreshed_at
             FROM organizations o
             LEFT JOIN org_stats s ON s.org_id = o.id
            ORDER BY o.created_at DESC`,
        ).all()
        return json({ clubs: results })
      }

      // Provisionne un club depuis le tableau de bord plateforme, en
      // production, sans deploiement. Le Durable Object du club existant
      // n'est ni lu ni ecrit : c'est une base distincte.
      if (path === '/api/admin/clubs' && method === 'POST') {
        if (!principal.isPlatformAdmin) return fail(403, 'Reserve a la plateforme')
        return await createClub(await readJson(request), env, principal.userId, ip)
      }

      // Vue d'ensemble : tous les clubs, avec leurs chiffres en cache et la
      // fraicheur de ce cache. On n'ouvre pas N bases pour afficher une
      // liste ; le cache est rafraichi par tache planifiee, et un club
      // precis peut etre interroge en direct via /stats.
      if (path === '/api/admin/overview' && method === 'GET') {
        if (!principal.isPlatformAdmin) return fail(403, 'Reserve a la plateforme')

        const read = () => env.CONTROL.prepare(
          `SELECT o.id, o.slug, o.name, o.logo_key, o.theme, o.plan, o.status,
                  o.created_at, o.trial_ends_at,
                  s.member_count, s.active_subs, s.revenue_month_cents,
                  s.last_activity_at, s.refreshed_at,
                  (SELECT COUNT(*) FROM memberships m
                    WHERE m.org_id = o.id AND m.status = 'active') AS staff_count
             FROM organizations o
             LEFT JOIN org_stats s ON s.org_id = o.id
            ORDER BY o.created_at DESC`,
        ).all<Record<string, unknown>>()

        let { results } = await read()

        // Un club jamais mesure affichait des tirets jusqu'au prochain
        // passage du cron — cinq minutes d'ecran vide apres une creation.
        // On mesure a la volee ceux-la, en nombre borne pour qu'une
        // plateforme chargee ne reveille pas cent bases sur un affichage.
        const stale = results.filter(c => c.refreshed_at === null).slice(0, 20)
        if (stale.length > 0) {
          await Promise.all(stale.map(club => refreshOrgStats(env, club.id as string)))
          results = (await read()).results
        }

        return json({
          clubs: results.map(c => ({
            ...c,
            theme: readTheme((c.theme as string | null) ?? null),
          })),
          serverTime: isoSeconds(new Date()),
        })
      }

      // Supervision : qui est connecte, ou, et qu'est-ce qui cloche.
      //
      // Sessions de la plateforme ET des clubs sur le meme ecran : une
      // connexion suspecte sur un club se repere en la comparant aux autres,
      // pas en ouvrant trente pages.
      if (path === '/api/admin/supervision' && method === 'GET') {
        if (!principal.isPlatformAdmin) return fail(403, 'Reserve a la plateforme')

        const cutoff = isoSeconds(new Date(Date.now() - 7 * 86_400_000))

        const [sessions, events, attempts] = await Promise.all([
          env.CONTROL.prepare(
            `SELECT s.user_id, s.org_id, s.created_at, s.last_seen_at, s.expires_at,
                    s.ip, s.user_agent, s.support_org_id,
                    u.name AS user_name, u.email, u.is_platform_admin,
                    o.name AS org_name, o.theme AS org_theme,
                    m.role,
                    (SELECT COUNT(*) FROM known_ips k
                      WHERE k.user_id = s.user_id AND k.ip = s.ip) AS ip_known
               FROM sessions s
               JOIN users u ON u.id = s.user_id
               LEFT JOIN organizations o ON o.id = s.org_id
               LEFT JOIN memberships m ON m.user_id = s.user_id AND m.org_id = s.org_id
              WHERE s.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now')
              ORDER BY s.last_seen_at DESC
              LIMIT 200`,
          ).all(),

          env.CONTROL.prepare(
            `SELECT e.id, e.type, e.detail, e.ip, e.user_agent, e.created_at, e.handled_at,
                    u.name AS user_name, u.email, o.name AS org_name
               FROM security_events e
               LEFT JOIN users u ON u.id = e.user_id
               LEFT JOIN organizations o ON o.id = e.org_id
              WHERE e.created_at > ?
              ORDER BY e.handled_at IS NOT NULL, e.created_at DESC
              LIMIT 100`,
          ).bind(cutoff).all(),

          env.CONTROL.prepare(
            `SELECT identifier, ip, COUNT(*) AS failures, MAX(attempted_at) AS last_attempt
               FROM login_attempts
              WHERE succeeded = 0 AND attempted_at > ?
              GROUP BY identifier, ip
             HAVING failures >= 3
              ORDER BY last_attempt DESC
              LIMIT 50`,
          ).bind(isoSeconds(new Date(Date.now() - 86_400_000))).all(),
        ])

        return json({
          sessions: sessions.results,
          events: events.results,
          failedAttempts: attempts.results,
          serverTime: isoSeconds(new Date()),
        })
      }

      // Coupe toutes les sessions d'un compte. Le geste a poser quand une
      // connexion parait compromise.
      const revokeRoute = path.match(/^\/api\/admin\/users\/([^/]+)\/sessions$/)
      if (revokeRoute && method === 'DELETE') {
        if (!principal.isPlatformAdmin) return fail(403, 'Reserve a la plateforme')
        const userId = revokeRoute[1]!
        if (userId === principal.userId) return fail(400, 'Deconnectez-vous depuis votre propre compte')

        await env.CONTROL.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run()
        await env.CONTROL.prepare(
          "INSERT INTO platform_audit (actor_id, action, detail, ip) VALUES (?, 'revoke_sessions', ?, ?)",
        ).bind(principal.userId, JSON.stringify({ userId }), ip).run()
        return json({ ok: true })
      }

      const handleRoute = path.match(/^\/api\/admin\/events\/(\d+)\/handled$/)
      if (handleRoute && method === 'POST') {
        if (!principal.isPlatformAdmin) return fail(403, 'Reserve a la plateforme')
        await env.CONTROL.prepare(
          "UPDATE security_events SET handled_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?",
        ).bind(Number(handleRoute[1])).run()
        return json({ ok: true })
      }

      // Entrer dans un club pour le depanner. Ce n'est pas une usurpation
      // d'identite : la portee est greffee sur la session existante, en
      // lecture seule, limitee dans le temps, et le club en voit la trace.
      const enterRoute = path.match(/^\/api\/admin\/clubs\/([^/]+)\/support$/)
      if (enterRoute && method === 'POST') {
        if (!principal.isPlatformAdmin) return fail(403, 'Reserve a la plateforme')
        if (!token) return fail(401, 'Session absente')
        const orgId = enterRoute[1]!

        const org = await env.CONTROL.prepare(
          'SELECT id, name FROM organizations WHERE id = ?',
        ).bind(orgId).first<{ id: string; name: string }>()
        if (!org) return fail(404, 'Club inconnu')

        // `readOnly` est un choix explicite, pas le defaut : entrer pour
        // depanner suppose de pouvoir agir.
        const body = await request.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
        const { expiresAt, canWrite } = await beginSupport(env, token, orgId, body.readOnly === true)

        await env.CONTROL.prepare(
          "INSERT INTO platform_audit (actor_id, action, org_id, detail, ip) VALUES (?, 'support_enter', ?, ?, ?)",
        ).bind(principal.userId, orgId, JSON.stringify({ expiresAt, canWrite }), ip).run()

        return json({ orgId, name: org.name, mode: 'support', canWrite, expiresAt })
      }

      if (path === '/api/admin/support/write' && method === 'POST') {
        if (!principal.supportOrgId) return fail(400, 'Aucune session de support active')
        if (!token) return fail(401, 'Session absente')
        const expiresAt = await allowSupportWrite(env, token)
        await auditSupport(env, principal, 'support_write_enabled', { expiresAt }, ip)
        return json({ mode: 'support', canWrite: true, expiresAt })
      }

      if (path === '/api/admin/support/read-only' && method === 'POST') {
        if (!principal.supportOrgId) return fail(400, 'Aucune session de support active')
        if (!token) return fail(401, 'Session absente')
        await setSupportReadOnly(env, token)
        await auditSupport(env, principal, 'support_read_only', null, ip)
        return json({ mode: 'support', canWrite: false })
      }

      if (path === '/api/admin/support' && method === 'DELETE') {
        if (!token) return fail(401, 'Session absente')
        if (principal.supportOrgId) {
          await auditSupport(env, principal, 'support_exit', null, ip)
        }
        await endSupport(env, token)
        return json({ mode: 'member' })
      }

      const statsRoute = path.match(/^\/api\/admin\/clubs\/([^/]+)\/stats$/)
      if (statsRoute && method === 'GET') {
        const orgId = statsRoute[1]!
        const club = await clubAsPlatformAdmin(env, principal, orgId, 'read_club_stats', ip)
        return json({ orgId, stats: await club.stats() })
      }

      // Configuration d'un club par la plateforme : ajouter ses salles et ses
      // sports pour lui, sans avoir a se connecter a son compte.
      const adminBranches = path.match(/^\/api\/admin\/clubs\/([^/]+)\/branches$/)
      if (adminBranches && (method === 'GET' || method === 'POST')) {
        const orgId = adminBranches[1]!
        const club = await clubAsPlatformAdmin(env, principal, orgId, `${method}_branches`, ip)
        if (method === 'GET') return json({ branches: await club.listBranches() })
        const body = await readJson(request)
        const { id } = await club.addBranch({
          name: str(body.name, 'name', 120),
          nameAr: optional(body.nameAr, 120),
          address: optional(body.address, 300),
        })
        return json({ id }, { status: 201 })
      }

      // Marque d'un club, modifiee depuis le tableau de bord plateforme.
      const adminBranding = path.match(/^\/api\/admin\/clubs\/([^/]+)\/branding$/)
      if (adminBranding && (method === 'GET' || method === 'PUT')) {
        if (!principal.isPlatformAdmin) return fail(403, 'Reserve a la plateforme')
        const orgId = adminBranding[1]!
        if (method === 'GET') return json(await brandingOf(env, orgId))
        const result = await saveBranding(env, orgId, await readJson(request))
        await env.CONTROL.prepare(
          "INSERT INTO platform_audit (actor_id, action, org_id, ip) VALUES (?, 'write_branding', ?, ?)",
        ).bind(principal.userId, orgId, ip).run()
        return json(result)
      }

      const adminDisciplines = path.match(/^\/api\/admin\/clubs\/([^/]+)\/disciplines$/)
      if (adminDisciplines && (method === 'GET' || method === 'POST')) {
        const orgId = adminDisciplines[1]!
        const club = await clubAsPlatformAdmin(env, principal, orgId, `${method}_disciplines`, ip)
        if (method === 'GET') return json({ disciplines: await club.listDisciplines() })
        const { id } = await club.addDiscipline(parseDiscipline(await readJson(request)))
        return json({ id }, { status: 201 })
      }

      return fail(404, 'Route inconnue')
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.message)
      // Erreurs de validation : le message est ecrit pour l'utilisateur.
      if (e instanceof LayoutError || e instanceof BrandingError) return fail(400, e.message)
      console.error('unhandled', e)
      // Aucun detail interne renvoye au client.
      return fail(500, 'Erreur interne')
    }
  },

  /**
   * Rafraichit le cache d'agregats, un club a la fois.
   *
   * Le tableau de bord plateforme lit ce cache : sans lui, afficher la liste
   * ouvrirait chaque base de club a chaque chargement. Un club dont la base
   * ne repond pas est saute, pas fatal pour les autres.
   */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    // Purge d'abord : sans elle, sessions et tentatives de connexion
    // grossissent sans fin — une ligne par connexion, conservee a vie.
    await env.CONTROL.batch([
      env.CONTROL.prepare(
        "DELETE FROM sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%SZ','now')",
      ),
      env.CONTROL.prepare(
        `DELETE FROM login_attempts
          WHERE attempted_at < strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 days')`,
      ),
      env.CONTROL.prepare(
        `DELETE FROM security_events
          WHERE handled_at IS NOT NULL
            AND created_at < strftime('%Y-%m-%dT%H:%M:%SZ','now','-90 days')`,
      ),
    ])

    // Rafraichissement par lots : parcourir mille clubs d'affilee depasserait
    // le plafond de sous-requetes du Worker et le cache cesserait d'etre mis
    // a jour, pour tout le monde. On traite les plus perimes en premier.
    const { results } = await env.CONTROL.prepare(
      `SELECT o.id FROM organizations o
         LEFT JOIN org_stats s ON s.org_id = o.id
        WHERE o.status = 'active'
        ORDER BY s.refreshed_at IS NOT NULL, s.refreshed_at
        LIMIT 50`,
    ).all<{ id: string }>()

    for (const { id } of results) {
      await refreshOrgStats(env, id)
    }
  },
} satisfies ExportedHandler<Env>

/**
 * Recopie les chiffres d'un club dans le cache du plan de controle.
 *
 * Un club injoignable est saute sans faire echouer les autres : le tableau
 * de bord doit rester affichable meme si une base ne repond pas.
 */
async function refreshOrgStats(env: Env, orgId: string): Promise<void> {
  try {
    const stats = await env.CLUB.get(env.CLUB.idFromName(orgId)).stats()
    await env.CONTROL.prepare(
      `INSERT INTO org_stats (org_id, member_count, active_subs, revenue_month_cents,
                              last_activity_at, refreshed_at)
       VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
       ON CONFLICT(org_id) DO UPDATE SET
         member_count        = excluded.member_count,
         active_subs         = excluded.active_subs,
         revenue_month_cents = excluded.revenue_month_cents,
         last_activity_at    = excluded.last_activity_at,
         refreshed_at        = excluded.refreshed_at`,
    ).bind(orgId, stats.memberCount, stats.activeSubs, stats.revenueMonthCents, stats.lastActivityAt).run()
  } catch (e) {
    console.error(`stats refresh failed for ${orgId}`, e)
  }
}

export const handleApi = (request: Request, env: Env) => api.fetch(request, env)
export const refreshAllStats = (env: Env) =>
  api.scheduled(undefined as unknown as ScheduledController, env)

// Inscription ----------------------------------------------------------------

async function signup(request: Request, env: Env, ip: string | null): Promise<Response> {
  // Limite par IP avant toute lecture en base.
  //
  // La route est publique et renvoie 409 sur une adresse deja prise : c'est
  // un oracle d'existence de compte, et sans plafond il se parcourt a
  // volonte. Le plafond ne le supprime pas — il faudra une confirmation par
  // e-mail pour cela — mais il le ramene au meme rythme que la connexion.
  //
  // Uniquement quand l'adresse est connue : sans elle, un compteur commun
  // ferait d'un plafond individuel un verrou global qui bloque tout le monde.
  if (ip && await throttled(env, `signup:${ip}`, ip)) {
    return fail(429, 'Trop de tentatives. Reessayez dans quelques minutes.')
  }

  const body = await readJson(request)

  const clubName = str(body.clubName, 'clubName', 120)
  const name = str(body.name, 'name', 120)
  const email = normEmail(str(body.email, 'email', 200))
  const password = str(body.password, 'password', 200)
  const slug = str(body.slug, 'slug', 60).toLowerCase()

  if (!EMAIL.test(email)) throw new HttpError(400, 'Adresse e-mail invalide')
  if (password.length < 10) throw new HttpError(400, 'Mot de passe : 10 caracteres minimum')
  if (!SLUG.test(slug)) throw new HttpError(400, 'Identifiant de club invalide (a-z, 0-9, tirets)')

  const existing = await env.CONTROL.prepare('SELECT 1 FROM users WHERE email_norm = ?')
    .bind(email).first()
  if (existing) {
    // Une tentative comptabilisee : l'enumeration coute alors le meme prix
    // qu'une attaque de mot de passe, et se heurte au meme plafond.
    if (ip) await recordAttempt(env, `signup:${ip}`, ip, false)
    throw new HttpError(409, 'Un compte existe deja pour cette adresse')
  }

  const slugTaken = await env.CONTROL.prepare('SELECT 1 FROM organizations WHERE slug = ?')
    .bind(slug).first()
  if (slugTaken) throw new HttpError(409, 'Identifiant de club deja pris')

  const orgId = newId()
  const userId = newId()
  const passwordHash = await hashPassword(password)
  const trialEnds = isoSeconds(new Date(Date.now() + 30 * 86_400_000))

  // D1 batch : les trois ecritures du plan de controle reussissent ou
  // echouent ensemble. On ne peut pas y inclure le Durable Object, d'ou
  // l'ordre choisi : le club n'est provisionne qu'une fois l'organisation
  // enregistree, et ce provisionnement est idempotent.
  await env.CONTROL.batch([
    env.CONTROL.prepare(
      `INSERT INTO organizations (id, slug, name, plan, status, trial_ends_at, max_members)
       VALUES (?, ?, ?, 'trial', 'active', ?, 150)`,
    ).bind(orgId, slug, clubName, trialEnds),
    env.CONTROL.prepare(
      'INSERT INTO users (id, email, email_norm, name, password_hash) VALUES (?, ?, ?, ?, ?)',
    ).bind(userId, email, email, name, passwordHash),
    env.CONTROL.prepare(
      "INSERT INTO memberships (id, user_id, org_id, role) VALUES (?, ?, ?, 'owner')",
    ).bind(newId(), userId, orgId),
  ])

  // Le club demarre vide : ni succursale, ni discipline. On ne devine pas
  // quel sport il pratique ni combien de salles il a, on le lui demande.
  // Le Durable Object sera cree a sa premiere utilisation.

  const token = await createSession(env, userId, orgId, {
    ip, userAgent: request.headers.get('User-Agent'),
  })

  return json(
    { orgId, userId, slug },
    { status: 201, headers: { 'Set-Cookie': sessionCookie(request, token) } },
  )
}

// Marque -----------------------------------------------------------------------

const MAX_LOGO_BYTES = 2 * 1024 * 1024

async function brandingOf(env: Env, orgId: string) {
  const row = await env.CONTROL.prepare(
    'SELECT name, name_ar, logo_key, theme, locale FROM organizations WHERE id = ?',
  ).bind(orgId).first<{
    name: string; name_ar: string | null; logo_key: string | null
    theme: string | null; locale: string
  }>()
  if (!row) throw new HttpError(404, 'Club inconnu')

  return {
    name: row.name,
    nameAr: row.name_ar,
    // On expose l'URL du proxy, jamais la cle brute ni une URL R2 publique.
    logoUrl: row.logo_key ? `/api/branding/logo/${encodeURIComponent(row.logo_key)}` : null,
    theme: readTheme(row.theme),
    locale: row.locale,
  }
}

async function saveBranding(env: Env, orgId: string, body: Record<string, unknown>) {
  const name = optional(body.name, 120)
  const nameAr = optional(body.nameAr, 120)
  const locale = optional(body.locale, 5)
  if (locale && !['fr', 'ar'].includes(locale)) throw new HttpError(400, 'Langue non prise en charge')

  // Le theme est reconstruit champ par champ : une couleur est une teinte
  // hexadecimale validee, jamais une chaine libre qui finirait dans une
  // variable CSS.
  const theme = body.theme === undefined ? null : parseTheme(body.theme)

  await env.CONTROL.prepare(
    `UPDATE organizations
        SET name    = COALESCE(?, name),
            name_ar = COALESCE(?, name_ar),
            locale  = COALESCE(?, locale),
            theme   = COALESCE(?, theme),
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE id = ?`,
  ).bind(name, nameAr, locale, theme ? JSON.stringify(theme) : null, orgId).run()

  return brandingOf(env, orgId)
}

// Creation d'un club par la plateforme ----------------------------------------

/**
 * Ajoute un club en production depuis le tableau de bord superadmin.
 *
 * Aucun club existant n'est touche : ni lecture, ni ecriture, ni migration,
 * ni interruption. La base du nouveau club est un Durable Object distinct,
 * cree a sa premiere utilisation. Seul le catalogue central recoit trois
 * lignes, et il ne contient aucune donnee metier.
 */
async function createClub(
  body: Record<string, unknown>,
  env: Env,
  actorId: string,
  ip: string | null,
): Promise<Response> {
  const clubName = str(body.clubName, 'clubName', 120)
  const slug = str(body.slug, 'slug', 60).toLowerCase()
  const ownerName = str(body.ownerName, 'ownerName', 120)
  const ownerEmail = normEmail(str(body.ownerEmail, 'ownerEmail', 200))
  const password = str(body.ownerPassword, 'ownerPassword', 200)
  const plan = optional(body.plan, 20) ?? 'trial'

  if (!EMAIL.test(ownerEmail)) throw new HttpError(400, 'Adresse e-mail invalide')
  if (!SLUG.test(slug)) throw new HttpError(400, 'Identifiant de club invalide (a-z, 0-9, tirets)')
  if (password.length < 10) throw new HttpError(400, 'Mot de passe : 10 caracteres minimum')
  if (!['trial', 'essentiel', 'club', 'federation'].includes(plan)) {
    throw new HttpError(400, 'Formule inconnue')
  }

  if (await env.CONTROL.prepare('SELECT 1 FROM organizations WHERE slug = ?').bind(slug).first()) {
    throw new HttpError(409, 'Identifiant de club deja pris')
  }

  const orgId = newId()
  const existingUser = await env.CONTROL.prepare(
    'SELECT id FROM users WHERE email_norm = ?',
  ).bind(ownerEmail).first<{ id: string }>()

  const statements = [
    env.CONTROL.prepare(
      `INSERT INTO organizations (id, slug, name, plan, status, trial_ends_at)
       VALUES (?, ?, ?, ?, 'active', ?)`,
    ).bind(orgId, slug, clubName, plan, isoSeconds(new Date(Date.now() + 30 * 86_400_000))),
  ]

  // Un compte existant peut diriger un second club : c'est justement ce que
  // le passage de profiles.user_id UNIQUE a une table memberships autorise.
  const ownerId = existingUser?.id ?? newId()
  if (!existingUser) {
    statements.push(
      env.CONTROL.prepare(
        'INSERT INTO users (id, email, email_norm, name, password_hash) VALUES (?, ?, ?, ?, ?)',
      ).bind(ownerId, ownerEmail, ownerEmail, ownerName, await hashPassword(password)),
    )
  }

  statements.push(
    env.CONTROL.prepare(
      "INSERT INTO memberships (id, user_id, org_id, role) VALUES (?, ?, ?, 'owner')",
    ).bind(newId(), ownerId, orgId),
    env.CONTROL.prepare(
      "INSERT INTO platform_audit (actor_id, action, org_id, detail, ip) VALUES (?, 'create_club', ?, ?, ?)",
    ).bind(actorId, orgId, JSON.stringify({ slug, plan, ownerEmail }), ip),
  )

  await env.CONTROL.batch(statements)

  return json(
    { orgId, ownerId, slug, ownerExisted: Boolean(existingUser), configured: false },
    { status: 201 },
  )
}

// Connexion ------------------------------------------------------------------

// Empreinte factice, utilisee quand le compte n'existe pas : sans cela, la
// difference de duree de reponse revelerait quelles adresses sont inscrites.
const DUMMY_HASH =
  'pbkdf2$210000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

async function login(request: Request, env: Env, ip: string | null): Promise<Response> {
  const body = await readJson(request)
  const email = normEmail(str(body.email, 'email', 200))
  const password = str(body.password, 'password', 200)

  if (await throttled(env, email, ip)) {
    return fail(429, 'Trop de tentatives. Reessayez dans quelques minutes.')
  }

  const user = await env.CONTROL.prepare(
    'SELECT id, password_hash, status FROM users WHERE email_norm = ?',
  ).bind(email).first<{ id: string; password_hash: string; status: string }>()

  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH)

  if (!user || !ok || user.status !== 'active') {
    await recordAttempt(env, email, ip, false)
    await noteFailedBurst(env, email, ip)
    return fail(401, 'Identifiants invalides')
  }

  const membership = await env.CONTROL.prepare(
    `SELECT org_id FROM memberships
      WHERE user_id = ? AND status = 'active'
      ORDER BY created_at LIMIT 1`,
  ).bind(user.id).first<{ org_id: string }>()

  await recordAttempt(env, email, ip, true)
  // Une connexion reussie efface l'ardoise de ce compte : sans cela, des
  // echecs anciens continueraient a compter contre un utilisateur legitime.
  await env.CONTROL.prepare(
    'DELETE FROM login_attempts WHERE identifier = ? AND succeeded = 0',
  ).bind(email).run()
  await noteLoginLocation(env, user.id, membership?.org_id ?? null, ip, request.headers.get('User-Agent'))
  await env.CONTROL.prepare(
    "UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?",
  ).bind(user.id).run()

  const token = await createSession(env, user.id, membership?.org_id ?? null, {
    ip, userAgent: request.headers.get('User-Agent'),
  })

  return json(
    { userId: user.id, orgId: membership?.org_id ?? null },
    { headers: { 'Set-Cookie': sessionCookie(request, token) } },
  )
}
