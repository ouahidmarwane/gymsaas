// Primitives cryptographiques — Web Crypto uniquement (disponible nativement
// sur Workers, aucune dépendance).

const PBKDF2_ITERATIONS = 210_000 // recommandation OWASP 2023+ pour SHA-256
const SALT_BYTES = 16
const KEY_BITS = 256

const encoder = new TextEncoder()

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS,
  )
  return new Uint8Array(bits)
}

/** Format stocké : pbkdf2$<iterations>$<sel b64>$<clé b64> */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const key = await derive(password, salt, PBKDF2_ITERATIONS)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(key)}`
}

/**
 * Vérifie un mot de passe. Comparaison à temps constant : une comparaison
 * naïve fuit, par sa durée, le nombre d'octets corrects.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false

  const iterations = Number(parts[1])
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 5_000_000) return false

  let salt: Uint8Array
  let expected: Uint8Array
  try {
    salt = fromBase64(parts[2]!)
    expected = fromBase64(parts[3]!)
  } catch {
    return false
  }

  const actual = await derive(password, salt, iterations)
  return timingSafeEqual(actual, expected)
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

/** Jeton de session opaque : 256 bits d'entropie, encodés en base64url. */
export function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Seul le SHA-256 du jeton est stocké. Une fuite de la base ne permet donc
 * pas de rejouer une session — le jeton brut n'existe que dans le cookie.
 */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token))
  return toBase64(new Uint8Array(digest))
}

/** Identifiant trié par le temps : ordonnable, contrairement à un UUID v4. */
export function newId(): string {
  const time = Date.now().toString(36).padStart(9, '0')
  const rand = crypto.getRandomValues(new Uint8Array(10))
  let suffix = ''
  for (const b of rand) suffix += b.toString(36).padStart(2, '0')
  return `${time}${suffix}`
}
