// Primitives cryptographiques — Web Crypto uniquement (disponible nativement
// sur Workers, aucune dépendance).

/**
 * workerd REFUSE plus de 100 000 iterations par appel a `deriveBits` :
 *
 *   NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not
 *   supported (requested 210000).
 *
 * C'est une limite de la plateforme, pas un reglage. Elle ne se manifeste
 * qu'en production — le workerd local l'accepte — donc aucun test local ne
 * peut la voir. Elle a mis la connexion entiere hors service au premier
 * deploiement, y compris pour les comptes inexistants, puisque l'empreinte
 * factice portait le meme compte d'iterations.
 *
 * Plutot que de diviser par deux le facteur de travail, on ENCHAINE des
 * derivations : la sortie d'un tour sert d'entree au suivant. Deux tours de
 * 100 000 valent 200 000 iterations de travail pour qui attaque, au plus
 * pres de la recommandation OWASP d'origine. Chaque tour est un PBKDF2
 * complet sur un secret de 256 bits ; rien n'est affaibli, seul le decoupage
 * change.
 */
const PBKDF2_MAX_ITERATIONS = 100_000
const PBKDF2_ROUNDS = 2 // 200 000 au total
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

/** Un tour. Le materiau d'entrée est du texte au premier tour, la sortie du
 *  tour précédent ensuite — `importKey` accepte des octets quelconques. */
async function deriveOnce(material: BufferSource, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS,
  )
  return new Uint8Array(bits)
}

async function derive(
  password: string, salt: Uint8Array, iterations: number, rounds: number,
): Promise<Uint8Array> {
  let material: BufferSource = encoder.encode(password)
  // Annotee : sans cela l'inference fige le type du tampon sur celui du
  // premier tour, et le second ne s'y assigne plus.
  let out: Uint8Array = new Uint8Array(0)
  for (let i = 0; i < rounds; i++) {
    out = await deriveOnce(material, salt, iterations)
    material = out as BufferSource
  }
  return out
}

/**
 * Format stocké : pbkdf2c$<iterations>$<tours>$<sel b64>$<clé b64>
 *
 * L'étiquette porte un `c` — pour « chaîné » — parce que le calcul n'est pas
 * celui de l'ancien format. Un `pbkdf2$210000$…` désignait UNE dérivation de
 * 210 000 tours ; le relire comme deux tours de 105 000 donnerait un autre
 * résultat. Deux calculs différents ne partagent pas une étiquette : sinon la
 * même empreinte voudrait dire deux choses selon la version du code qui la
 * lit, et la panne se présenterait comme un mot de passe refusé.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const key = await derive(password, salt, PBKDF2_MAX_ITERATIONS, PBKDF2_ROUNDS)
  return `pbkdf2c$${PBKDF2_MAX_ITERATIONS}$${PBKDF2_ROUNDS}$${toBase64(salt)}$${toBase64(key)}`
}

/**
 * Vérifie un mot de passe. Comparaison à temps constant : une comparaison
 * naïve fuit, par sa durée, le nombre d'octets corrects.
 *
 * Les deux formats sont lus. L'ancien reste accepté tant qu'il tient sous le
 * plafond de la plateforme — au-dessus, on répond « non » plutôt que de
 * laisser `deriveBits` lever : une empreinte périmée doit refuser une
 * connexion, jamais mettre l'endpoint à terre.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')

  let iterations: number
  let rounds: number
  let saltPart: string | undefined
  let keyPart: string | undefined

  if (parts[0] === 'pbkdf2c' && parts.length === 5) {
    iterations = Number(parts[1])
    rounds = Number(parts[2])
    saltPart = parts[3]
    keyPart = parts[4]
  } else if (parts[0] === 'pbkdf2' && parts.length === 4) {
    iterations = Number(parts[1])
    rounds = 1
    saltPart = parts[2]
    keyPart = parts[3]
  } else {
    return false
  }

  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > PBKDF2_MAX_ITERATIONS) return false
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) return false

  let salt: Uint8Array
  let expected: Uint8Array
  try {
    salt = fromBase64(saltPart!)
    expected = fromBase64(keyPart!)
  } catch {
    return false
  }

  const actual = await derive(password, salt, iterations, rounds)
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
