import type { Env } from '../env'
import { newSessionToken, hashToken } from './crypto'

export const SESSION_COOKIE = '__Host-gf_session'
const SESSION_TTL_HOURS = 12
const IDLE_TIMEOUT_MINUTES = 60

/**
 * ISO-8601 UTC à la seconde — exactement le format produit par
 * strftime('%Y-%m-%dT%H:%M:%SZ') côté SQLite.
 *
 * Les deux côtés doivent produire la même chaîne, sinon les comparaisons
 * lexicographiques en SQL se décalent : « ...00.000Z » trie avant
 * « ...00Z », le point précédant le Z dans l'ordre des caractères.
 */
export function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * Identité résolue d'une requête. `orgId` est le SEUL club que cette requête
 * pourra ouvrir : il vient de la session côté serveur, jamais d'un paramètre
 * fourni par le client.
 */
export interface Principal {
  userId: string
  name: string
  email: string
  isPlatformAdmin: boolean
  orgId: string | null
  role: 'owner' | 'admin' | 'staff' | 'viewer' | null
  branchId: string | null
  disciplineId: string | null

  /**
   * Club dans lequel un exploitant de plateforme est entre pour du support.
   * Null hors mode support. Toujours distinct de orgId : on n'usurpe pas
   * l'identite du proprietaire, on greffe une portee temporaire.
   */
  supportOrgId: string | null
  /**
   * Organization recorded on the session even when its support TTL expired.
   * An expired support context must fail closed until the operator explicitly
   * leaves support mode; otherwise expiry would silently restore unrestricted
   * platform mutation authority.
   */
  supportContextOrgId: string | null
  /** Lecture seule tant que ce drapeau n'est pas leve explicitement. */
  supportWrite: boolean
}

export interface DataScope {
  branchId: string | null
  disciplineId: string | null
}

/** Portee metier immuable issue de l'appartenance, jamais de la requete. */
export function dataScope(p: Principal): DataScope {
  // Le support n'usurpe aucune appartenance du club visite. Sa frontiere est
  // le club entier, avec lecture seule/ecriture courte geree separement.
  return p.supportOrgId
    ? { branchId: null, disciplineId: null }
    : { branchId: p.branchId, disciplineId: p.disciplineId }
}

/** Club reellement vise par la requete, et a quel titre. */
export function activeScope(p: Principal): {
  orgId: string | null
  mode: 'member' | 'support'
} {
  if (p.supportOrgId) return { orgId: p.supportOrgId, mode: 'support' }
  return { orgId: p.orgId, mode: 'member' }
}

