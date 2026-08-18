'use client'

// Acces a l'API depuis le navigateur.
//
// Le cookie de session est HttpOnly : rien a joindre a la main, il suffit de
// ne pas oublier `credentials: 'same-origin'`.

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    // Panne reseau : distinguee d'un refus du serveur, parce que la conduite
    // a tenir n'est pas la meme pour l'utilisateur.
    throw new ApiError(0, 'Connexion indisponible. Verifiez votre reseau.')
  }

  const isJson = (res.headers.get('content-type') ?? '').includes('json')
  const payload: unknown = isJson ? await res.json().catch(() => null) : null

  if (!res.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload
      ? String((payload as { error: unknown }).error)
      : `Erreur ${res.status}`
    throw new ApiError(res.status, message)
  }
  return payload as T
}

export const api = {
  get:  <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put:  <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  // PATCH pour une modification partielle : le formulaire membre n'envoie
  // que ce qu'il connait, et COALESCE cote base garde le reste.
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  // Un DELETE peut porter un corps : la suppression d'un club exige que le
  // slug y soit repete, faute de quoi un appel direct contournerait la
  // confirmation de l'interface.
  del:  <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
}

/**
 * Envoi d'un fichier brut.
 *
 * Le corps porte le fichier tel quel, pas un multipart : le serveur fabrique
 * lui-meme la cle de stockage, et un enrobage multipart lui imposerait un
 * analyseur de format supplementaire pour n'apporter aucun renseignement
 * qu'on ne sache deja.
 */
export async function upload<T>(method: 'PUT' | 'POST', path: string, file: File): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
  } catch {
    throw new ApiError(0, 'Connexion indisponible. Verifiez votre reseau.')
  }
  const payload: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(res.status,
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? String((payload as { error: unknown }).error) : 'Envoi impossible')
  }
  return payload as T
}

// Types partages avec l'API ---------------------------------------------

import type { SkinKey } from '@/src/club/branding'

export interface Theme { accent: string; mode: 'light' | 'dark' | 'system'; skin: SkinKey }

export interface Branding {
  name: string
  nameAr: string | null
  logoUrl: string | null
  /** Banniere du club, posee par la plateforme. */
  bannerUrl: string | null
  theme: Theme
  locale: string
}

/** Ce que le club pratique reellement, pas une preference d'affichage. */
export interface Capabilities {
  configured: boolean
  branchCount: number
  disciplineCount: number
  hasGrading: boolean
}

export interface Me {
  user: { id: string; name: string; email: string }
  isPlatformAdmin: boolean
  org: { id: string; role: string } | null
  scope: { mode: 'member' | 'support'; orgId: string | null; canWrite: boolean }
  branding: Branding | null
  capabilities: Capabilities | null
}

export interface ClubRow {
  id: string
  slug: string
  name: string
  logo_key: string | null
  theme: Theme
  plan: string
  status: string
  created_at: string
  trial_ends_at: string | null
  member_count: number | null
  active_subs: number | null
  revenue_month_cents: number | null
  last_activity_at: string | null
  refreshed_at: string | null
  staff_count: number
}

export interface CardPlacement {
  id: string
  x: number
  y: number
  w: number
  h: number
  visible: boolean
}

export interface CardSpec {
  minW: number; maxW: number; minH: number; maxH: number
  label: string
  group: string
  needsGrading?: boolean
}
