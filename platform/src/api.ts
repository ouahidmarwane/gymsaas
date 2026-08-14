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

/**
 * Adresse bloquee par la plateforme.
 *
 * Verifie avant tout le reste : ni comptage, ni lecture du compte, ni
 * verification du mot de passe. Une adresse bloquee ne doit pas pouvoir
 * mesurer le temps de reponse pour deviner qu'un compte existe, ni remplir
 * la table des tentatives.
 */
async function ipBlocked(env: Env, ip: string | null): Promise<boolean> {
  if (!ip) return false
  const row = await env.CONTROL.prepare('SELECT 1 FROM ip_blocklist WHERE ip = ?').bind(ip).first()
  return row !== null
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

/**
 * Date calendaire au format ISO, ou null.
 *
 * Le format seul ne suffit pas : « 2026-02-31 » le respecte et n'existe pas.
 * On reconstruit la date et on verifie qu'elle se renormalise a l'identique,
 * ce qui elimine les jours hors mois sans table de correspondance.
 */
function dateOnly(v: unknown, field: string): string | null {
  const s = optional(v, 10)
  if (s === null) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, `Date invalide : ${field}`)
  const d = new Date(`${s}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new HttpError(400, `Date invalide : ${field}`)
  }
  return s
}

/**
 * Numero WhatsApp : chiffres seuls, sans « + ».
 *
 * C'est le format qu'attend un lien wa.me. Un numero saisi « +212 6 61 00 00 01 »
 * donnerait une URL invalide et un lien qui ne s'ouvre sur rien.
 */
function phoneDigits(v: unknown): string | null {
  const raw = optional(v, 30)
  if (raw === null) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 20) throw new HttpError(400, 'Numero invalide')
  return digits
}

/** Lendemain d'une date ISO, pour enchainer une periode sur la precedente. */
function nextDay(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Ajoute des mois a une date.
 *
 * Le 31 janvier plus un mois n'existe pas : Date le reporterait au 3 mars.
 * On ramene au dernier jour du mois vise, ce qui est ce qu'attend une
 * periode d'abonnement.
 */
function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, lastDay))
  return d.toISOString().slice(0, 10)
}

/**
 * Recale la fin d'abonnement sur la derniere periode reellement reglee.
 *
 * Recalculee plutot qu'incrementee : annuler un paiement doit faire reculer
 * la date, et un compteur qu'on avance seulement finit par mentir.
 */
async function recomputeExpiry(env: Env, orgId: string): Promise<void> {
  const row = await env.CONTROL.prepare(
    'SELECT MAX(period_end) AS last FROM org_invoices WHERE org_id = ? AND paid_at IS NOT NULL',
  ).bind(orgId).first<{ last: string | null }>()
  await env.CONTROL.prepare(
    `INSERT INTO org_billing (org_id, expires_at) VALUES (?, ?)
     ON CONFLICT(org_id) DO UPDATE SET expires_at = excluded.expires_at,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
  ).bind(orgId, row?.last ?? null).run()
}

/**
 * Etat d'abonnement d'un club, tel qu'il se voit lui-meme.
 *
 * Le meme calcul sert a la page du club, a son encart de tableau de bord et
 * a la redirection quand l'abonnement a expire : une seule source, sinon les
 * trois finissent par se contredire.
 */