export async function createSession(
  env: Env,
  userId: string,
  orgId: string | null,
  meta: { ip?: string | null; userAgent?: string | null },
): Promise<string> {
  const token = newSessionToken()
  const tokenHash = await hashToken(token)
  const expires = isoSeconds(new Date(Date.now() + SESSION_TTL_HOURS * 3600_000))

  await env.CONTROL.prepare(
    `INSERT INTO sessions (token_hash, user_id, org_id, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(tokenHash, userId, orgId, expires, meta.ip ?? null, meta.userAgent ?? null)
    .run()

  return token
}

/**
 * Résout la session en identité complète, en une seule requête.
 *
 * La jointure sur memberships est délibérée : révoquer l'accès d'un membre du
 * personnel prend effet à la requête suivante, sans attendre l'expiration de
 * sa session. Un club suspendu cesse pareillement d'être joignable.
 */
export async function resolveSession(env: Env, token: string | null): Promise<Principal | null> {
  if (!token) return null

  const tokenHash = await hashToken(token)
  const row = await env.CONTROL.prepare(
    `SELECT s.user_id, s.org_id, s.expires_at, s.last_seen_at,
            s.support_org_id, s.support_expires_at, s.support_write,
            sw.expires_at AS support_write_expires_at,
            u.name, u.email, u.is_platform_admin, u.status AS user_status,
            m.role, m.branch_id, m.discipline_id, m.status AS membership_status,
            o.status AS org_status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN memberships m ON m.user_id = s.user_id AND m.org_id = s.org_id
       LEFT JOIN organizations o ON o.id = s.org_id
       LEFT JOIN support_write_grants sw ON sw.token_hash = s.token_hash
      WHERE s.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<{
      user_id: string
      org_id: string | null
      expires_at: string
      last_seen_at: string
      support_org_id: string | null
      support_expires_at: string | null
      support_write: number
      support_write_expires_at: string | null
      name: string
      email: string
      is_platform_admin: number
      user_status: string
      role: string | null
      branch_id: string | null
      discipline_id: string | null
      membership_status: string | null
      org_status: string | null
    }>()

  if (!row) return null

  const now = Date.now()

  // Expiration absolue.
  if (Date.parse(row.expires_at) <= now) {
    await destroySession(env, token)
    return null
  }

  // Expiration par inactivité : un poste d'accueil laissé sans surveillance
  // ne doit pas rester ouvert.
  if (now - Date.parse(row.last_seen_at) > IDLE_TIMEOUT_MINUTES * 60_000) {
    await destroySession(env, token)
    return null
  }

  if (row.user_status !== 'active') return null

  const isPlatformAdmin = row.is_platform_admin === 1

  // Un club suspendu n'est plus joignable, sauf pour l'exploitant de la
  // plateforme, qui doit pouvoir intervenir précisément dans ce cas.
  if (row.org_id && row.org_status !== 'active' && !isPlatformAdmin) return null

  // Un compte sans appartenance active n'obtient aucun club, même si sa
  // session en désigne un.
  const hasMembership = row.role !== null && row.membership_status === 'active'
  if (row.org_id && !hasMembership && !isPlatformAdmin) return null

  await env.CONTROL.prepare(
    "UPDATE sessions SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE token_hash = ?",
  )
    .bind(tokenHash)
    .run()

  // Mode support : valable uniquement pour un exploitant de plateforme, et
  // uniquement avant expiration. Perdre le statut plateforme ou depasser le
  // delai retire la portee immediatement, sans avoir a nettoyer la ligne.
  const supportLive =
    isPlatformAdmin &&
    Boolean(row.support_org_id) &&
    Boolean(row.support_expires_at) &&
    Date.parse(row.support_expires_at!) > now

  return {
    userId: row.user_id,
    name: row.name,
    email: row.email,
    isPlatformAdmin,
    orgId: row.org_id,
    role: hasMembership ? (row.role as Principal['role']) : null,
    branchId: row.branch_id,
    disciplineId: row.discipline_id,
    supportOrgId: supportLive ? row.support_org_id : null,
    supportContextOrgId: isPlatformAdmin ? row.support_org_id : null,
    supportWrite: supportLive && row.support_write === 1 &&
      Boolean(row.support_write_expires_at) && Date.parse(row.support_write_expires_at!) > now,
  }
}

const SUPPORT_TTL_MINUTES = 30
const SUPPORT_WRITE_TTL_MINUTES = 5
const STEP_UP_TTL_MINUTES = 10

/**
 * Entre en mode support sur un club.
 *
 * L'ecriture est active d'emblee : l'exploitant de la plateforme intervient
 * generalement pendant que le proprietaire est au telephone, et lui imposer
 * une escalade a chaque geste transforme le depannage en parcours du
 * combattant. La tracabilite reste entiere — chaque ecriture est journalisee
 * et visible par le club — et `readOnly` permet une visite d'observation
 * quand on veut regarder sans risquer de toucher.
 */
export async function beginSupport(
  env: Env, token: string, orgId: string,
): Promise<{ expiresAt: string; canWrite: boolean }> {
  const expires = isoSeconds(new Date(Date.now() + SUPPORT_TTL_MINUTES * 60_000))
  const tokenHash = await hashToken(token)
  await env.CONTROL.batch([
    env.CONTROL.prepare('DELETE FROM support_write_grants WHERE token_hash = ?').bind(tokenHash),
    env.CONTROL.prepare(
    `UPDATE sessions
        SET support_org_id = ?, support_expires_at = ?, support_write = 0
      WHERE token_hash = ?`,
    ).bind(orgId, expires, tokenHash),
  ])
  return { expiresAt: expires, canWrite: false }
}

/** Repasse en ecriture apres une visite en lecture seule. */
export async function allowSupportWrite(env: Env, token: string): Promise<string> {
  const expires = isoSeconds(new Date(Date.now() + SUPPORT_WRITE_TTL_MINUTES * 60_000))
  const tokenHash = await hashToken(token)
  await env.CONTROL.batch([
    env.CONTROL.prepare(
      `INSERT INTO support_write_grants (token_hash, expires_at) VALUES (?, ?)
       ON CONFLICT(token_hash) DO UPDATE SET expires_at = excluded.expires_at,
         created_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
    ).bind(tokenHash, expires),
    env.CONTROL.prepare(
      `UPDATE sessions SET support_write = 1
        WHERE token_hash = ? AND support_org_id IS NOT NULL`,
    ).bind(tokenHash),
  ])
  return expires
}

export async function grantStepUp(env: Env, token: string, userId: string): Promise<string> {
  const tokenHash = await hashToken(token)
  const expires = isoSeconds(new Date(Date.now() + STEP_UP_TTL_MINUTES * 60_000))
  await env.CONTROL.prepare(
    `INSERT INTO privileged_grants (token_hash, user_id, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(token_hash) DO UPDATE SET user_id = excluded.user_id,
       expires_at = excluded.expires_at, created_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
  ).bind(tokenHash, userId, expires).run()
  return expires
}

export async function hasStepUp(env: Env, token: string | null, userId: string): Promise<boolean> {
  if (!token) return false
  const row = await env.CONTROL.prepare(
    `SELECT 1 FROM privileged_grants
      WHERE token_hash = ? AND user_id = ?
        AND expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
  ).bind(await hashToken(token), userId).first()
  return Boolean(row)
}

/** Bascule en observation : on regarde sans pouvoir toucher. */
export async function setSupportReadOnly(env: Env, token: string): Promise<void> {
  const tokenHash = await hashToken(token)
  await env.CONTROL.batch([
    env.CONTROL.prepare('DELETE FROM support_write_grants WHERE token_hash = ?').bind(tokenHash),
    env.CONTROL.prepare(
    `UPDATE sessions SET support_write = 0
      WHERE token_hash = ? AND support_org_id IS NOT NULL`,
    ).bind(tokenHash),
  ])
}

export async function endSupport(env: Env, token: string): Promise<void> {
  const tokenHash = await hashToken(token)
  await env.CONTROL.batch([
    env.CONTROL.prepare('DELETE FROM support_write_grants WHERE token_hash = ?').bind(tokenHash),
    env.CONTROL.prepare(
    `UPDATE sessions
        SET support_org_id = NULL, support_expires_at = NULL, support_write = 0
      WHERE token_hash = ?`,
    ).bind(tokenHash),
  ])
}

export async function destroySession(env: Env, token: string): Promise<void> {
  await env.CONTROL.prepare('DELETE FROM sessions WHERE token_hash = ?')
    .bind(await hashToken(token))
    .run()
}

export async function destroyAllSessionsForUser(env: Env, userId: string): Promise<void> {
  await env.CONTROL.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run()
}

/** Nom sans préfixe, utilisé en développement sur http. */
const SESSION_COOKIE_PLAIN = 'gf_session'

/** Le préfixe __Host- n'est valable qu'avec Secure, donc qu'en https. */
function isSecure(request: Request): boolean {
  return new URL(request.url).protocol === 'https:'
}

function cookieName(request: Request): string {
  return isSecure(request) ? SESSION_COOKIE : SESSION_COOKIE_PLAIN
}

/**
 * Lit le jeton de session.
 *
 * En https, SEUL le nom prefixe est accepte. Accepter aussi `gf_session`
 * annulerait la garantie du prefixe __Host- : un sous-domaine voisin (repris,
 * ou vulnerable a une XSS) peut poser un cookie `Domain=.exemple.ma`, et
 * comme les cookies de meme longueur de chemin partent du plus ancien au plus
 * recent, celui de l'attaquant serait lu en premier — la victime travaillerait
 * dans la session de l'attaquant.
 *
 * Le nom simple ne survit qu'en http, c'est-a-dire en developpement local, ou
 * le prefixe est de toute facon invalide.
 */
export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null

  const jar = new Map<string, string>()
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    if (!jar.has(name)) jar.set(name, part.slice(eq + 1).trim())
  }

  const strict = jar.get(SESSION_COOKIE)
  if (strict) return strict
  return isSecure(request) ? null : (jar.get(SESSION_COOKIE_PLAIN) ?? null)
}

/**
 * En https, le préfixe __Host- impose Secure, Path=/ et l'absence de Domain :
 * le cookie ne peut donc pas être posé par un sous-domaine voisin.
 *
 * En http (développement local), ce préfixe rendrait le cookie invalide et la
 * connexion échouerait silencieusement — d'où le repli sur un nom simple, sans
 * Secure. La production étant toujours en https, elle garde la forme stricte.
 *
 * SameSite=Lax bloque l'envoi en requête inter-site tout en préservant la
 * navigation normale.
 */
export function sessionCookie(request: Request, token: string): string {
  const maxAge = SESSION_TTL_HOURS * 3600
  const secure = isSecure(request) ? ' Secure;' : ''
  return `${cookieName(request)}=${token}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${maxAge}`
}

export function clearedCookie(request: Request): string {
  const secure = isSecure(request) ? ' Secure;' : ''
  return `${cookieName(request)}=; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=0`
}
