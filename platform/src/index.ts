import type { Env } from './env'
import { ClubDatabase } from './club/club-database'
import { hashPassword, verifyPassword, newId } from './auth/crypto'
import {
  createSession, resolveSession, destroySession, readSessionCookie,
  sessionCookie, clearedCookie, isoSeconds, type Principal,
} from './auth/session'

export { ClubDatabase }

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
  if (!principal.orgId) throw new HttpError(403, 'Aucun club actif pour ce compte')
  return env.CLUB.get(env.CLUB.idFromName(principal.orgId))
}

/** Acces superadmin a un club donne. Trace, car il franchit la frontiere. */
async function clubAsPlatformAdmin(
  env: Env, principal: Principal, orgId: string, action: string, ip: string | null,
): Promise<DurableObjectStub<ClubDatabase>> {
  if (!principal.isPlatformAdmin) throw new HttpError(403, 'Reserve a la plateforme')
  await env.CONTROL.prepare(
    'INSERT INTO platform_audit (actor_id, action, org_id, ip) VALUES (?, ?, ?, ?)',
  ).bind(principal.userId, action, orgId, ip).run()
  return env.CLUB.get(env.CLUB.idFromName(orgId))
}

// Roles ----------------------------------------------------------------------

const RANK = { viewer: 0, staff: 1, admin: 2, owner: 3 } as const

function atLeast(principal: Principal, min: keyof typeof RANK): void {
  if (!principal.role) throw new HttpError(403, 'Aucun club actif pour ce compte')
  if (RANK[principal.role] < RANK[min]) throw new HttpError(403, 'Droits insuffisants')
}

// Anti-force brute -----------------------------------------------------------

const MAX_ATTEMPTS = 8
const WINDOW_MINUTES = 15

async function throttled(env: Env, identifier: string, ip: string | null): Promise<boolean> {
  const since = isoSeconds(new Date(Date.now() - WINDOW_MINUTES * 60_000))
  const row = await env.CONTROL.prepare(
    `SELECT COUNT(*) AS n FROM login_attempts
      WHERE succeeded = 0 AND attempted_at > ?
        AND (identifier = ? OR (ip IS NOT NULL AND ip = ?))`,
  ).bind(since, identifier, ip).first<{ n: number }>()
  return (row?.n ?? 0) >= MAX_ATTEMPTS
}

async function recordAttempt(env: Env, identifier: string, ip: string | null, ok: boolean) {
  await env.CONTROL.prepare(
    'INSERT INTO login_attempts (identifier, ip, succeeded) VALUES (?, ?, ?)',
  ).bind(identifier, ip, ok ? 1 : 0).run()
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

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object') throw new Error('not an object')
    return body as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'Corps de requete invalide')
  }
}

// Routeur --------------------------------------------------------------------

export default {
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
        return json({ ok: true }, { headers: { 'Set-Cookie': clearedCookie() } })
      }

      if (path === '/api/me' && method === 'GET') {
        return json({
          user: { id: principal.userId, name: principal.name, email: principal.email },
          isPlatformAdmin: principal.isPlatformAdmin,
          org: principal.orgId ? { id: principal.orgId, role: principal.role } : null,
        })
      }

      if (path === '/api/members' && method === 'GET') {
        atLeast(principal, 'viewer')
        const club = clubOf(env, principal)
        const members = await club.listMembers({
          limit: Number(url.searchParams.get('limit') ?? 50),
          offset: Number(url.searchParams.get('offset') ?? 0),
          search: url.searchParams.get('q') ?? undefined,
        })
        return json({ members })
      }

      if (path === '/api/members' && method === 'POST') {
        atLeast(principal, 'staff')
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

      const statsRoute = path.match(/^\/api\/admin\/clubs\/([^/]+)\/stats$/)
      if (statsRoute && method === 'GET') {
        const orgId = statsRoute[1]!
        const club = await clubAsPlatformAdmin(env, principal, orgId, 'read_club_stats', ip)
        return json({ orgId, stats: await club.stats() })
      }

      return fail(404, 'Route inconnue')
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.message)
      console.error('unhandled', e)
      // Aucun detail interne renvoye au client.
      return fail(500, 'Erreur interne')
    }
  },
} satisfies ExportedHandler<Env>

// Inscription ----------------------------------------------------------------

async function signup(request: Request, env: Env, ip: string | null): Promise<Response> {
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
  if (existing) throw new HttpError(409, 'Un compte existe deja pour cette adresse')

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

  // Cree la base du club a la premiere utilisation, puis l'amorce.
  const club = env.CLUB.get(env.CLUB.idFromName(orgId))
  await club.seed({ branchName: 'Principale', disciplineName: 'Karate', hasGrading: true })

  const token = await createSession(env, userId, orgId, {
    ip, userAgent: request.headers.get('User-Agent'),
  })

  return json(
    { orgId, userId, slug },
    { status: 201, headers: { 'Set-Cookie': sessionCookie(token) } },
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
    return fail(401, 'Identifiants invalides')
  }

  const membership = await env.CONTROL.prepare(
    `SELECT org_id FROM memberships
      WHERE user_id = ? AND status = 'active'
      ORDER BY created_at LIMIT 1`,
  ).bind(user.id).first<{ org_id: string }>()

  await recordAttempt(env, email, ip, true)
  await env.CONTROL.prepare(
    "UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?",
  ).bind(user.id).run()

  const token = await createSession(env, user.id, membership?.org_id ?? null, {
    ip, userAgent: request.headers.get('User-Agent'),
  })

  return json(
    { userId: user.id, orgId: membership?.org_id ?? null },
    { headers: { 'Set-Cookie': sessionCookie(token) } },
  )
}
