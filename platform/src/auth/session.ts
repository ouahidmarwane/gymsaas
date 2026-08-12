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
            u.name, u.email, u.is_platform_admin, u.status AS user_status,
            m.role, m.branch_id, m.discipline_id, m.status AS membership_status,
            o.status AS org_status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN memberships m ON m.user_id = s.user_id AND m.org_id = s.org_id
       LEFT JOIN organizations o ON o.id = s.org_id
      WHERE s.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<{
      user_id: string
      org_id: string | null
      expires_at: string
      last_seen_at: string
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

  return {
    userId: row.user_id,
    name: row.name,
    email: row.email,
    isPlatformAdmin,
    orgId: row.org_id,
    role: hasMembership ? (row.role as Principal['role']) : null,
    branchId: row.branch_id,
    disciplineId: row.discipline_id,
  }
}

export async function destroySession(env: Env, token: string): Promise<void> {
  await env.CONTROL.prepare('DELETE FROM sessions WHERE token_hash = ?')
    .bind(await hashToken(token))
    .run()
}

export async function destroyAllSessionsForUser(env: Env, userId: string): Promise<void> {
  await env.CONTROL.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run()
}

export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim()
  }
  return null
}

/**
 * Le préfixe __Host- impose Secure, Path=/ et l'absence de Domain : le cookie
 * ne peut donc pas être posé par un sous-domaine voisin. SameSite=Lax bloque
 * l'envoi en requête inter-site tout en préservant la navigation normale.
 */
export function sessionCookie(token: string): string {
  const maxAge = SESSION_TTL_HOURS * 3600
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}

