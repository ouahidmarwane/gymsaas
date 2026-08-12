import type { Env } from './env'
// Type seulement : importer la classe comme valeur entrainerait le module
// 'cloudflare:workers' dans le bundle de l'API, qui echoue a se resoudre hors
// de workerd. La classe est exportee par worker.ts, la ou elle doit l'etre.
import type { ClubDatabase } from './club/club-database'
import { hashPassword, verifyPassword, newId } from './auth/crypto'
import {
  createSession, resolveSession, destroySession, readSessionCookie,
  sessionCookie, clearedCookie, isoSeconds, activeScope,
  beginSupport, allowSupportWrite, endSupport, type Principal,
} from './auth/session'
import { parseLayout, defaultLayout, LayoutError, CARD_REGISTRY, GRID_COLUMNS } from './club/layout'
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
    if (write && !principal.supportWrite) {
      throw new HttpError(403, 'Mode support en lecture seule : activez l ecriture d abord')
    }
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
        return json({ ok: true }, { headers: { 'Set-Cookie': clearedCookie() } })
      }

      if (path === '/api/me' && method === 'GET') {
        const scope = activeScope(principal)
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
        return json({ configured: await clubOf(env, principal).isConfigured() })
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

        const bytes = await request.arrayBuffer()
        if (bytes.byteLength === 0) throw new HttpError(400, 'Fichier vide')
        if (bytes.byteLength > MAX_LOGO_BYTES) {
          throw new HttpError(413, 'Logo trop volumineux : 2 Mo maximum')
        }

        const key = logoKey(orgId, ext)
        await env.MEDIA.put(key, bytes, { httpMetadata: { contentType } })
        await env.CONTROL.prepare(
          `UPDATE organizations SET logo_key = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
            WHERE id = ?`,
        ).bind(key, orgId).run()

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
          },
        })
      }

      // Disposition du tableau de bord.

      // Chiffres du club de l'appelant. En mode support, ce sont ceux du
      // club visite : la portee suit la session, comme partout ailleurs.
      if (path === '/api/dashboard/stats' && method === 'GET') {
        atLeast(principal, 'viewer')
        return json({ stats: await clubOf(env, principal).stats() })
      }

      if (path === '/api/dashboard/layout' && method === 'GET') {
        atLeast(principal, 'viewer')
        const stored = await clubOf(env, principal).getSetting('dashboard_layout')
        // Une disposition enregistree est revalidee a la lecture : si le
        // registre des cartes a change depuis, elle est ramenee a un etat
        // coherent au lieu de casser la page.
        let layout
        try {
          layout = stored ? parseLayout(stored) : defaultLayout()
        } catch {
          layout = defaultLayout()
        }
        return json({ layout, columns: GRID_COLUMNS, cards: CARD_REGISTRY })
      }

      if (path === '/api/dashboard/layout' && method === 'PUT') {
        atLeast(principal, 'admin', true)
        const body = await readJson(request)
        const layout = parseLayout(body.layout)
        await clubOf(env, principal).setSetting('dashboard_layout', layout)
        if (activeScope(principal).mode === 'support') {
          await auditSupport(env, principal, 'support_write_layout', { cards: layout.length }, ip)
        }
        return json({ layout })
      }

      if (path === '/api/dashboard/layout' && method === 'DELETE') {
        atLeast(principal, 'admin', true)
        await clubOf(env, principal).setSetting('dashboard_layout', defaultLayout())
        return json({ layout: defaultLayout() })
      }

      // Le club voit qui, cote plateforme, a ouvert sa base et quand.
      // Question de confiance, et de conformite CNDP.
      if (path === '/api/support-log' && method === 'GET') {
        atLeast(principal, 'admin')
        const { results } = await env.CONTROL.prepare(
          `SELECT a.action, a.detail, a.created_at, u.name AS actor_name
             FROM platform_audit a
             LEFT JOIN users u ON u.id = a.actor_id
            WHERE a.org_id = ?
            ORDER BY a.created_at DESC
            LIMIT 100`,
        ).bind(principal.orgId).all()
        return json({ entries: results })
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
        const { results } = await env.CONTROL.prepare(
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

        return json({
          clubs: results.map(c => ({
            ...c,
            theme: readTheme((c.theme as string | null) ?? null),
          })),
          serverTime: isoSeconds(new Date()),
        })
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

        const expiresAt = await beginSupport(env, token, orgId)
        await env.CONTROL.prepare(
          "INSERT INTO platform_audit (actor_id, action, org_id, detail, ip) VALUES (?, 'support_enter', ?, ?, ?)",
        ).bind(principal.userId, orgId, JSON.stringify({ expiresAt }), ip).run()

        return json({ orgId, name: org.name, mode: 'support', canWrite: false, expiresAt })
      }

      if (path === '/api/admin/support/write' && method === 'POST') {
        if (!principal.supportOrgId) return fail(400, 'Aucune session de support active')
        if (!token) return fail(401, 'Session absente')
        const expiresAt = await allowSupportWrite(env, token)
        await auditSupport(env, principal, 'support_write_enabled', { expiresAt }, ip)
        return json({ mode: 'support', canWrite: true, expiresAt })
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
    const { results } = await env.CONTROL.prepare(
      "SELECT id FROM organizations WHERE status = 'active'",
    ).all<{ id: string }>()

    for (const { id } of results) {
      try {
        const stats = await env.CLUB.get(env.CLUB.idFromName(id)).stats()
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
        ).bind(id, stats.memberCount, stats.activeSubs, stats.revenueMonthCents, stats.lastActivityAt).run()
      } catch (e) {
        console.error(`stats refresh failed for ${id}`, e)
      }
    }
  },
} satisfies ExportedHandler<Env>

export const handleApi = (request: Request, env: Env) => api.fetch(request, env)
export const refreshAllStats = (env: Env) =>
  api.scheduled(undefined as unknown as ScheduledController, env)

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

  // Le club demarre vide : ni succursale, ni discipline. On ne devine pas
  // quel sport il pratique ni combien de salles il a, on le lui demande.
  // Le Durable Object sera cree a sa premiere utilisation.

  const token = await createSession(env, userId, orgId, {
    ip, userAgent: request.headers.get('User-Agent'),
  })

  return json(
    { orgId, userId, slug },
    { status: 201, headers: { 'Set-Cookie': sessionCookie(token) } },
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
