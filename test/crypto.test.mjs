// Le hachage des mots de passe, et la limite de plateforme qui l'a casse.
//
// CE QUI S'EST PASSE. Le code derivait en 210 000 iterations PBKDF2. Le
// workerd local l'accepte ; celui de production le refuse au-dela de
// 100 000, avec une NotSupportedError non rattrapee. Resultat au premier
// deploiement : /api/auth/login en erreur 500 pour tout le monde, y compris
// pour les adresses inconnues, puisque l'empreinte factice qui egalise les
// temps de reponse portait le meme compte d'iterations.
//
// Aucun test fonctionnel local ne pouvait le voir : la limite n'existe pas
// en local. C'est pour cela que ce fichier LIT LE CODE au lieu de l'exercer.
// Un test qui ne peut pas echouer sur la machine ou il tourne ne protege de
// rien ; celui-ci verifie une propriete du texte source, qui est vraie ou
// fausse partout.
//
// Le reste s'exerce bel et bien : le contrat entre create-operator.mjs et le
// Worker se verifie en fabriquant une empreinte cote Node, en la posant dans
// la base, puis en se connectant avec. C'est exactement le chemin qui a
// produit un compte exploitant inutilisable.
//
//   npm run dev      (dans un autre terminal)
//   node --test test/crypto.test.mjs
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { webcrypto as crypto } from 'node:crypto'
import { BASE, client, control, uniq, waitReady } from './helpers.mjs'

/** La limite de workerd. Elle n'est pas negociable, d'ou la constante ici. */
const WORKERD_PBKDF2_CEILING = 100_000

const read = p => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const CRYPTO = read('../src/auth/crypto.ts')
const API = read('../src/api.ts')
const OPERATOR = read('../scripts/create-operator.mjs')

const num = (source, name) => {
  const m = source.match(new RegExp(`${name}\\s*=\\s*([\\d_]+)`))
  assert.ok(m, `${name} introuvable`)
  return Number(m[1].replace(/_/g, ''))
}

test('aucune derivation ne depasse le plafond de workerd', () => {
  // La regression exacte. Remonter cette constante remet la connexion hors
  // service en production, et nulle part ailleurs.
  assert.ok(num(CRYPTO, 'PBKDF2_MAX_ITERATIONS') <= WORKERD_PBKDF2_CEILING,
    'une derivation au-dessus de 100 000 leve en production')
  assert.ok(num(OPERATOR, 'PBKDF2_MAX_ITERATIONS') <= WORKERD_PBKDF2_CEILING,
    'create-operator fabriquerait une empreinte que le Worker ne peut pas relire')
})

test('le script exploitant calcule comme le Worker', () => {
  // Deux implementations du meme hachage, dans deux langages d'execution
  // differents. Si elles divergent, le compte cree se connecte a l'appli
  // avec un mot de passe que l'appli refuse — et le message d'erreur parle
  // d'identifiants invalides, ce qui envoie chercher trois heures ailleurs.
  for (const name of ['PBKDF2_MAX_ITERATIONS', 'PBKDF2_ROUNDS']) {
    assert.equal(num(OPERATOR, name), num(CRYPTO, name), `${name} diverge entre les deux`)
  }
  assert.match(OPERATOR, /`pbkdf2c\$\$\{PBKDF2_MAX_ITERATIONS\}\$\$\{PBKDF2_ROUNDS\}\$/,
    'le script doit ecrire le format chaine')
})

test('l empreinte factice tient sous le plafond', () => {
  // Elle sert quand le compte n'existe pas. Si elle leve, la connexion tombe
  // pour les adresses inconnues — l'egaliseur de temps devient la panne.
  const m = API.match(/DUMMY_HASH\s*=\s*\n?\s*'([^']+)'/)
  assert.ok(m, 'DUMMY_HASH introuvable')
  const parts = m[1].split('$')
  assert.equal(parts[0], 'pbkdf2c', 'elle doit suivre le format des vraies empreintes')
  assert.ok(Number(parts[1]) <= WORKERD_PBKDF2_CEILING)
  assert.equal(Number(parts[2]), num(CRYPTO, 'PBKDF2_ROUNDS'),
    'meme cout que les vraies, sinon elle n egalise plus rien')
})

// ── Le contrat Node ↔ Worker, exerce pour de vrai ────────────────────────

const ITERATIONS = num(CRYPTO, 'PBKDF2_MAX_ITERATIONS')
const ROUNDS = num(CRYPTO, 'PBKDF2_ROUNDS')

async function chained(password, saltBytes, iterations = ITERATIONS, rounds = ROUNDS) {
  let material = new TextEncoder().encode(password)
  for (let i = 0; i < rounds; i++) {
    const key = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveBits'])
    material = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' }, key, 256))
  }
  return material
}

const b64 = bytes => Buffer.from(bytes).toString('base64')
const SALT = new Uint8Array(16).fill(7)

let email, user

before(async () => {
  assert.equal((await client().call('GET', '/api/health')).status, 200, `App injoignable sur ${BASE}`)
  const c = uniq()
  email = `crypto-${c}@example.ma`
  user = client()
  const created = await user.call('POST', '/api/auth/signup', {
    clubName: 'Club Crypto', slug: `crypto-${c}`, name: 'Owner Crypto',
    email, password: 'motdepasse-solide-c1',
  })
  assert.equal(created.status, 201, JSON.stringify(created.data))
})

/** Remplace l'empreinte du compte d'essai, puis tente la connexion. */
async function loginWith(hash, password) {
  control(`UPDATE users SET password_hash = '${hash}' WHERE email_norm = '${email}'`)
  await waitReady()
  return (await client().call('POST', '/api/auth/login', { email, password })).status
}

test('une empreinte fabriquee cote Node est acceptee par le Worker', async () => {
  const hash = `pbkdf2c$${ITERATIONS}$${ROUNDS}$${b64(SALT)}$${b64(await chained('mot-de-passe-node', SALT))}`
  assert.equal(await loginWith(hash, 'mot-de-passe-node'), 200,
    'le Worker doit relire ce que create-operator ecrit')
})

test('une empreinte chainee refuse un autre mot de passe', async () => {
  const hash = `pbkdf2c$${ITERATIONS}$${ROUNDS}$${b64(SALT)}$${b64(await chained('mot-de-passe-node', SALT))}`
  assert.equal(await loginWith(hash, 'pas-le-bon-mot-de-passe'), 401)
})

test('l ancien format reste lu tant qu il tient sous le plafond', async () => {
  // Un compte cree avant le chainage doit continuer a se connecter.
  const single = await chained('ancien-mot-de-passe', SALT, ITERATIONS, 1)
  const hash = `pbkdf2$${ITERATIONS}$${b64(SALT)}$${b64(single)}`
  assert.equal(await loginWith(hash, 'ancien-mot-de-passe'), 200)
})

test('une empreinte au-dessus du plafond refuse, elle ne fait pas tomber l endpoint', async () => {
  // LE test de non-regression. Une empreinte heritee en 210 000 ne peut plus
  // etre verifiee en production ; elle doit se traduire par un refus, jamais
  // par une 500 — sinon une seule ligne perimee en base met la connexion de
  // TOUT LE MONDE hors service, ce qui est arrive.
  const hash = `pbkdf2$210000$${b64(SALT)}$${b64(new Uint8Array(32))}`
  const status = await loginWith(hash, 'peu-importe')
  assert.equal(status, 401, `attendu un refus, obtenu ${status}`)
})