async function subscriptionOf(env: Env, orgId: string) {
  const billing = await env.CONTROL.prepare(
    `SELECT b.price_cents, b.cycle_months, b.expires_at, b.phone, o.name AS org_name
       FROM organizations o LEFT JOIN org_billing b ON b.org_id = o.id
      WHERE o.id = ?`,
  ).bind(orgId).first<{
    price_cents: number | null; cycle_months: number | null
    expires_at: string | null; phone: string | null; org_name: string
  }>()

  const invoices = await env.CONTROL.prepare(
    `SELECT i.id, i.period_start, i.period_end, i.amount_cents, i.due_date, i.paid_at,
            p.status AS proof_status, p.reference AS proof_reference,
            p.submitted_at AS proof_at, p.reject_reason
       FROM org_invoices i
       LEFT JOIN org_invoice_proofs p ON p.invoice_id = i.id
      WHERE i.org_id = ?
      ORDER BY i.period_start DESC
      LIMIT 24`,
  ).bind(orgId).all()

  const bank = await env.CONTROL.prepare(
    "SELECT value FROM platform_settings WHERE key = 'bank_details'",
  ).first<{ value: string }>()

  const today = isoSeconds(new Date()).slice(0, 10)
  const expiresAt = billing?.expires_at ?? null
  const daysLeft = expiresAt
    ? Math.round((Date.parse(`${expiresAt}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
    : null

  // Un club sans tarif defini n'est pas en faute : la plateforme ne lui a
  // simplement rien facture. Il ne doit surtout pas etre traite en impaye.
  const configured = billing?.price_cents != null
  const open = invoices.results.filter(r => !(r as { paid_at: string | null }).paid_at)

  return {
    orgName: billing?.org_name ?? '',
    configured,
    priceCents: billing?.price_cents ?? null,
    cycleMonths: billing?.cycle_months ?? null,
    expiresAt,
    daysLeft,
    expired: configured && expiresAt !== null && daysLeft !== null && daysLeft < 0,
    dueCents: open.reduce((s, r) => s + (r as { amount_cents: number }).amount_cents, 0),
    invoices: invoices.results,
    bankDetails: bank?.value ?? null,
    today,
  }
}

const MAX_PROOF_BYTES = 4 * 1024 * 1024

/**
 * Plafond d'un import.
 *
 * Un Durable Object est mono-thread : chaque insertion bloque le club. Cinq
 * cents lignes passent en une poignee de secondes, vingt mille rendraient la
 * salle inutilisable pendant la reprise de son fichier.
 */
const MAX_IMPORT_ROWS = 500

const PROOF_TYPES: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf',
}

// Volontairement sans SVG, comme pour les logos : un SVG est un document
// capable de porter du script, et celui-ci sera ouvert par un exploitant.
function proofExtension(contentType: string): string {
  const ext = PROOF_TYPES[contentType.split(';')[0]!.trim()]
  if (!ext) throw new HttpError(400, 'Format accepte : PNG, JPEG, WebP ou PDF')
  return ext
}

/** Photo : les memes formats, moins le PDF, qui ne s'affiche pas dans <img>. */
function imageExtension(contentType: string): string {
  const ext = proofExtension(contentType)
  if (ext === 'pdf') throw new HttpError(400, 'Format accepte : PNG, JPEG ou WebP')
  return ext
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

/**
 * Adresse du client.
 *
 * CF-Connecting-IP est pose par Cloudflare devant le Worker : l'appelant ne
 * peut pas le falsifier. C'est la seule source digne de confiance, et c'est
 * elle qui arme le plafond de tentatives et la liste noire.
 *
 * En local il n'y a pas de Cloudflare devant, donc pas d'entete, donc un
 * ecran de supervision rempli de tirets. On accepte alors X-Forwarded-For,
 * mais uniquement si TRUST_FORWARDED_IP vaut '1' dans .dev.vars. Accepter cet
 * entete sans garde-fou reviendrait a laisser n'importe qui choisir son
 * adresse — et donc contourner le plafond comme le blocage.
 */
function clientIp(request: Request, env: Env): string | null {
  const real = request.headers.get('CF-Connecting-IP')
  if (real) return real
  if (env.TRUST_FORWARDED_IP !== '1') return null
  const forwarded = request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
  return forwarded || null
}

export const api = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method
    const ip = clientIp(request, env)

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

      /**
       * Tout ce qui reclame l'attention du club, en une reponse.
       *
       * Trois sources qui vivent a trois endroits : les echeances des membres
       * (base du club), l'abonnement du club a la plateforme et les evenements
       * de securite le concernant (plan de controle). Les fusionner ici plutot
       * que dans le navigateur evite trois appels au montage de chaque page,
       * et garantit que la pastille du clocheton compte la meme chose que la
       * liste qu'elle ouvre.
       *
       * Rien n'est stocke : tout se deduit des dates a la lecture.
       */
      if (path === '/api/notifications' && method === 'GET') {
        atLeast(principal, 'viewer')
        const orgId = scopedOrgId(principal)

        const [memberAlerts, subscription, events] = await Promise.all([
          clubOf(env, principal).alerts(),
          subscriptionOf(env, orgId),
          env.CONTROL.prepare(
            `SELECT e.id, e.type, e.detail, e.ip, e.created_at, u.name AS user_name
               FROM security_events e
               LEFT JOIN users u ON u.id = e.user_id
              WHERE e.org_id = ? AND e.handled_at IS NULL
                AND e.created_at > strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 days')
              ORDER BY e.created_at DESC LIMIT 20`,
          ).bind(orgId).all(),
        ])

        const items: Array<{
          id: string; kind: string; severity: 'info' | 'warn' | 'danger'
          title: string; detail: string | null; href: string | null; at: string | null
        }> = []

        // L'abonnement du club d'abord : c'est ce qui coupe tout le reste.
        if (subscription.expired) {
          items.push({
            id: 'subscription', kind: 'subscription', severity: 'danger',
            title: 'Abonnement expire',
            detail: `Couvert jusqu'au ${subscription.expiresAt}`,
            href: '/abonnement', at: subscription.expiresAt,
          })
        } else if (subscription.daysLeft !== null && subscription.daysLeft >= 0 && subscription.daysLeft <= 14) {
          items.push({
            id: 'subscription', kind: 'subscription', severity: 'warn',
            title: `Abonnement a renouveler dans ${subscription.daysLeft} jour(s)`,
            detail: subscription.dueCents > 0 ? `${Math.round(subscription.dueCents / 100)} DH a regler` : null,
            href: '/abonnement', at: subscription.expiresAt,
          })
        }

        for (const row of events.results) {
          const e = row as Record<string, unknown>
          items.push({
            id: `sec-${e.id}`, kind: 'security',
            severity: e.type === 'failed_burst' ? 'danger' : 'warn',
            title: e.type === 'failed_burst'
              ? 'Rafale d echecs de mot de passe'
              : `Connexion depuis un nouvel appareil${e.user_name ? ` — ${e.user_name}` : ''}`,
            detail: (e.ip as string | null) ?? null,
            href: '/account', at: e.created_at as string,
          })
        }

        const LABEL: Record<string, string> = {
          sub_expired: 'Abonnement expire', sub_expiring: 'Abonnement bientot expire',
          ins_expired: 'Assurance expiree', ins_expiring: 'Assurance bientot expiree',
          ins_missing: 'Assurance manquante',
        }
        for (const a of memberAlerts) {
          items.push({
            id: `m-${a.memberId}-${a.kind}`, kind: 'member',
            severity: a.kind.endsWith('_expired') || a.kind === 'ins_missing' ? 'danger' : 'warn',
            title: `${a.name} — ${LABEL[a.kind] ?? a.kind}`,
            detail: a.daysLeft === null ? null
              : a.daysLeft < 0 ? `${Math.abs(a.daysLeft)} jour(s) de retard`
              : `dans ${a.daysLeft} jour(s)`,
            href: '/members', at: a.dueDate,
          })
        }

        // Le plus grave d'abord : une liste triee par date enterrerait un
        // abonnement coupe sous vingt assurances qui expirent la semaine
        // prochaine.
        const WEIGHT = { danger: 0, warn: 1, info: 2 }
        items.sort((a, b) => WEIGHT[a.severity] - WEIGHT[b.severity])

        return json({ items, count: items.length })
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
        const from = dateOnly(url.searchParams.get('from'), 'from')
        const to = dateOnly(url.searchParams.get('to'), 'to')
        if (from && to && to < from) return fail(400, 'La periode se termine avant de commencer')

        const [payments, byMonth, byType, byMethod, outstanding] = await Promise.all([
          club.listPayments({
            year: year ? Number(year) : undefined,
            month: month ? Number(month) : undefined,
            from: from ?? undefined,
            to: to ?? undefined,
            branchId: optional(url.searchParams.get('branchId'), 60),
          }),
          club.revenueByMonth(),
          club.revenueByType(),
          club.revenueByMethod({ from: from ?? undefined, to: to ?? undefined }),
          club.outstanding(),
        ])
        return json({ payments, byMonth, byType, byMethod, outstanding })
      }

      // Annulation : une ecriture inverse, jamais une modification.
      const reverseRoute = path.match(/^\/api\/payments\/([^/]+)\/reverse$/)
      if (reverseRoute && method === 'POST') {
        atLeast(principal, 'admin', true)
        const body = await readJson(request)
        // Valide AVANT le try : un motif manquant est une erreur de requete
        // (400), pas un refus metier (409). Les melanger rendait « motif
        // absent » indiscernable de « deja annule ».
        const reason = str(body.reason, 'reason', 300)
        const kind = str(body.kind, 'kind', 20)
        if (kind !== 'erreur' && kind !== 'remboursement') {
          throw new HttpError(400, 'kind attendu : erreur ou remboursement')
        }
        const refundedAt = dateOnly(body.refundedAt, 'refundedAt')
        try {
          const result = await clubOf(env, principal).reversePayment({
            paymentId: reverseRoute[1]!,
            kind, reason, refundedAt,
            actorId: principal.userId, actorName: principal.name,
          })
          return json(result, { status: 201 })
        } catch (e) {
          // Le Durable Object refuse d'annuler deux fois ou d'annuler une
          // annulation : ce sont des refus metier, pas des pannes.
          return fail(409, e instanceof Error ? e.message : 'Annulation impossible')
        }
      }

      if (path === '/api/payments' && method === 'POST') {
        atLeast(principal, 'staff', true)
        const body = await readJson(request)
        const amount = Number(body.amountCents)
        // Strictement positif : un encaissement de zero est du bruit dans le
        // releve, et un negatif ne peut venir que de la route d'annulation.
        if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
          throw new HttpError(400, 'Montant invalide : un encaissement doit etre positif')
        }
        const type = str(body.type, 'type', 20)
        if (!['monthly', 'insurance', 'registration', 'other'].includes(type)) {
          throw new HttpError(400, 'Type de paiement inconnu')
        }
        const { id } = await clubOf(env, principal).addPayment({
          memberId: str(body.memberId, 'memberId', 60),
          amountCents: Math.round(amount),
          type,
          method: optional(body.method, 40),
          paidAt: dateOnly(body.paidAt, 'paidAt') ?? undefined,
          notes: optional(body.notes, 300),
          actorId: principal.userId, actorName: principal.name,
        })
        return json({ id }, { status: 201 })
      }

      // Comptabilite previsionnelle : effectifs x tarifs, par salle.
      if (path === '/api/finance' && method === 'GET') {
        atLeast(principal, 'admin')
        const branchId = url.searchParams.get('branchId')
        const year = url.searchParams.get('year')
        const month = url.searchParams.get('month')
        const num = (v: string | null) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
        return json(await clubOf(env, principal).finance({
          // Une chaine vide veut dire « toutes les salles », pas « la salle
          // sans nom » : seul un parametre absent ou vide leve le filtre.
          branchId: branchId === null || branchId === 'all' ? null : branchId,
          year: num(year),
          month: num(month),
        }))
      }

      if (path === '/api/finance/prices' && method === 'PUT') {
        atLeast(principal, 'admin', true)
        const body = await readJson(request)
        const price = (key: string) => {
          const v = Number(body[key])
          if (!Number.isFinite(v) || v < 0 || v > 100_000_000) {
            throw new HttpError(400, `Tarif invalide : ${key}`)
          }
          return Math.round(v)
        }
        const prices = {
          monthlyCents: price('monthlyCents'),
          insuranceCents: price('insuranceCents'),
          registrationCents: price('registrationCents'),
        }
        await clubOf(env, principal).setPrices(prices, { id: principal.userId, name: principal.name })
        return json({ prices })
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
      /**
       * Banniere du club, posee par la plateforme.
       *
       * Reservee a l'exploitant : c'est une piece d'identite visuelle qu'on
       * installe pour le client, comme la disposition des ecrans. Un club qui
       * pourrait la remplacer casserait sa propre en-tete sans recours.
       *
       * Meme prefixe R2 que le logo, donc le meme proxy la sert et la meme
       * garde de cle s'applique — aucune surface nouvelle a securiser.
       */
      if (path === '/api/branding/banner' && (method === 'PUT' || method === 'DELETE')) {
        if (!principal.isPlatformAdmin) return fail(403, 'Reserve a la plateforme')
        const orgId = scopedOrgId(principal)

        const previous = await env.CONTROL.prepare(
          'SELECT file_key FROM org_banners WHERE org_id = ?',
        ).bind(orgId).first<{ file_key: string }>()

        if (method === 'DELETE') {
          if (previous) await env.MEDIA.delete(previous.file_key).catch(() => {})
          await env.CONTROL.prepare('DELETE FROM org_banners WHERE org_id = ?').bind(orgId).run()
          return json({ ok: true })
        }

        const contentType = request.headers.get('Content-Type') ?? ''
        const ext = logoExtension(contentType)
        // Taille verifiee avant lecture : une banniere pleine largeur invite
        // a televerser un fichier d'appareil photo de vingt megaoctets.
        const declared = Number(request.headers.get('Content-Length') ?? '0')
        if (!Number.isFinite(declared) || declared > MAX_BANNER_BYTES) {
          throw new HttpError(413, 'Banniere trop volumineuse : 4 Mo maximum')
        }
        const bytes = await request.arrayBuffer()
        if (bytes.byteLength === 0) throw new HttpError(400, 'Fichier vide')
        if (bytes.byteLength > MAX_BANNER_BYTES) {
          throw new HttpError(413, 'Banniere trop volumineuse : 4 Mo maximum')
        }

        const key = `org-logos/${orgId}/banner-${Date.now()}.${ext}`
        await env.MEDIA.put(key, bytes, { httpMetadata: { contentType } })
        await env.CONTROL.prepare(
          `INSERT INTO org_banners (org_id, file_key, updated_by) VALUES (?, ?, ?)
           ON CONFLICT(org_id) DO UPDATE SET file_key = excluded.file_key,
             updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
             updated_by = excluded.updated_by`,
        ).bind(orgId, key, principal.userId).run()

        // L'ancienne apres la nouvelle : si l'ecriture echoue, le club garde
        // une banniere plutot que de se retrouver sans rien.
        if (previous) await env.MEDIA.delete(previous.file_key).catch(() => {})

        return json({ bannerUrl: `/api/branding/logo/${encodeURIComponent(key)}` })
      }

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

        // Lire sa disposition est le droit de tout le club — c'est ce qui
        // dessine ses ecrans. La modifier appartient a la plateforme seule :
        // le bouton n'est propose qu'a l'exploitant, et une route ouverte
        // derriere un bouton cache ne serait pas une regle, juste un decor.
        if (method === 'PUT' || method === 'DELETE') {
          atLeast(principal, 'admin', true)
          if (!principal.isPlatformAdmin) {
            throw new HttpError(403, 'La disposition des ecrans est geree par la plateforme')
          }
        }

        if (method === 'PUT') {
          const body = await readJson(request)
          const layout = parseLayout(page, body.layout)
          await club.setSetting(layoutKey(page), layout)
          if (activeScope(principal).mode === 'support') {
            await auditSupport(env, principal, 'support_write_layout', { page, cards: layout.length }, ip)
          }
          return json({ layout })
        }

        if (method === 'DELETE') {
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
        // Le filtre discipline vient de la barre du haut. Absent ou 'all',
        // il ne restreint rien : un club a discipline unique ne le voit meme
        // pas s'afficher.
        const wanted = url.searchParams.get('disciplineId')
        const members = await club.listMembers({
          limit: intParam(url, 'limit', 50),
          offset: intParam(url, 'offset', 0),
          search: url.searchParams.get('q') ?? undefined,
          disciplineId: wanted && wanted !== 'all' ? wanted : null,
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
          subExpiry: dateOnly(body.subExpiry, 'subExpiry'),
          joinDate: dateOnly(body.joinDate, 'joinDate'),
          insExpiry: dateOnly(body.insExpiry, 'insExpiry'),
          isInsured: body.isInsured === true,
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
          subExpiry: dateOnly(body.subExpiry, 'subExpiry'),
          insExpiry: dateOnly(body.insExpiry, 'insExpiry'),
          joinDate: dateOnly(body.joinDate, 'joinDate'),
          isInsured: typeof body.isInsured === 'boolean' ? body.isInsured : undefined,
          notes: optional(body.notes, 1000),
          actorId: principal.userId, actorName: principal.name,
        })
        return json({ ok: true })
      }

      /**
       * Import en lot.
       *
       * Le fichier n'arrive JAMAIS ici. Le navigateur l'analyse, l'utilisateur
       * relit ce qu'il a compris, et seules des lignes structurees sont
       * envoyees. Consequence : aucun analyseur de format cote serveur, donc
       * aucune surface d'attaque liee au format — et surtout, chaque ligne
       * traverse exactement les memes validations qu'une creation a la main.
       * Un import ne peut donc pas ecrire ce qu'un formulaire refuserait.
       */
      if (path === '/api/members/import' && method === 'POST') {
        atLeast(principal, 'admin', true)
        const body = await readJson(request)
        const rows = body.rows
        if (!Array.isArray(rows)) return fail(400, 'rows doit etre une liste')
        // Plafond : un Durable Object est mono-thread, et vingt mille
        // insertions dans une seule requete bloqueraient le club entier.
        if (rows.length === 0) return fail(400, 'Aucune ligne a importer')
        if (rows.length > MAX_IMPORT_ROWS) {
          return fail(413, `${MAX_IMPORT_ROWS} lignes maximum par import`)
        }

        const club = clubOf(env, principal)
        const created: string[] = []
        const rejected: Array<{ line: number; reason: string }> = []

        for (const [index, raw] of rows.entries()) {
          const line = index + 1
          try {
            if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Ligne illisible')
            const row = raw as Record<string, unknown>
            const { id } = await club.addMember({
              name: str(row.name, 'name', 200),
              phone: str(row.phone, 'phone', 30),
              email: typeof row.email === 'string' && row.email.trim()
                ? normEmail(row.email) : null,
              branchId: optional(row.branchId, 60),
              disciplineId: optional(row.disciplineId, 60),
              joinDate: dateOnly(row.joinDate, 'joinDate'),
              subExpiry: dateOnly(row.subExpiry, 'subExpiry'),
              insExpiry: dateOnly(row.insExpiry, 'insExpiry'),
              isInsured: row.isInsured === true,
              actorId: principal.userId, actorName: principal.name,
            })
            created.push(id)
          } catch (e) {
            // Une ligne fautive n'annule pas les autres : sur deux cents
            // membres, tout rejeter pour un telephone manquant obligerait a
            // recommencer a zero. On dit precisement laquelle et pourquoi.
            rejected.push({
              line,
              reason: e instanceof HttpError ? e.message
                : e instanceof Error ? e.message : 'Ligne refusee',
            })
          }
        }

        return json({ created: created.length, rejected }, { status: 201 })
      }

      /**
       * Photo du membre.
       *
       * Separee de la piece d'identite, et pas seulement pour l'affichage :
       * une photo de trombinoscope se montre a l'accueil, un scan de carte
       * nationale ne se montre pas. Un seul emplacement pour les deux aurait
       * donne le meme droit de lecture aux deux.
       */
      const memberPhoto = path.match(/^\/api\/members\/([^/]+)\/photo$/)
      if (memberPhoto && method === 'PUT') {
        atLeast(principal, 'staff', true)
        const memberId = memberPhoto[1]!
        const club = clubOf(env, principal)
        if (!(await club.getMember(memberId))) return fail(404, 'Membre inconnu')

        const contentType = request.headers.get('Content-Type') ?? ''
        // Pas de PDF ici : une photo s'affiche dans une balise <img>, et un
        // PDF y donnerait un cadre vide sans dire pourquoi.
        const ext = imageExtension(contentType)
        const declared = Number(request.headers.get('Content-Length') ?? '0')
        if (!Number.isFinite(declared) || declared > MAX_PROOF_BYTES) {
          throw new HttpError(413, 'Photo trop volumineuse : 4 Mo maximum')
        }
        const bytes = await request.arrayBuffer()
        if (bytes.byteLength === 0) throw new HttpError(400, 'Fichier vide')
        if (bytes.byteLength > MAX_PROOF_BYTES) {
          throw new HttpError(413, 'Photo trop volumineuse : 4 Mo maximum')
        }

        const fileKey = `member-photos/${scopedOrgId(principal)}/${memberId}-${Date.now()}.${ext}`
        await env.MEDIA.put(fileKey, bytes, { httpMetadata: { contentType } })
        const { previousKey } = await club.setMemberPhoto({
          memberId, fileKey, actorId: principal.userId, actorName: principal.name,
        })
        if (previousKey) await env.MEDIA.delete(previousKey)

        return json({ ok: true })
      }

      if (memberPhoto && method === 'GET') {
        // La photo est visible par qui peut consulter la fiche, y compris un
        // role de lecture seule : elle sert a reconnaitre la personne au
        // comptoir. La piece d'identite, elle, exige davantage.
        atLeast(principal, 'viewer')
        const member = await clubOf(env, principal).getMember(memberPhoto[1]!)
        if (!member?.photo_key) return fail(404, 'Aucune photo')
        const object = await env.MEDIA.get(String(member.photo_key))
        if (!object) return fail(404, 'Fichier introuvable')
        return new Response(object.body, {
          headers: {
            'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
            // Cache franc : l'adresse porte la date de depot, donc un
            // remplacement change l'adresse et le cache ne ment jamais.
            'Cache-Control': 'private, max-age=300',
            'X-Content-Type-Options': 'nosniff',
          },
        })
      }

      if (memberPhoto && method === 'DELETE') {
        atLeast(principal, 'staff', true)
        const { previousKey } = await clubOf(env, principal)
          .clearMemberPhoto(memberPhoto[1]!, { id: principal.userId, name: principal.name })
        if (previousKey) await env.MEDIA.delete(previousKey)
        return json({ ok: true })
      }

      /**
       * Piece d'identite d'un membre : carte nationale ou passeport.
       *
       * Le fichier arrive brut dans le corps, comme le logo et le
       * justificatif de virement. La cle R2 est fabriquee ici, donc
       * infalsifiable, et elle ne sort jamais : la lecture passe par le GET
       * ci-dessous, qui reverifie a chaque appel a quel club appartient le
       * demandeur.
       */
      const memberDoc = path.match(/^\/api\/members\/([^/]+)\/document$/)
      if (memberDoc && method === 'PUT') {
        atLeast(principal, 'staff', true)
        const memberId = memberDoc[1]!
        const club = clubOf(env, principal)
        const member = await club.getMember(memberId)
        if (!member) return fail(404, 'Membre inconnu')

        const docType = url.searchParams.get('type')
        if (docType !== 'cin' && docType !== 'passeport') {
          return fail(400, 'Type de piece : cin ou passeport')
        }
        const docNumber = url.searchParams.get('number')?.trim().slice(0, 40) || null

        const contentType = request.headers.get('Content-Type') ?? ''
        let fileKey: string | null = null
        if (contentType && !contentType.includes('application/json')) {
          const ext = proofExtension(contentType)
          // Verifie AVANT de lire : un corps de 100 Mo serait entierement
          // charge en memoire avant d'etre refuse.
          const declared = Number(request.headers.get('Content-Length') ?? '0')
          if (!Number.isFinite(declared) || declared > MAX_PROOF_BYTES) {
            throw new HttpError(413, 'Fichier trop volumineux : 4 Mo maximum')
          }
          const bytes = await request.arrayBuffer()
          if (bytes.byteLength === 0) throw new HttpError(400, 'Fichier vide')
          if (bytes.byteLength > MAX_PROOF_BYTES) {
            throw new HttpError(413, 'Fichier trop volumineux : 4 Mo maximum')
          }
          fileKey = `member-docs/${scopedOrgId(principal)}/${memberId}-${Date.now()}.${ext}`
          await env.MEDIA.put(fileKey, bytes, { httpMetadata: { contentType } })
        } else if (!member.id_doc_key) {
          return fail(400, 'Joignez le scan de la piece')
        }

        const { previousKey } = await club.setMemberDocument({
          memberId, docType, docNumber, fileKey,
          actorId: principal.userId, actorName: principal.name,
        })
        // Le remplacement n'est efface qu'une fois la nouvelle cle ecrite :
        // dans l'autre ordre, une panne entre les deux laisserait la fiche
        // pointant vers un fichier qui n'existe plus.
        if (previousKey) await env.MEDIA.delete(previousKey)

        return json({ ok: true })
      }

      if (memberDoc && method === 'GET') {
        // Lecture reservee au personnel : un scan de carte nationale est une
        // donnee personnelle, et le role « viewer » existe pour consulter des
        // chiffres, pas des pieces d'identite.
        atLeast(principal, 'staff')
        const member = await clubOf(env, principal).getMember(memberDoc[1]!)
        if (!member?.id_doc_key) return fail(404, 'Aucune piece enregistree')
        const object = await env.MEDIA.get(String(member.id_doc_key))
        if (!object) return fail(404, 'Fichier introuvable')
        return new Response(object.body, {
          headers: {
            'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
            // Privee et courte : une piece d'identite n'a rien a faire dans
            // le cache d'un intermediaire.
            'Cache-Control': 'private, max-age=60, no-store',
            'Content-Disposition': 'inline',
            'X-Content-Type-Options': 'nosniff',
          },
        })
      }

      if (memberDoc && method === 'DELETE') {
        atLeast(principal, 'admin', true)
        const { previousKey } = await clubOf(env, principal)
          .clearMemberDocument(memberDoc[1]!, { id: principal.userId, name: principal.name })
        if (previousKey) await env.MEDIA.delete(previousKey)
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

      /**
       * Renouvellement d'assurance.
       *
       * Distinct de l'abonnement : les deux echeances courent separement, et
       * les confondre obligerait a renouveler l'une pour prolonger l'autre.
       * Un encaissement accompagne le geste au tarif d'assurance en vigueur,
       * comme pour l'abonnement — les separer laisse la caisse diverger des
       * le premier oubli.
       */
      const insuranceRoute = path.match(/^\/api\/members\/([^/]+)\/insurance$/)
      if (insuranceRoute && method === 'POST') {
        atLeast(principal, 'staff', true)
        const body = await readJson(request)
        const months = Number(body.months ?? 12)
        if (!Number.isInteger(months) || months < 1 || months > 36) {
          throw new HttpError(400, 'Duree invalide : de 1 a 36 mois')
        }
        const result = await clubOf(env, principal).renewInsurance({
          memberId: insuranceRoute[1]!,
          months,
          charge: body.charge !== false,
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

        const [sessions, events, attempts, offenders, blocklist, clubs] = await Promise.all([
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

          // Vue par ADRESSE, et non par compte : une attaque par dictionnaire
          // essaie cinquante e-mails differents depuis une seule adresse.
          // Groupee par compte, elle reste invisible — trois echecs par
          // e-mail ne declenchent rien. C'est cette ligne-la qu'on bloque.
          env.CONTROL.prepare(
            `SELECT a.ip,
                    COUNT(*)                    AS failures,
                    COUNT(DISTINCT a.identifier) AS accounts,
                    MAX(a.attempted_at)          AS last_attempt,
                    (SELECT COUNT(*) FROM ip_blocklist b WHERE b.ip = a.ip) AS blocked
               FROM login_attempts a
              WHERE a.succeeded = 0 AND a.attempted_at > ? AND a.ip IS NOT NULL
              GROUP BY a.ip
             HAVING failures >= 3
              ORDER BY failures DESC, last_attempt DESC
              LIMIT 50`,
          ).bind(isoSeconds(new Date(Date.now() - 86_400_000))).all(),

          env.CONTROL.prepare(
            `SELECT b.ip, b.reason, b.created_at, u.name AS created_by_name
               FROM ip_blocklist b
               LEFT JOIN users u ON u.id = b.created_by
              ORDER BY b.created_at DESC
              LIMIT 200`,
          ).all(),

          // Carte : un club par point, avec de quoi le peindre et savoir s'il
          // se passe quelque chose. Les agregats sont calcules ici plutot que
          // dans le navigateur — la carte doit rester fluide.
          env.CONTROL.prepare(
            `SELECT o.id, o.name, o.slug, o.theme, o.status, o.plan,
                    l.lat, l.lng, l.label,
                    (SELECT MAX(s.last_seen_at) FROM sessions s
                      WHERE s.org_id = o.id AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now')
                    ) AS last_seen_at,
                    (SELECT COUNT(*) FROM sessions s
                      WHERE s.org_id = o.id
                        AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now')
                        AND s.last_seen_at > ?
                    ) AS online,
                    (SELECT COUNT(*) FROM security_events e
                      WHERE e.org_id = o.id AND e.handled_at IS NULL AND e.created_at > ?
                    ) AS open_alerts,
                    (SELECT COUNT(*) FROM sessions s
                      WHERE s.support_org_id = o.id
                        AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now')
                    ) AS under_support
               FROM organizations o
               LEFT JOIN org_locations l ON l.org_id = o.id
              ORDER BY o.name
              LIMIT 500`,
          ).bind(isoSeconds(new Date(Date.now() - 130_000)), cutoff).all(),
        ])

        return json({
          sessions: sessions.results,
          events: events.results,
          failedAttempts: attempts.results,
          offenders: offenders.results,
          blocklist: blocklist.results,
          clubs: clubs.results.map(row => {
            const c = row as Record<string, unknown>
            return { ...c, theme: readTheme(c.theme as string | null) }
          }),
          serverTime: isoSeconds(new Date()),
        })
      }

      // Emplacement d'un club, pose a la main par l'exploitant.
      const locationRoute = path.match(/^\/api\/admin\/clubs\/([^/]+)\/location$/)
      if (locationRoute && (method === 'PUT' || method === 'DELETE')) {
        if (!principal.isPlatformAdmin) return fail(403, 'Reserve a la plateforme')
        const orgId = locationRoute[1]!

        if (method === 'DELETE') {
          await env.CONTROL.prepare('DELETE FROM org_locations WHERE org_id = ?').bind(orgId).run()
          return json({ ok: true })
        }

        const body = await readJson(request)
        const lat = Number(body.lat)
        const lng = Number(body.lng)
        // Bornes du globe : une valeur hors plage placerait le point nulle
        // part et ferait deriver le cadrage de toute la carte.
        if (!Number.isFinite(lat) || lat < -90 || lat > 90) return fail(400, 'Latitude invalide')
        if (!Number.isFinite(lng) || lng < -180 || lng > 180) return fail(400, 'Longitude invalide')

        const known = await env.CONTROL.prepare('SELECT 1 FROM organizations WHERE id = ?')
          .bind(orgId).first()
        if (!known) return fail(404, 'Club inconnu')

        await env.CONTROL.prepare(
          `INSERT INTO org_locations (org_id, lat, lng, label) VALUES (?, ?, ?, ?)
           ON CONFLICT(org_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng,
             label = excluded.label, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
        ).bind(orgId, lat, lng, optional(body.label, 200)).run()
        return json({ lat, lng })
      }

      /**
       * Suppression definitive d'un club.
       *
       * Trois choses meurent ensemble, et l'ordre compte : la base du club
       * (le Durable Object), ses fichiers dans R2, puis sa ligne centrale.
       * Commencer par la ligne centrale ferait perdre l'identifiant, donc
       * l'adresse de l'objet et le prefixe des fichiers — on laisserait
       * derriere soi une base et des images que plus rien ne designe.
       *
       * Le corps doit reprendre le slug exact. Une confirmation dans
       * l'interface seule ne protege pas d'un appel direct, et il n'y a pas
       * de corbeille : ce qui part ne revient pas.
       */
      const deleteClubRoute = path.match(/^\/api\/admin\/clubs\/([^/]+)$/)
      if (deleteClubRoute && method === 'DELETE') {
        if (!principal.isPlatformAdmin) return fail(403, 'Reserve a la plateforme')
        const orgId = deleteClubRoute[1]!

        const org = await env.CONTROL.prepare(
          'SELECT id, slug, name, logo_key FROM organizations WHERE id = ?',
        ).bind(orgId).first<{ id: string; slug: string; name: string; logo_key: string | null }>()
        if (!org) return fail(404, 'Club inconnu')

        const body = await readJson(request)
        if (str(body.slug, 'slug', 60) !== org.slug) {
          return fail(400, `Pour confirmer, saisissez exactement : ${org.slug}`)
        }

        // 1. La base du club. Sans cela le Durable Object survivrait, et un
        //    club recree sous le meme nom en heriterait les donnees.
        await env.CLUB.get(env.CLUB.idFromName(orgId)).destroyAll()

        // 2. Les fichiers. On balaie les prefixes plutot que de se fier aux
        //    seules cles enregistrees : les logos precedents restent en place
        //    a chaque remplacement. Les pieces d'identite des membres sont du
        //    lot — supprimer un club en laissant derriere soi des scans de
        //    cartes nationales serait le pire oubli possible.
        for (const prefix of [`org-logos/${orgId}/`, `member-docs/${orgId}/`,
                              `member-photos/${orgId}/`]) {
          let cursor: string | undefined
          do {
            const page = await env.MEDIA.list({ prefix, cursor })
            if (page.objects.length > 0) {
              await env.MEDIA.delete(page.objects.map(o => o.key))
            }
            cursor = page.truncated ? page.cursor : undefined
          } while (cursor)
        }

        // 3. Le plan de controle. Les dependances sont supprimees a la main :
        //    les cascades dependent d'un PRAGMA par connexion, ce qui est une
        //    hypothese trop fragile pour une suppression definitive.
        const batch = [
          env.CONTROL.prepare('DELETE FROM sessions WHERE org_id = ? OR support_org_id = ?').bind(orgId, orgId),
          env.CONTROL.prepare('DELETE FROM memberships WHERE org_id = ?').bind(orgId),
          env.CONTROL.prepare('DELETE FROM org_stats WHERE org_id = ?').bind(orgId),
          env.CONTROL.prepare('DELETE FROM org_locations WHERE org_id = ?').bind(orgId),
          // Les evenements de securite gardent leur trace, prives de club :
          // effacer l'historique d'une alerte parce que le club a ferme
          // reviendrait a effacer la preuve.
          env.CONTROL.prepare('UPDATE security_events SET org_id = NULL WHERE org_id = ?').bind(orgId),
          env.CONTROL.prepare('DELETE FROM organizations WHERE id = ?').bind(orgId),
        ]
        await env.CONTROL.batch(batch)

        // Les comptes qui ne servaient que ce club n'ont plus rien a ouvrir.
        // Les laisser bloquerait leur adresse e-mail pour une inscription
        // future, sans leur donner acces a quoi que ce soit.
        const orphans = await env.CONTROL.prepare(
          `DELETE FROM users
            WHERE is_platform_admin = 0
              AND id NOT IN (SELECT user_id FROM memberships)
          RETURNING email`,
        ).all<{ email: string }>()

        await env.CONTROL.prepare(
          "INSERT INTO platform_audit (actor_id, action, detail, ip) VALUES (?, 'club_delete', ?, ?)",
        ).bind(
          principal.userId,
          JSON.stringify({ orgId, slug: org.slug, name: org.name, orphans: orphans.results.length }),
          ip,
        ).run()

        return json({ ok: true, orphanedAccounts: orphans.results.length })
      }

      // Abonnement, vu par le club lui-meme -------------------------------
      //
      // Un club voit SON abonnement, jamais celui d'un autre : l'identifiant
      // vient de la session, aucun parametre ne peut le changer.

      if (path === '/api/subscription' && method === 'GET') {
        atLeast(principal, 'viewer')
        return json(await subscriptionOf(env, scopedOrgId(principal)))
      }

      /**
       * Justificatif de virement.
       *
       * Le fichier est pousse tel quel dans le corps, comme le logo : une URL
       * signee serait plus lourde pour quelques centaines de kilo-octets, et
       * la cle est fabriquee ici, donc infalsifiable.
       */
      const proofRoute = path.match(/^\/api\/subscription\/invoices\/([^/]+)\/proof$/)
      if (proofRoute && method === 'PUT') {
        atLeast(principal, 'admin', true)
        const orgId = scopedOrgId(principal)
        const invoiceId = proofRoute[1]!

        const invoice = await env.CONTROL.prepare(
          'SELECT id FROM org_invoices WHERE id = ? AND org_id = ?',
        ).bind(invoiceId, orgId).first()
        if (!invoice) return fail(404, 'Echeance inconnue')

        const contentType = request.headers.get('Content-Type') ?? ''
        const reference = url.searchParams.get('reference')?.slice(0, 80) ?? null

        let fileKey: string | null = null
        if (contentType && !contentType.includes('application/json')) {
          const ext = proofExtension(contentType)
          // La taille annoncee est verifiee AVANT de lire : un corps de
          // 100 Mo serait entierement charge en memoire avant d'etre refuse.
          const declared = Number(request.headers.get('Content-Length') ?? '0')
          if (!Number.isFinite(declared) || declared > MAX_PROOF_BYTES) {
            throw new HttpError(413, 'Justificatif trop volumineux : 4 Mo maximum')
          }
          const bytes = await request.arrayBuffer()
          if (bytes.byteLength === 0) throw new HttpError(400, 'Fichier vide')
          if (bytes.byteLength > MAX_PROOF_BYTES) {
            throw new HttpError(413, 'Justificatif trop volumineux : 4 Mo maximum')
          }
          fileKey = `billing-proofs/${orgId}/${invoiceId}-${Date.now()}.${ext}`
          await env.MEDIA.put(fileKey, bytes, { httpMetadata: { contentType } })
        }

        // Un depot remplace le precedent : un club qui s'est trompe de fichier
        // doit pouvoir corriger sans creer une seconde demande a arbitrer.
        await env.CONTROL.prepare(
          `INSERT INTO org_invoice_proofs (invoice_id, org_id, file_key, reference, submitted_by, status)
           VALUES (?, ?, ?, ?, ?, 'pending')
           ON CONFLICT(invoice_id) DO UPDATE SET
             file_key = COALESCE(excluded.file_key, org_invoice_proofs.file_key),
             reference = excluded.reference,
             status = 'pending', reject_reason = NULL,
             submitted_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
             submitted_by = excluded.submitted_by,
             reviewed_at = NULL, reviewed_by = NULL`,
        ).bind(invoiceId, orgId, fileKey, reference, principal.userId).run()

        return json({ ok: true })
      }

      // Facturation des clubs -------------------------------------------
      //
      // Ce que la plateforme facture a ses clients, a ne pas confondre avec
      // la comptabilite d'un club, qui vit dans sa propre base.

      if (path === '/api/admin/billing' && method === 'GET') {
        if (!principal.isPlatformAdmin) return fail(403, 'Reserve a la plateforme')

        const year = intParam(url, 'year', new Date().getUTCFullYear())
        const rawMonth = url.searchParams.get('month')
        const month = rawMonth !== null && rawMonth !== '' && Number.isFinite(Number(rawMonth))
          ? Math.min(Math.max(Math.trunc(Number(rawMonth)), 0), 11)
          : null

        // Les echeances retenues sont celles dont la periode COMMENCE dans la
        // fenetre : une periode a cheval sur deux mois appartient au mois ou
        // elle demarre, sinon elle serait comptee deux fois.
        const from = `${year}-01-01`
        const to = `${year}-12-31`

        const [clubs, invoices, byMonth] = await Promise.all([
          env.CONTROL.prepare(
            `SELECT o.id, o.name, o.slug, o.theme, o.plan, o.status, o.created_at,
                    b.price_cents, b.cycle_months, b.phone, b.started_at, b.expires_at, b.notes,
                    (SELECT COUNT(*) FROM org_invoices i
                      WHERE i.org_id = o.id AND i.paid_at IS NULL) AS unpaid_count,
                    (SELECT COALESCE(SUM(i.amount_cents), 0) FROM org_invoices i
                      WHERE i.org_id = o.id AND i.paid_at IS NULL) AS unpaid_cents,
                    (SELECT MIN(i.due_date) FROM org_invoices i
                      WHERE i.org_id = o.id AND i.paid_at IS NULL) AS next_due,
                    (SELECT MAX(i.paid_at) FROM org_invoices i WHERE i.org_id = o.id) AS last_paid_at,
                    -- Derniere relance, toutes echeances confondues : c'est
                    -- elle qui dit s'il est decent de relancer a nouveau.
                    (SELECT MAX(r.last_reminder_at)
                       FROM org_invoice_reminders r
                       JOIN org_invoices i ON i.id = r.invoice_id
                      WHERE i.org_id = o.id) AS last_reminder_at
               FROM organizations o
               LEFT JOIN org_billing b ON b.org_id = o.id
              ORDER BY o.name
              LIMIT 500`,
          ).all(),

          env.CONTROL.prepare(
            `SELECT i.*, o.name AS org_name, o.slug AS org_slug, b.phone,
                    p.status AS proof_status, p.reference AS proof_reference,
                    p.file_key IS NOT NULL AS proof_has_file, p.submitted_at AS proof_at,
                    -- Tracabilite de l'arbitrage : qui a tranche, et quand.
                    p.reviewed_at AS proof_reviewed_at, p.reject_reason AS proof_reject_reason,
                    ru.name AS proof_reviewed_by_name,
                    r.last_reminder_at, r.reminder_count
               FROM org_invoices i
               JOIN organizations o ON o.id = i.org_id
               LEFT JOIN org_billing b ON b.org_id = i.org_id
               LEFT JOIN org_invoice_proofs p ON p.invoice_id = i.id
               LEFT JOIN users ru ON ru.id = p.reviewed_by
               LEFT JOIN org_invoice_reminders r ON r.invoice_id = i.id
              WHERE i.period_start BETWEEN ? AND ?
                AND (? IS NULL OR CAST(strftime('%m', i.period_start) AS INTEGER) - 1 = ?)
              ORDER BY i.due_date DESC
              LIMIT 500`,
          ).bind(from, to, month, month).all(),

          // Encaisse contre facture, par mois : l'ecart entre les deux
          // courbes est le retard de paiement, et c'est lui qu'on regarde.
          env.CONTROL.prepare(
            `SELECT CAST(strftime('%m', period_start) AS INTEGER) - 1 AS m,
                    COALESCE(SUM(amount_cents), 0) AS billed,
                    COALESCE(SUM(CASE WHEN paid_at IS NOT NULL THEN amount_cents ELSE 0 END), 0) AS paid
               FROM org_invoices
              WHERE period_start BETWEEN ? AND ?
              GROUP BY m`,
          ).bind(from, to).all<{ m: number; billed: number; paid: number }>(),
        ])

        const bank = await env.CONTROL.prepare(
          "SELECT value FROM platform_settings WHERE key = 'bank_details'",
        ).first<{ value: string }>()

        // Encaisse du mois en cours, compte sur la date de REGLEMENT et non
        // sur la periode : c'est la tresorerie du mois, pas son chiffre
        // d'affaires theorique.
        const mrr = await env.CONTROL.prepare(
          `SELECT COALESCE(SUM(amount_cents), 0) AS cashed,
                  COUNT(DISTINCT org_id) AS clubs
             FROM org_invoices
            WHERE paid_at IS NOT NULL
              AND strftime('%Y-%m', paid_at) = strftime('%Y-%m','now')`,
        ).first<{ cashed: number; clubs: number }>()

        const years = await env.CONTROL.prepare(
          `SELECT DISTINCT CAST(strftime('%Y', period_start) AS INTEGER) AS y
             FROM org_invoices ORDER BY y DESC`,
        ).all<{ y: number }>()

        const chart = Array.from({ length: 12 }, (_, m) => {
          const row = byMonth.results.find(r => r.m === m)
          return { month: m, billed: row?.billed ?? 0, paid: row?.paid ?? 0 }
        })

        return json({
          year,
          month,
          years: [...new Set([new Date().getUTCFullYear(), ...years.results.map(r => r.y)])]
            .filter(Number.isFinite).sort((a, b) => b - a),
          clubs: clubs.results.map(row => {
            const c = row as Record<string, unknown>
            return { ...c, theme: readTheme(c.theme as string | null) }
          }),
          invoices: invoices.results,
          chart,
          // Revenu de la plateforme : ce qui est reellement rentre sur le mois
          // en cours, et les cumuls de l'annee retenue. Derive des memes
          // echeances que le graphique — aucune table d'agregats a
          // resynchroniser, donc aucun ecart possible entre les deux.
          mrr: {
            currentMonthCents: mrr?.cashed ?? 0,
            payingClubs: mrr?.clubs ?? 0,
            billedYearCents: chart.reduce((s, m) => s + m.billed, 0),
            cashedYearCents: chart.reduce((s, m) => s + m.paid, 0),
          },
          bankDetails: bank?.value ?? null,
          today: isoSeconds(new Date()).slice(0, 10),
        })
      }

      const billingRoute = path.match(/^\/api\/admin\/billing\/([^/]+)$/)
      if (billingRoute && method === 'PUT') {
        if (!principal.isPlatformAdmin) return fail(403, 'Reserve a la plateforme')
        const orgId = billingRoute[1]!
        const known = await env.CONTROL.prepare('SELECT 1 FROM organizations WHERE id = ?')
          .bind(orgId).first()
        if (!known) return fail(404, 'Club inconnu')

        const body = await readJson(request)
        const price = Number(body.priceCents)
        if (!Number.isFinite(price) || price < 0 || price > 100_000_000) {
          return fail(400, 'Montant invalide')
        }
        const cycle = Number(body.cycleMonths)
        if (!Number.isInteger(cycle) || cycle < 1 || cycle > 24) {
          return fail(400, 'Le cycle doit aller de 1 a 24 mois')
        }

        await env.CONTROL.prepare(
          `INSERT INTO org_billing (org_id, price_cents, cycle_months, phone, started_at, expires_at, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(org_id) DO UPDATE SET
             price_cents = excluded.price_cents, cycle_months = excluded.cycle_months,
             phone = excluded.phone, started_at = excluded.started_at,
             expires_at = excluded.expires_at, notes = excluded.notes,
             updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
        ).bind(
          orgId, Math.round(price), cycle,
          phoneDigits(body.phone), dateOnly(body.startedAt, 'startedAt'),
          dateOnly(body.expiresAt, 'expiresAt'), optional(body.notes, 500),
        ).run()
        return json({ ok: true })
      }

      const invoiceCreate = path.match(/^\/api\/admin\/billing\/([^/]+)\/invoices$/)
      if (invoiceCreate && method === 'POST') {
        if (!principal.isPlatformAdmin) return fail(403, 'Reserve a la plateforme')
        const orgId = invoiceCreate[1]!
        const billing = await env.CONTROL.prepare(
          'SELECT price_cents, cycle_months, expires_at FROM org_billing WHERE org_id = ?',
        ).bind(orgId).first<{ price_cents: number; cycle_months: number; expires_at: string | null }>()
        if (!billing) return fail(400, 'Definissez d abord le tarif de ce club')

        const body = await readJson(request)
        // La periode enchaine sur la precedente par defaut : c'est le cas
        // courant, et retaper deux dates a chaque echeance invite a l'erreur.
        const start = dateOnly(body.periodStart, 'periodStart')
          ?? nextDay(billing.expires_at) ?? isoSeconds(new Date()).slice(0, 10)
        const end = dateOnly(body.periodEnd, 'periodEnd') ?? addMonths(start, billing.cycle_months)
        if (end <= start) return fail(400, 'La periode se termine avant de commencer')

        const amount = body.amountCents === undefined
          ? billing.price_cents
          : Number(body.amountCents)
        if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) {
          return fail(400, 'Montant invalide')
        }

        const id = newId()
        await env.CONTROL.prepare(
          `INSERT INTO org_invoices (id, org_id, period_start, period_end, amount_cents,
                                     due_date, note, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, orgId, start, end, Math.round(amount),
               dateOnly(body.dueDate, 'dueDate') ?? start,
               optional(body.note, 300), principal.userId).run()
        return json({ id }, { status: 201 })
      }

      /**
       * Renouvellement en un geste.
       *
       * La periode enchaine sur la couverture precedente — sauf si cet
       * enchainement se terminerait encore dans le passe. Un club couvert
       * jusqu'au 26 juillet renouvele le 13 aout recevrait sinon une periode
       * du 27 juillet au 27 aout : elle couvre bien aujourd'hui. Mais couvert
       * jusqu'en mars, il recevrait une periode qui expire en avril, donc un
       * renouvellement qui ne renouvelle rien. Dans ce cas on repart
       * d'aujourd'hui plutot que de facturer en silence les cinq cycles
       * manquants.
       */
      /**
       * Arbitrage d'un justificatif.
       *
       * Accepter marque l'echeance payee et avance la couverture ; refuser
       * laisse l'echeance ouverte avec un motif, pour que le club sache quoi
       * corriger plutot que de redeposer le meme fichier.
       */
      const proofReview = path.match(/^\/api\/admin\/proofs\/([^/]+)\/(accept|reject)$/)
      if (proofReview && method === 'POST') {
        if (!principal.isPlatformAdmin) return fail(403, 'Reserve a la plateforme')
        const invoiceId = proofReview[1]!
        const accept = proofReview[2] === 'accept'

        const proof = await env.CONTROL.prepare(
          'SELECT org_id FROM org_invoice_proofs WHERE invoice_id = ?',
        ).bind(invoiceId).first<{ org_id: string }>()
        if (!proof) return fail(404, 'Justificatif inconnu')

        const body = await readJson(request).catch(() => ({} as Record<string, unknown>))

        await env.CONTROL.prepare(
          `UPDATE org_invoice_proofs
              SET status = ?, reject_reason = ?,
                  reviewed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), reviewed_by = ?
            WHERE invoice_id = ?`,
        ).bind(accept ? 'accepted' : 'rejected',
               accept ? null : optional(body.reason, 300), principal.userId, invoiceId).run()

        if (accept) {
          await env.CONTROL.prepare(
            "UPDATE org_invoices SET paid_at = date('now'), method = 'virement' WHERE id = ?",
          ).bind(invoiceId).run()
          await recomputeExpiry(env, proof.org_id)
        }

        await env.CONTROL.prepare(
          "INSERT INTO platform_audit (actor_id, action, detail, ip) VALUES (?, ?, ?, ?)",
        ).bind(principal.userId, accept ? 'proof_accept' : 'proof_reject',
               JSON.stringify({ invoiceId, orgId: proof.org_id }), ip).run()

        return json({ ok: true })
      }

      // Justificatif servi par le Worker : la cle R2 ne sort jamais, et
      // l'acces est refuse a qui n'est pas de la plateforme.
      const proofFile = path.match(/^\/api\/admin\/proofs\/([^/]+)\/file$/)
      if (proofFile && method === 'GET') {
        if (!principal.isPlatformAdmin) return fail(403, 'Reserve a la plateforme')
        const row = await env.CONTROL.prepare(
          'SELECT file_key FROM org_invoice_proofs WHERE invoice_id = ?',
        ).bind(proofFile[1]!).first<{ file_key: string | null }>()
        if (!row?.file_key) return fail(404, 'Aucun fichier')
        const object = await env.MEDIA.get(row.file_key)
        if (!object) return fail(404, 'Fichier introuvable')
        return new Response(object.body, {
          headers: {
            'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
            'Cache-Control': 'private, max-age=60',
            // Un justificatif est un document, pas une page : servi en
            // pieces jointes il ne peut pas s'executer dans notre origine.
            'Content-Disposition': 'inline',
            'X-Content-Type-Options': 'nosniff',
          },
        })
      }

      /**
       * Note qu'une relance vient d'etre envoyee.
       *
       * Le message part par WhatsApp, hors de notre portee : on n'enregistre
       * donc pas un envoi, on enregistre le fait que l'exploitant a ouvert la
       * conversation. C'est suffisant pour ne pas relancer le meme club trois
       * fois dans la journee, et honnete sur ce que l'on sait reellement.
       */
      const reminderRoute = path.match(/^\/api\/admin\/invoices\/([^/]+)\/reminder$/)
      if (reminderRoute && method === 'POST') {
        if (!principal.isPlatformAdmin) return fail(403, 'Reserve a la plateforme')
        const invoiceId = reminderRoute[1]!
        const known = await env.CONTROL.prepare('SELECT 1 FROM org_invoices WHERE id = ?')
          .bind(invoiceId).first()
        if (!known) return fail(404, 'Echeance inconnue')

        const body = await readJson(request).catch(() => ({} as Record<string, unknown>))
        await env.CONTROL.prepare(
          `INSERT INTO org_invoice_reminders (invoice_id, last_reminder_by, channel)
           VALUES (?, ?, ?)
           ON CONFLICT(invoice_id) DO UPDATE SET
             last_reminder_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
             reminder_count = org_invoice_reminders.reminder_count + 1,
             last_reminder_by = excluded.last_reminder_by,
             channel = excluded.channel`,
        ).bind(invoiceId, principal.userId, optional(body.channel, 20) ?? 'whatsapp').run()

        const row = await env.CONTROL.prepare(
          'SELECT last_reminder_at, reminder_count FROM org_invoice_reminders WHERE invoice_id = ?',
        ).bind(invoiceId).first()
        return json(row)
      }

      // Coordonnees bancaires montrees aux clubs sur leur page d'abonnement.
      if (path === '/api/admin/bank-details' && method === 'PUT') {
        if (!principal.isPlatformAdmin) return fail(403, 'Reserve a la plateforme')
        const body = await readJson(request)
        const value = optional(body.value, 2000) ?? ''
        await env.CONTROL.prepare(
          `INSERT INTO platform_settings (key, value) VALUES ('bank_details', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value,
             updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
        ).bind(value).run()
        return json({ ok: true })
      }

      const billingRenew = path.match(/^\/api\/admin\/billing\/([^/]+)\/renew$/)
      if (billingRenew && method === 'POST') {
        if (!principal.isPlatformAdmin) return fail(403, 'Reserve a la plateforme')
        const orgId = billingRenew[1]!
        const billing = await env.CONTROL.prepare(
          'SELECT price_cents, cycle_months, expires_at FROM org_billing WHERE org_id = ?',
        ).bind(orgId).first<{ price_cents: number; cycle_months: number; expires_at: string | null }>()
        if (!billing) return fail(400, 'Definissez d abord le tarif de ce club')

        const today = isoSeconds(new Date()).slice(0, 10)
        let start = nextDay(billing.expires_at) ?? today
        let end = addMonths(start, billing.cycle_months)
        let gapDays = 0
        if (end <= today) {
          gapDays = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000)
          start = today
          end = addMonths(start, billing.cycle_months)
        }

        const body = await readJson(request).catch(() => ({} as Record<string, unknown>))
        const id = newId()
        await env.CONTROL.prepare(
          `INSERT INTO org_invoices (id, org_id, period_start, period_end, amount_cents,
                                     due_date, note, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, orgId, start, end, billing.price_cents, start,
               gapDays > 0 ? `Renouvellement, ${gapDays} j non factures` : null,
               principal.userId).run()

        // Encaisse dans la foulee quand on le demande : le cas courant est un
        // club qui paie au moment ou on cree l'echeance.
        if (body.markPaid === true) {
          await env.CONTROL.prepare(
            "UPDATE org_invoices SET paid_at = date('now'), method = ? WHERE id = ?",
          ).bind(optional(body.method, 40), id).run()
          await recomputeExpiry(env, orgId)
        }

        return json({ id, periodStart: start, periodEnd: end, gapDays,
                      amountCents: billing.price_cents }, { status: 201 })
      }

      const invoicePaid = path.match(/^\/api\/admin\/invoices\/([^/]+)\/paid$/)
      if (invoicePaid && (method === 'POST' || method === 'DELETE')) {
        if (!principal.isPlatformAdmin) return fail(403, 'Reserve a la plateforme')
        const id = invoicePaid[1]!
        const invoice = await env.CONTROL.prepare(
          'SELECT org_id, period_end FROM org_invoices WHERE id = ?',
        ).bind(id).first<{ org_id: string; period_end: string }>()
        if (!invoice) return fail(404, 'Echeance inconnue')

        if (method === 'DELETE') {
          await env.CONTROL.prepare('UPDATE org_invoices SET paid_at = NULL, method = NULL WHERE id = ?')
            .bind(id).run()
          await recomputeExpiry(env, invoice.org_id)
          return json({ ok: true })
        }

        const body = await readJson(request)
        await env.CONTROL.prepare(
          `UPDATE org_invoices SET paid_at = COALESCE(?, date('now')), method = ? WHERE id = ?`,
        ).bind(dateOnly(body.paidAt, 'paidAt'), optional(body.method, 40), id).run()
        await recomputeExpiry(env, invoice.org_id)
        await env.CONTROL.prepare(
          "INSERT INTO platform_audit (actor_id, action, detail, ip) VALUES (?, 'invoice_paid', ?, ?)",
        ).bind(principal.userId, JSON.stringify({ id, orgId: invoice.org_id }), ip).run()
        return json({ ok: true })
      }

      const invoiceDelete = path.match(/^\/api\/admin\/invoices\/([^/]+)$/)
      if (invoiceDelete && method === 'DELETE') {
        if (!principal.isPlatformAdmin) return fail(403, 'Reserve a la plateforme')
        const id = invoiceDelete[1]!
        const invoice = await env.CONTROL.prepare('SELECT org_id FROM org_invoices WHERE id = ?')
          .bind(id).first<{ org_id: string }>()
        if (!invoice) return fail(404, 'Echeance inconnue')
        await env.CONTROL.prepare('DELETE FROM org_invoices WHERE id = ?').bind(id).run()
        await recomputeExpiry(env, invoice.org_id)
        return json({ ok: true })
      }

      // Liste noire d'adresses.
      if (path === '/api/admin/blocklist' && method === 'POST') {
        if (!principal.isPlatformAdmin) return fail(403, 'Reserve a la plateforme')
        const body = await readJson(request)
        const target = str(body.ip, 'ip', 45)

        // Se bloquer soi-meme fermerait la porte de l'exterieur, sans moyen
        // de revenir la rouvrir.
        if (ip && target === ip) return fail(400, 'Vous bloqueriez votre propre adresse')

        await env.CONTROL.prepare(
          `INSERT INTO ip_blocklist (ip, reason, created_by) VALUES (?, ?, ?)
           ON CONFLICT(ip) DO UPDATE SET reason = excluded.reason`,
        ).bind(target, optional(body.reason, 200), principal.userId).run()

        // Bloquer sans couper les sessions en cours laisserait l'intrus
        // connecte : le blocage ne vaut que pour la prochaine connexion.
        await env.CONTROL.prepare('DELETE FROM sessions WHERE ip = ?').bind(target).run()
        await env.CONTROL.prepare(
          "INSERT INTO platform_audit (actor_id, action, detail, ip) VALUES (?, 'ip_block', ?, ?)",
        ).bind(principal.userId, JSON.stringify({ ip: target }), ip).run()
        return json({ ip: target }, { status: 201 })
      }

      const unblockRoute = path.match(/^\/api\/admin\/blocklist\/(.+)$/)
      if (unblockRoute && method === 'DELETE') {
        if (!principal.isPlatformAdmin) return fail(403, 'Reserve a la plateforme')
        const target = decodeURIComponent(unblockRoute[1]!)
        await env.CONTROL.prepare('DELETE FROM ip_blocklist WHERE ip = ?').bind(target).run()
        await env.CONTROL.prepare(
          "INSERT INTO platform_audit (actor_id, action, detail, ip) VALUES (?, 'ip_unblock', ?, ?)",
        ).bind(principal.userId, JSON.stringify({ ip: target }), ip).run()
        return json({ ok: true })
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

    await issueDueInvoices(env)
  },
} satisfies ExportedHandler<Env>

/**
 * Emet l'echeance suivante des qu'un abonnement approche de sa fin.
 *
 * C'est la part automatisable du renouvellement : la facture se cree seule,
 * sept jours avant l'echeance, et apparait aussitot dans « A traiter » avec
 * son lien WhatsApp pret. L'ENVOI, lui, reste manuel — l'API WhatsApp
 * Business exige un compte verifie, des modeles approuves et facture chaque
 * message ; promettre un envoi automatique sans elle serait mentir.
 *
 * Le garde-fou est la clause NOT EXISTS : une echeance couvrant deja la
 * suite empeche d'en creer une seconde. Sans elle, le cron toutes les cinq
 * minutes facturerait le meme club deux cent quatre-vingt-huit fois par jour.
 */
async function issueDueInvoices(env: Env): Promise<void> {
  const { results } = await env.CONTROL.prepare(
    `SELECT b.org_id, b.price_cents, b.cycle_months, b.expires_at
       FROM org_billing b
       JOIN organizations o ON o.id = b.org_id
      WHERE o.status = 'active'
        AND b.price_cents > 0
        AND b.expires_at IS NOT NULL
        AND date(b.expires_at) <= date('now', '+7 days')
        AND NOT EXISTS (
              SELECT 1 FROM org_invoices i
               WHERE i.org_id = b.org_id AND date(i.period_end) > date(b.expires_at)
            )
      LIMIT 50`,
  ).all<{ org_id: string; price_cents: number; cycle_months: number; expires_at: string }>()

  const today = isoSeconds(new Date()).slice(0, 10)

  for (const row of results) {
    let start = nextDay(row.expires_at) ?? today
    let end = addMonths(start, row.cycle_months)
    if (end <= today) { start = today; end = addMonths(start, row.cycle_months) }

    await env.CONTROL.prepare(
      `INSERT INTO org_invoices (id, org_id, period_start, period_end, amount_cents, due_date, note)
       VALUES (?, ?, ?, ?, ?, ?, 'Emise automatiquement')`,
    ).bind(newId(), row.org_id, start, end, row.price_cents, start).run()
  }
}

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
  // Bloquer la connexion sans bloquer l'inscription laisserait l'attaquant
  // se creer un compte neuf depuis la meme adresse.
  if (await ipBlocked(env, ip)) return fail(403, 'Acces refuse depuis cette adresse')

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
// Plus large que le logo : une banniere pleine largeur est une vraie image.
const MAX_BANNER_BYTES = 4 * 1024 * 1024

async function brandingOf(env: Env, orgId: string) {
  const row = await env.CONTROL.prepare(
    `SELECT o.name, o.name_ar, o.logo_key, o.theme, o.locale, b.file_key AS banner_key
       FROM organizations o
       LEFT JOIN org_banners b ON b.org_id = o.id
      WHERE o.id = ?`,
  ).bind(orgId).first<{
    name: string; name_ar: string | null; logo_key: string | null
    theme: string | null; locale: string; banner_key: string | null
  }>()
  if (!row) throw new HttpError(404, 'Club inconnu')

  return {
    name: row.name,
    nameAr: row.name_ar,
    // On expose l'URL du proxy, jamais la cle brute ni une URL R2 publique.
    logoUrl: row.logo_key ? `/api/branding/logo/${encodeURIComponent(row.logo_key)}` : null,
    bannerUrl: row.banner_key ? `/api/branding/logo/${encodeURIComponent(row.banner_key)}` : null,
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
  // Avant meme de lire le corps : une adresse bloquee n'a rien a nous dire.
  if (await ipBlocked(env, ip)) return fail(403, 'Acces refuse depuis cette adresse')

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
